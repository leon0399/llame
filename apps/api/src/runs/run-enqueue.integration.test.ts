import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PgBossService } from '@wavezync/nestjs-pgboss';

import * as schema from '../db/schema';
import { type Db, TenantDbService } from '../db/tenant-db.service';
import { QueueModule } from '../queue/queue.module';
import { QUEUE, type Queue } from '../queue/queue';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { RunDispatchService } from './run-dispatch.service';
import { type RunJob } from './run-queues';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (!TEST_DB_URL) {
  throw new Error(
    'run-enqueue.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}

describe('Run enqueue transaction boundary — real Postgres + pg-boss', () => {
  let sql: Sql;
  let db: Db;
  let app: TestingModule | undefined;
  let queue: Queue;
  let pgBoss: PgBossService;
  let dispatch: RunDispatchService;
  const queueSchema = `${process.env['LLAME_TEST_SCHEMA_PREFIX'] ?? 'llame_t'}_run_enqueue_${crypto.randomUUID().slice(0, 8)}`;

  const job = (runId: string): RunJob => ({
    runId,
    chatId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    modelId: 'system:openai:gpt-5.4-mini',
    userMessage: {
      id: crypto.randomUUID(),
      seq: 1,
      parts: [
        {
          type: 'text',
          text: `quote: ' ; dollar: $$ ; array: ["a'b", "$x", "c\\d"]`,
          markers: ["quote '", 'dollar $$', ['nested', '$x']],
        },
      ],
    },
  });

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;
    sql = postgres(TEST_DB_URL, { ssl, max: 5 });
    db = drizzle(sql, { schema });

    const testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [
            () => ({ POSTGRES_URL: TEST_DB_URL, PGBOSS_SCHEMA: queueSchema }),
          ],
        }),
        QueueModule,
      ],
    }).compile();

    app = testingModule;
    await app.init();
    queue = app.get<Queue>(QUEUE);
    pgBoss = app.get(PgBossService);
    dispatch = new RunDispatchService(
      queue,
      { config: BUILT_IN_DEFAULTS, productUserAgent: 'llame/test' },
      new TenantDbService(db),
    );
  });

  afterAll(async () => {
    await app?.close();

    if (sql) await sql.end();
  });

  it('rolls back an enqueued run with its caller transaction', async () => {
    const payload = job(crypto.randomUUID());
    const id = payload.runId;

    await expect(
      db.transaction(async (tx) => {
        await dispatch.enqueueInTransaction(tx, payload);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await pgBoss.boss.getJobById('runs', id)).toBeNull();
  });

  it('commits delayed dispatch with exact payload and cannot fetch before its startAfter date', async () => {
    const payload = job(crypto.randomUUID());
    const startAfter = new Date(Date.now() + 60_000);

    await db.transaction((tx) =>
      dispatch.enqueueInTransaction(tx, payload, { startAfter }),
    );

    const stored = await pgBoss.boss.getJobById('runs', payload.runId);
    expect(stored).not.toBeNull();
    expect(stored?.startAfter).toEqual(startAfter);
    expect(stored?.data).toEqual(payload);
    expect(await pgBoss.boss.fetch('runs', { batchSize: 1 })).toEqual([]);
  });

  it('rejects a duplicate job id and rolls back earlier queue writes in the same transaction', async () => {
    const original = job(crypto.randomUUID());
    await db.transaction((tx) => dispatch.enqueueInTransaction(tx, original));

    const insertedBeforeDuplicate = job(crypto.randomUUID());
    await expect(
      db.transaction(async (tx) => {
        await dispatch.enqueueInTransaction(tx, insertedBeforeDuplicate);
        await dispatch.enqueueInTransaction(tx, job(original.runId));
      }),
    ).rejects.toThrow('job id already exists');

    expect(
      await pgBoss.boss.getJobById('runs', insertedBeforeDuplicate.runId),
    ).toBeNull();
    expect(await pgBoss.boss.getJobById('runs', original.runId)).toMatchObject({
      data: original,
    });
  });
});
