import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PgBossService } from '@wavezync/nestjs-pgboss';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { QUEUE, type Queue } from '../queue/queue';
import { QueueModule } from '../queue/queue.module';
import { RunDispatchService } from './run-dispatch.service';
import { type RunJob } from './run-queues';

describe('transactional run enqueue with PostgreSQL', () => {
  let container: StartedPostgreSqlContainer;
  let sql: Sql;
  let db: Db;
  let app: TestingModule;
  let boss: PgBossService;
  let dispatch: RunDispatchService;

  const job = (runId: string): RunJob => ({
    runId,
    chatId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    modelId: 'model',
    userMessage: { id: crypto.randomUUID(), seq: 1, parts: [] },
  });

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      'pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f',
    ).start();
    const url = container.getConnectionUri();
    sql = postgres(url, { max: 5 });
    db = drizzle(sql, { schema });
    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ POSTGRES_URL: url, PGBOSS_SCHEMA: 'enqueue_test' })],
        }),
        QueueModule,
      ],
    }).compile();
    await app.init();
    boss = app.get(PgBossService);
    dispatch = new RunDispatchService(
      app.get<Queue>(QUEUE),
      { config: BUILT_IN_DEFAULTS, productUserAgent: 'llame/test' },
      new TenantDbService(db),
    );
  });

  afterAll(async () => {
    await app?.close();
    await sql?.end();
    await container?.stop();
  });

  it('commits under the caller id instead of the run id', async () => {
    const payload = job(crypto.randomUUID());
    const id = crypto.randomUUID();

    await db.transaction((tx) =>
      dispatch.enqueueInTransaction(tx, payload, { id }),
    );

    expect(await boss.boss.getJobById('runs', id)).toMatchObject({
      data: payload,
    });
    expect(await boss.boss.getJobById('runs', payload.runId)).toBeNull();
  });

  it('rolls back all writes when a caller id already exists', async () => {
    const id = crypto.randomUUID();
    const original = job(crypto.randomUUID());
    await db.transaction((tx) =>
      dispatch.enqueueInTransaction(tx, original, { id }),
    );

    const earlier = job(crypto.randomUUID());
    let earlierEnqueued = false;

    await expect(
      db.transaction(async (tx) => {
        await dispatch.enqueueInTransaction(tx, earlier);
        earlierEnqueued = true;
        await dispatch.enqueueInTransaction(tx, job(crypto.randomUUID()), {
          id,
        });
      }),
    ).rejects.toThrow(Error);

    expect(earlierEnqueued).toBe(true);

    expect(await boss.boss.getJobById('runs', earlier.runId)).toBeNull();
    expect(await boss.boss.getJobById('runs', id)).toMatchObject({
      data: original,
    });
  });
});
