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
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { newChatJob } from '../testing/chat-job-rows';
import { ChatDeliveriesRepository } from './chat-deliveries.repository';
import { ChatsRepository } from './chats-repository';

async function readSqlFixture(stagedName: string, sourcePath: string) {
  const stagedDirectory = process.env.LLAME_STRYKER_SQL_FIXTURE_DIR;

  if (stagedDirectory)
    return readFile(path.resolve(stagedDirectory, stagedName), 'utf8');

  return readFile(path.resolve(process.cwd(), 'src/chats', sourcePath), 'utf8');
}

describe('ChatDeliveriesRepository PostgreSQL query', () => {
  let container: StartedPostgreSqlContainer;
  let client: Sql;
  let db: Db;
  let tenantDb: TenantDbService;

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

    client = postgres(appUrl.href, { max: 4 });
    db = drizzle(client, { schema });
    tenantDb = new TenantDbService(db);
  });

  afterAll(async () => {
    try {
      await client?.end();
    } finally {
      await container?.stop();
    }
  });

  it('returns the joined job locator/state and excludes a foreign owner row', async () => {
    const ownerA = crypto.randomUUID();
    const ownerB = crypto.randomUUID();
    let chatA = '';
    let chatB = '';
    const itemA = crypto.randomUUID();
    const itemB = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const foreignJobId = crypto.randomUUID();
    const workerId = crypto.randomUUID();

    await client`INSERT INTO users (id, name, email) VALUES
      (${ownerA}, 'A', ${`${ownerA}@test.invalid`}),
      (${ownerB}, 'B', ${`${ownerB}@test.invalid`})`;
    await client`INSERT INTO worker_instances (id) VALUES (${workerId})`;

    chatA = (
      await tenantDb.runAs(ownerA, (tx) =>
        new ChatsRepository(tx).create({ ownerUserId: ownerA, title: 'A' }),
      )
    ).id;
    chatB = (
      await tenantDb.runAs(ownerB, (tx) =>
        new ChatsRepository(tx).create({ ownerUserId: ownerB, title: 'B' }),
      )
    ).id;

    // Seed through the real repositories; only the delivery's producer linkage
    // is written directly because insertPending intentionally creates owner items.
    await tenantDb.runAs(ownerA, async (tx) => {
      await new ChatJobsRepository(tx).insert(
        newChatJob({
          id: jobId,
          chatId: chatA,
          ownerUserId: ownerA,
          seq: 17,
          workerInstanceId: workerId,
        }),
      );
      await tx.insert(schema.chatDeliveries).values({
        id: itemA,
        chatId: chatA,
        ownerUserId: ownerA,
        producer: 'job',
        senderRef: jobId,
        mode: 'queue',
        parts: [{ type: 'text', text: 'A' }],
        settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
      });
    });
    await tenantDb.runAs(ownerB, async (tx) => {
      await new ChatJobsRepository(tx).insert(
        newChatJob({
          id: foreignJobId,
          chatId: chatB,
          ownerUserId: ownerB,
          seq: 23,
          workerInstanceId: workerId,
        }),
      );
      await tx.insert(schema.chatDeliveries).values({
        id: itemB,
        chatId: chatB,
        ownerUserId: ownerB,
        producer: 'job',
        senderRef: foreignJobId,
        mode: 'queue',
        parts: [{ type: 'text', text: 'B' }],
        settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
      });
    });

    const visible = await tenantDb.runAs(ownerA, (tx) =>
      new ChatDeliveriesRepository(tx).listPendingViews(chatA, ownerA),
    );

    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      item: { id: itemA, senderRef: jobId },
      job: { executor: 'bash', seq: 17, state: 'running' },
    });

    const foreign = await tenantDb.runAs(ownerA, (tx) =>
      new ChatDeliveriesRepository(tx).listPendingViews(chatB, ownerB),
    );

    expect(foreign).toEqual([]);
  });
});
