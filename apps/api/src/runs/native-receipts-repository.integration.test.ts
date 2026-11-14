import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { NativeReceiptsRepository } from './native-receipts-repository';
import { RunEventsRepository, RunsRepository } from './runs-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = Sql;

type NativeEventPayload = { toolCallId: string; result?: { status: string } };

describeIfDb('NativeReceiptsRepository (PostgreSQL)', () => {
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
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    ownerId = crypto.randomUUID();
    otherOwnerId = crypto.randomUUID();

    for (const id of [ownerId, otherOwnerId]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'Receipt test', ${`receipt-${id}@test.invalid`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${ownerId}, ${otherOwnerId})`;
      await sql.end();
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
