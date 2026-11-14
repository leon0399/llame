import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { NativeReceiptsRepository } from './native-receipts-repository';
import { RunEventsRepository, RunsRepository } from './runs-repository';

async function readSqlFixture(stagedName: string, sourcePath: string) {
  const stagedDirectory = process.env['LLAME_STRYKER_SQL_FIXTURE_DIR'];

  if (stagedDirectory) {
    return readFile(path.resolve(stagedDirectory, stagedName), 'utf8');
  }

  return readFile(path.resolve(process.cwd(), 'src/runs', sourcePath), 'utf8');
}

type SqlClient = Sql;

type NativeEventPayload = { toolCallId: string; result?: { status: string } };

describe('NativeReceiptsRepository (PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer;
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let ownerId: string;
  let otherOwnerId: string;

  const newRun = async (userId: string, label: string): Promise<string> =>
    tenantDb.runAs(userId, async (tx) => {
      const chatId = crypto.randomUUID();
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
        title: label,
      });

      const message = await new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'go' }],
      });

      const run = await new RunsRepository(tx).create({
        chatId,
        messageId: message.id,
        userId,
        modelId: 'system:openai:gpt-5.4-mini',
      });

      return run.id;
    });

  const append = async (input: {
    userId: string;
    runId: string;
    type: 'native.attempt' | 'native.result';
    toolCallId: string;
    result?: { status: string };
  }): Promise<void> =>
    tenantDb.runAs(input.userId, async (tx) => {
      const payload: NativeEventPayload = {
        toolCallId: input.toolCallId,
      };

      if (input.type === 'native.result') {
        payload.result = input.result;
      }

      await new RunEventsRepository(tx).append(
        input.runId,
        input.type,
        payload,
      );
    });

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      'pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f',
    ).start();
    const containerUri = container.getConnectionUri();
    const clusterAdmin = postgres(containerUri, { max: 1 });

    try {
      await clusterAdmin.unsafe(
        `CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
      );
      await clusterAdmin.unsafe(
        `CREATE ROLE app_rls WITH NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE`,
      );
      await clusterAdmin.unsafe(`CREATE DATABASE llame_test OWNER app`);
    } finally {
      await clusterAdmin.end();
    }

    const databaseUri = new URL(containerUri);
    databaseUri.pathname = '/llame_test';
    const superuser = postgres(databaseUri.href, { max: 1 });

    try {
      await superuser.unsafe(
        await readSqlFixture(
          '03-vector-extension.sql',
          '../../../../docker/postgres/initdb/03-vector-extension.sql',
        ),
      );
      await superuser.unsafe(`ALTER SCHEMA public OWNER TO app`);
    } finally {
      await superuser.end();
    }

    const appUrl = new URL(databaseUri.href);
    appUrl.username = 'app';
    appUrl.password = 'app';
    const migrator = postgres(appUrl.href, { max: 1 });

    try {
      await migrate(drizzle(migrator), {
        migrationsFolder: path.resolve(process.cwd(), 'src/db/migrations'),
      });
    } finally {
      await migrator.end();
    }

    const ownerFixup = postgres(databaseUri.href, { max: 1 });

    try {
      await ownerFixup.unsafe(
        await readSqlFixture(
          'rls-function-owner.sql',
          '../../../../docker/postgres/rls-function-owner.sql',
        ),
      );
    } finally {
      await ownerFixup.end();
    }

    const appClient = postgres(appUrl.href, { max: 4 });
    sql = appClient;
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    ownerId = crypto.randomUUID();
    otherOwnerId = crypto.randomUUID();

    for (const id of [ownerId, otherOwnerId]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'Receipt test', ${`receipt-${id}@test.invalid`})`;
    }
  });

  afterAll(async () => {
    try {
      await sql?.end();
    } finally {
      await container?.stop();
    }
  });

  it('returns the newest committed result for the exact call and owner, not attempts or another call results', async () => {
    const runId = await newRun(ownerId, 'receipt ordering');
    await append({
      userId: ownerId,
      runId,
      type: 'native.attempt',
      toolCallId: 'call-1',
    });
    await append({
      userId: ownerId,
      runId,
      type: 'native.result',
      toolCallId: 'call-1',
      result: { status: 'first' },
    });
    await append({
      userId: ownerId,
      runId,
      type: 'native.result',
      toolCallId: 'call-2',
      result: { status: 'other-call' },
    });
    await append({
      userId: ownerId,
      runId,
      type: 'native.result',
      toolCallId: 'call-1',
      result: { status: 'latest' },
    });
    await append({
      userId: ownerId,
      runId,
      type: 'native.attempt',
      toolCallId: 'attempt-only',
    });

    const own = await tenantDb.runAs(ownerId, (tx) =>
      new NativeReceiptsRepository(tx).findNativeResult(
        runId,
        ownerId,
        'call-1',
      ),
    );

    const attemptOnly = await tenantDb.runAs(ownerId, (tx) =>
      new NativeReceiptsRepository(tx).findNativeResult(
        runId,
        ownerId,
        'attempt-only',
      ),
    );

    const wrongCall = await tenantDb.runAs(ownerId, (tx) =>
      new NativeReceiptsRepository(tx).findNativeResult(
        runId,
        ownerId,
        'missing-call',
      ),
    );

    const wrongOwner = await tenantDb.runAs(ownerId, (tx) =>
      new NativeReceiptsRepository(tx).findNativeResult(
        runId,
        otherOwnerId,
        'call-1',
      ),
    );

    expect(own?.payload).toMatchObject({
      toolCallId: 'call-1',
      result: { status: 'latest' },
    });
    expect(wrongCall).toBeUndefined();
    expect(wrongOwner).toBeUndefined();
    expect(attemptOnly).toBeUndefined();
  });

  it('recognizes only an attempt for the exact owner, run, and call', async () => {
    const runId = await newRun(ownerId, 'attempt scope');
    const otherRunId = await newRun(ownerId, 'other run');
    await append({
      userId: ownerId,
      runId,
      type: 'native.result',
      toolCallId: 'result-only',
    });
    await append({
      userId: ownerId,
      runId,
      type: 'native.attempt',
      toolCallId: 'call-1',
    });

    const repository = (userId: string, id: string, callId: string) =>
      tenantDb.runAs(userId, (tx) =>
        new NativeReceiptsRepository(tx).hasNativeAttempt(id, userId, callId),
      );

    expect(await repository(ownerId, runId, 'call-1')).toBe(true);
    expect(await repository(ownerId, runId, 'result-only')).toBe(false);
    expect(await repository(ownerId, runId, 'missing-call')).toBe(false);
    expect(await repository(ownerId, otherRunId, 'call-1')).toBe(false);
    expect(await repository(otherOwnerId, runId, 'call-1')).toBe(false);
  });
});
