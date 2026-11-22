import { isNumber, isRecord } from '@workspace/runtime-safety';
import { eq } from 'drizzle-orm';

import { CompactionService } from '../compaction/compaction.service';
import { runs } from '../db/schema';
import { ProviderFailure } from '../models/provider-failure/provider-failure';
import { waitFor } from '../testing/support';
import {
  answer,
  call,
  useSegmentsFixture,
} from '../testing/run-segments.test-fixture';
import { seedRun } from './worker-harness';
import { RunWaitService } from './run-wait.service';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'quota-compaction-boundaries.integration.test.ts requires TEST_DATABASE_URL.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('quota waits at compaction boundaries', () => {
  const fx = useSegmentsFixture('quota-compaction-boundaries', {
    allowedTools: ['read'],
    localMachine: 'quota-compaction-boundaries-host',
  });

  const quotaFailure = () =>
    new ProviderFailure('The provider quota is exhausted.', {
      code: 'quota_exhausted',
      resetsAt: Date.now() + 120_000,
      statusCode: 429,
    });

  async function awaitingQuota(runId: string, resumeAt?: string) {
    return waitFor(
      async () => {
        const run = await fx.run(runId);

        if (
          run?.status === 'awaiting_quota' &&
          run.awaiting?.kind === 'quota' &&
          (resumeAt === undefined || run.awaiting.resumeAt === resumeAt)
        )
          return run;

        return undefined;
      },
      20_000,
      `Run ${runId} to await quota${resumeAt ? ` at ${resumeAt}` : ''}`,
    );
  }

  async function wakeQuota(runId: string) {
    const suspended = await fx.run(runId);

    if (
      suspended?.status !== 'awaiting_quota' ||
      suspended.awaiting?.kind !== 'quota'
    )
      throw new Error(`Run ${runId} is not awaiting quota.`);

    const generation = suspended.wakeGeneration;
    const userId = fx.userId;
    const awaiting = suspended.awaiting;

    await fx.db(async (tx) => {
      await tx
        .update(runs)
        .set({
          awaiting: { ...awaiting, wakeAt: new Date(0).toISOString() },
        })
        .where(eq(runs.id, runId));
    });

    return fx.db((tx) =>
      fx.harness.moduleRef.get(RunWaitService).wakeInTransaction(tx, {
        runId,
        userId,
        generation,
        cause: 'timeout',
      }),
    );
  }

  function summaryWithQuotaFailures(failOnCalls: ReadonlySet<number>) {
    let calls = 0;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) => {
        calls += 1;

        if (failOnCalls.has(calls)) return Promise.reject(quotaFailure());

        return Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'A persisted summary of the completed boundary.',
          usage: {},
        });
      });

    summarize.mockClear();

    return summarize;
  }

  function thresholdSummaryWithQuotaOnce() {
    let calls = 0;

    const summarize = vi
      .spyOn(fx.harness.moduleRef.get(CompactionService), 'summarizeCheckpoint')
      .mockImplementation((input) => {
        calls += 1;

        if (calls === 1) return Promise.reject(quotaFailure());

        return Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'A persisted summary of prior conversation history.',
          usage: {},
        });
      });

    summarize.mockClear();

    return summarize;
  }

  function summaryAlwaysQuotaFailure() {
    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation(() => Promise.reject(quotaFailure()));

    summarize.mockClear();
  }

  const summaryWithQuotaOnce = () => summaryWithQuotaFailures(new Set([1]));

  function quotaWaitCounts(
    events: Array<{ eventType: string; payload: unknown }>,
  ) {
    return events.flatMap((event) => {
      if (event.eventType !== 'run.suspended' || !isRecord(event.payload))
        return [];

      if (event.payload['kind'] !== 'quota') return [];

      return isNumber(event.payload['waitCount'])
        ? [event.payload['waitCount']]
        : [];
    });
  }

  it('A manual compact resumes at its boundary and wakes into a successful summary', async () => {
    const seeded = await fx.seed('Read the workspace and compact it.');
    const summarize = summaryWithQuotaOnce();
    let compactId = '';

    await fx.launch(
      seeded,
      [
        call('read-before-compact', 'read', { path: fx.directory }),
        answer('The compacted workspace is ready.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 0 && compactId === '') {
          [compactId] = await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    const suspended = await awaitingQuota(seeded.runId, 'boundary');

    expect(suspended.awaiting).toMatchObject({
      kind: 'quota',
      failureClass: 'quota_exhausted',
      resumeAt: 'boundary',
    });
    expect(await wakeQuota(seeded.runId)).toBe(true);

    const finished = await fx.terminal(seeded.runId);
    const messages = await fx.messages(seeded.chatId);
    const events = await fx.events(seeded.runId);

    const checkpoint = messages.find(
      (message) => message.role === 'checkpoint',
    );

    const continuation = messages.find(
      (message) =>
        message.role === 'user' &&
        message.parts.some(
          (part) =>
            isRecord(part) &&
            isRecord(part['data']) &&
            part['data']['producer'] === 'compaction' &&
            part['data']['form'] === 'notice',
        ),
    );

    expect(finished.status).toBe('completed');
    expect(
      messages.filter((message) => message.role === 'checkpoint'),
    ).toHaveLength(1);
    expect(checkpoint?.seq).toBeLessThan(continuation?.seq ?? 0);
    expect(await fx.itemState(compactId)).toMatchObject({ state: 'delivered' });
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.eventType)).toContain('run.resumed');
  });

  it('A final-answer quota wake summarizes and settles without another main request', async () => {
    const seeded = await fx.seed('Finish with a final answer.');
    const summarize = summaryWithQuotaOnce();

    const started = await fx.launch(
      seeded,
      [answer('The final answer is complete.')],
      async (stepIndex) => {
        if (stepIndex === 0)
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
      },
    );

    const suspended = await awaitingQuota(seeded.runId, 'finalAnswer');

    expect(suspended.awaiting).toMatchObject({
      kind: 'quota',
      resumeAt: 'finalAnswer',
    });
    expect(await wakeQuota(seeded.runId)).toBe(true);

    const finished = await fx.terminal(seeded.runId);
    const messages = await fx.messages(seeded.chatId);
    const events = await fx.events(seeded.runId);

    expect(finished.status).toBe('completed');

    const reply = messages.find((message) => message.role === 'assistant');

    expect(reply?.parts).toContainEqual(
      expect.objectContaining({
        type: 'text',
        text: 'The final answer is complete.',
      }),
    );
    expect(reply?.usage).toMatchObject({
      status: 'completed',
      complete: false,
    });
    expect(reply?.usage).not.toHaveProperty('latencyMs');
    expect(
      events.findLast((event) => event.eventType === 'model.completed')
        ?.payload,
    ).toMatchObject({ telemetry: reply?.usage });
    expect(
      messages.filter((message) => message.role === 'checkpoint'),
    ).toHaveLength(1);
    expect(started.prompts()).toHaveLength(1);
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.eventType)).toContain('run.resumed');
  });

  it('A threshold quota wake resumes pre-dispatch preparation with prior-turn history', async () => {
    const prior = await fx.seed('Establish prior conversation history.');

    await fx.launch(prior, [
      answer('The first turn established reusable history.'),
    ]);

    expect((await fx.terminal(prior.runId)).status).toBe('completed');

    const seeded = {
      ...(await seedRun({
        tenantDb: fx.harness.tenantDb,
        userId: fx.userId,
        modelId: prior.modelId,
        text: 'Continue using the previous conversation.',
        chatId: prior.chatId,
      })),
      modelId: prior.modelId,
    };

    const summarize = thresholdSummaryWithQuotaOnce();

    const started = await fx.launch(
      seeded,
      [answer('The prepared request completed.')],
      undefined,
      { compactionThresholdTokens: 1 },
    );

    const suspended = await awaitingQuota(seeded.runId, 'preDispatch');

    expect(suspended.awaiting).toMatchObject({
      kind: 'quota',
      resumeAt: 'preDispatch',
    });
    expect(await wakeQuota(seeded.runId)).toBe(true);

    const finished = await fx.terminal(seeded.runId);

    expect(finished.status).toBe('completed');
    expect(
      (await fx.messages(seeded.chatId)).filter(
        (message) => message.role === 'checkpoint',
      ),
    ).toHaveLength(1);
    expect(started.prompts()).toHaveLength(1);
    expect(summarize).toHaveBeenCalledTimes(2);
  });

  it('A successful summary closes the quota count before a later boundary request', async () => {
    const seeded = await fx.seed(
      'Compact twice with a successful checkpoint between requests.',
    );

    const summarize = summaryWithQuotaFailures(new Set([1, 3]));
    let firstCompactQueued = false;
    let secondCompactQueued = false;

    await fx.launch(
      seeded,
      [
        call('read-first', 'read', { path: fx.directory }),
        call('read-second', 'read', { path: fx.directory }),
        answer('Both boundaries are complete.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 0 && !firstCompactQueued) {
          firstCompactQueued = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }

        if (stepIndex === 1 && !secondCompactQueued) {
          secondCompactQueued = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    await awaitingQuota(seeded.runId, 'boundary');
    expect(await wakeQuota(seeded.runId)).toBe(true);
    await awaitingQuota(seeded.runId, 'boundary');
    expect(await wakeQuota(seeded.runId)).toBe(true);

    const finished = await fx.terminal(seeded.runId);
    const events = await fx.events(seeded.runId);

    expect(finished.status).toBe('completed');
    expect(quotaWaitCounts(events)).toEqual([1, 1]);
    expect(
      (await fx.messages(seeded.chatId)).filter(
        (message) => message.role === 'checkpoint',
      ),
    ).toHaveLength(2);
    expect(summarize).toHaveBeenCalledTimes(4);
  });

  it('A boundary summary beyond the quota-wait cap continues without a checkpoint', async () => {
    const seeded = await fx.seed(
      'Continue after the compaction quota-wait cap.',
    );

    summaryAlwaysQuotaFailure();

    await fx.launch(
      seeded,
      [
        call('read-before-cap', 'read', { path: fx.directory }),
        answer('The run continues without a checkpoint.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 0)
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
      },
    );

    await awaitingQuota(seeded.runId, 'boundary');
    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [answer('The run continues without a checkpoint.')],
    });

    for (let waitCount = 1; waitCount <= 4; waitCount += 1) {
      const suspended = await awaitingQuota(seeded.runId, 'boundary');

      expect(suspended.awaiting).toMatchObject({ kind: 'quota', waitCount });
      expect(await wakeQuota(seeded.runId)).toBe(true);
    }

    const finished = await fx.terminal(seeded.runId);
    const events = await fx.events(seeded.runId);

    expect(finished.status).toBe('completed');
    expect(quotaWaitCounts(events)).toEqual([1, 2, 3, 4]);
    expect(
      (await fx.messages(seeded.chatId)).filter(
        (message) => message.role === 'checkpoint',
      ),
    ).toHaveLength(0);
  });
});
