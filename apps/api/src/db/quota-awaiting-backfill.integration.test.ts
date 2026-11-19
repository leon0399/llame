import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';

import { useSegmentsFixture } from '../testing/run-segments.test-fixture';
import { RunWaitService } from '../runs/run-wait.service';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'quota-awaiting-backfill.integration.test.ts requires the integration database',
  );
}

const migrationsDirectory = join(__dirname, 'migrations');

const backfillDirectory = readdirSync(migrationsDirectory).find((name) =>
  name.endsWith('_quota_jobs_awaiting_backfill'),
);

if (backfillDirectory === undefined)
  throw new Error('Quota awaiting backfill migration is missing.');

const backfillStatements = readFileSync(
  join(migrationsDirectory, backfillDirectory, 'migration.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);

describe('quota-wait awaiting backfill', () => {
  const fx = useSegmentsFixture('quota-awaiting-backfill', {
    allowedTools: [],
    runsConcurrency: null,
  });

  it('tags a pre-backfill jobs wait and still wakes it', async () => {
    const seeded = await fx.seed();
    const jobId = randomUUID();
    const generation = 7;

    const legacyAwaiting = {
      toolCallId: 'legacy-wait',
      toolInput: { jobs: ['job-1'] },
      jobIds: ['job-1'],
      deadline: new Date(Date.now() - 1000).toISOString(),
    };

    await fx.db((tx) =>
      tx.execute(sql`
      UPDATE runs
      SET status = 'awaiting_jobs',
          awaiting = (${JSON.stringify(legacyAwaiting)}::text)::jsonb,
          current_job_id = ${jobId}::uuid,
          wake_generation = ${generation},
          active_attempt_id = NULL
      WHERE id = ${seeded.runId}::uuid
    `),
    );
    expect(
      await fx.db((tx) =>
        tx.execute(sql`
        SELECT jsonb_typeof(awaiting) AS awaiting_type
        FROM runs
        WHERE id = ${seeded.runId}::uuid
      `),
      ),
    ).toMatchObject([{ awaiting_type: 'object' }]);

    await fx.db(async (tx) => {
      await tx.execute(
        sql`CREATE TEMP TABLE "runs" (id uuid, awaiting jsonb) ON COMMIT DROP`,
      );
      await tx.execute(sql`
        INSERT INTO pg_temp.runs (id, awaiting)
        SELECT id, awaiting FROM public.runs WHERE id = ${seeded.runId}::uuid
      `);
      await tx.execute(sql`ALTER TABLE pg_temp.runs ENABLE ROW LEVEL SECURITY`);
      await tx.execute(sql`ALTER TABLE pg_temp.runs FORCE ROW LEVEL SECURITY`);

      for (const statement of backfillStatements)
        await tx.execute(sql.raw(statement));
      expect(
        await tx.execute(sql`
        SELECT relforcerowsecurity FROM pg_class WHERE oid = 'pg_temp.runs'::regclass
      `),
      ).toMatchObject([{ relforcerowsecurity: true }]);
      await tx.execute(
        sql`ALTER TABLE pg_temp.runs NO FORCE ROW LEVEL SECURITY`,
      );
      await tx.execute(sql`
        UPDATE public.runs AS target SET awaiting = migrated.awaiting
        FROM pg_temp.runs AS migrated
        WHERE target.id = ${seeded.runId}::uuid AND target.id = migrated.id
      `);
    });

    const migrated = await fx.run(seeded.runId);
    expect(migrated?.awaiting).toMatchObject({ kind: 'jobs' });

    const woke = await fx.db((tx) =>
      fx.harness.moduleRef.get(RunWaitService).wakeInTransaction(tx, {
        runId: seeded.runId,
        userId: fx.userId,
        generation,
        cause: 'timeout',
        deadlineJobId: jobId,
      }),
    );

    expect(woke).toBe(true);
    const resumed = await fx.run(seeded.runId);
    expect(resumed?.status).toBe('queued');
    expect(resumed?.awaiting).toMatchObject({
      kind: 'jobs',
      toolCallId: 'legacy-wait',
    });
    expect(
      (await fx.events(seeded.runId)).find(
        (event) => event.eventType === 'run.resumed',
      ),
    ).toMatchObject({
      eventType: 'run.resumed',
      payload: { generation, cause: 'timeout' },
    });
  });
});
