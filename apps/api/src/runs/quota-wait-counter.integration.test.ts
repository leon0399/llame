import { randomUUID } from 'node:crypto';

import { isNumber, isRecord } from '@workspace/runtime-safety';

import { eq } from 'drizzle-orm';

import { runs } from '../db/schema';
import { ProviderFailure } from '../models/provider-failure/provider-failure';
import { waitFor } from '../testing/support';
import {
  answer,
  call,
  useSegmentsFixture,
} from '../testing/run-segments.test-fixture';
import { RunDispatchService } from './run-dispatch.service';
import { RunWaitService } from './run-wait.service';
import { RunEventsRepository } from './runs-repository';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'quota-wait-counter.integration.test.ts requires the integration database',
  );
}

describe('quota wait request allowance against the worker', () => {
  const queueSchema = `quota_counter_${randomUUID().replaceAll('-', '')}`;

  const fx = useSegmentsFixture('quota-counter', {
    allowedTools: ['read'],
    maxStepsPerRun: 4,
    nativeExecutorId: 'quota-counter-host',
    runsConcurrency: 1,
    queueSchema,
  });

  async function waitForQuota(runId: string, waitCount: number) {
    return waitFor(
      async () => {
        const current = await fx.run(runId);

        if (
          current?.status === 'awaiting_quota' &&
          current.awaiting?.kind === 'quota' &&
          current.awaiting.waitCount === waitCount
        ) {
          return current;
        }

        return undefined;
      },
      40_000,
      `Run ${runId} to suspend for quota wait ${waitCount}`,
    );
  }

  async function suspensionWaitCounts(runId: string) {
    const suspensions = (await fx.events(runId)).filter(
      (event) => event.eventType === 'run.suspended',
    );

    return suspensions.map((event) =>
      isRecord(event.payload) && isNumber(event.payload['waitCount'])
        ? event.payload['waitCount']
        : undefined,
    );
  }

  async function wakeThroughQueue(runId: string) {
    const waiting = await fx.run(runId);

    if (
      !waiting ||
      waiting.status !== 'awaiting_quota' ||
      waiting.awaiting?.kind !== 'quota'
    ) {
      throw new Error('Expected a quota-waiting Run before waking it');
    }

    const awaiting = waiting.awaiting;

    // Move only the persisted logical wake time; use the real waker and let its
    // newly enqueued current-generation job be claimed by the real worker.
    await fx.db((tx) =>
      tx
        .update(runs)
        .set({
          awaiting: {
            ...awaiting,
            wakeAt: new Date(0).toISOString(),
          },
        })
        .where(eq(runs.id, runId)),
    );
    await fx.db((tx) =>
      fx.harness.moduleRef.get(RunWaitService).wakeInTransaction(tx, {
        runId,
        userId: fx.userId,
        generation: waiting.wakeGeneration,
        cause: 'timeout',
      }),
    );
  }

  it('allows four waits for one request, then records the next typed quota failure', async () => {
    const seeded = await fx.seed();
    await fx.launch(seeded, [answer('unreachable answer')], () => {
      throw new ProviderFailure('weekly quota exhausted', {
        code: 'quota_exhausted',
        resetsAt: Date.now() + 120_000,
      });
    });

    for (let waitCount = 1; waitCount <= 4; waitCount += 1) {
      await waitForQuota(seeded.runId, waitCount);

      if (waitCount < 4) {
        await wakeThroughQueue(seeded.runId);
      }
    }

    await wakeThroughQueue(seeded.runId);
    const failed = await fx.terminal(seeded.runId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatchObject({ code: 'quota_exhausted' });
    expect(await suspensionWaitCounts(seeded.runId)).toEqual([1, 2, 3, 4]);
  });

  it('starts a fresh allowance after a successful request in the same Run', async () => {
    const seeded = await fx.seed();

    const steps = [
      call('quota-counter-read', 'read', { path: fx.directory }),
      answer('later request'),
    ];

    await fx.launch(seeded, steps, (stepIndex) => {
      if (stepIndex === 0) {
        throw new ProviderFailure('weekly quota exhausted', {
          code: 'quota_exhausted',
          resetsAt: Date.now() + 120_000,
        });
      }
    });

    await waitForQuota(seeded.runId, 1);
    // A wake restarts the scripted client at step zero. That request succeeds;
    // the following request fails, so its new allowance must begin at one.
    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps,
      beforeStep: (stepIndex) => {
        if (stepIndex === 1) {
          throw new ProviderFailure('weekly quota exhausted again', {
            code: 'quota_exhausted',
            resetsAt: Date.now() + 120_000,
          });
        }
      },
    });
    await wakeThroughQueue(seeded.runId);
    const waitingAgain = await waitForQuota(seeded.runId, 1);
    expect(waitingAgain.awaiting).toMatchObject({ waitCount: 1 });
    const events = await fx.events(seeded.runId);
    expect(
      events.some(
        (event) =>
          event.eventType === 'run.quota_recovered' &&
          isRecord(event.payload) &&
          event.payload['resumeAt'] === 'request',
      ),
    ).toBe(true);
    expect(
      events.filter((event) => event.eventType === 'run.suspended'),
    ).toMatchObject([
      { payload: { waitCount: 1 } },
      { payload: { waitCount: 1 } },
    ]);
  });

  it('retains count four through a redelivery claim after awaiting was cleared', async () => {
    const seeded = await fx.seed();
    const generation = 7;
    const jobId = randomUUID();
    const startedAttemptId = randomUUID();
    // Register before committing the queue job so the worker cannot race fixture setup.
    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [answer('unreachable answer')],
      beforeStep: () => {
        throw new ProviderFailure('weekly quota exhausted', {
          code: 'quota_exhausted',
          resetsAt: Date.now() + 120_000,
        });
      },
    });
    await fx.db(async (tx) => {
      const events = new RunEventsRepository(tx);
      await events.append(seeded.runId, 'run.started', {
        attemptId: randomUUID(),
      });
      await events.append(seeded.runId, 'run.suspended', {
        kind: 'quota',
        attemptId: startedAttemptId,
        generation,
        failureClass: 'quota_exhausted',
        resetsAt: new Date(Date.now() - 60_000).toISOString(),
        wakeAt: new Date(Date.now() - 1000).toISOString(),
        resumeAt: 'request',
        waitCount: 4,
        parts: [],
        steps: {},
      });
      await events.append(seeded.runId, 'run.resumed', {
        kind: 'quota',
        attemptId: randomUUID(),
        generation,
        cause: 'timeout',
      });
      await tx
        .update(runs)
        .set({
          status: 'queued',
          activeAttemptId: null,
          awaiting: null,
          currentJobId: jobId,
          wakeGeneration: generation,
        })
        .where(eq(runs.id, seeded.runId));

      // This is the persisted claim-counterfactual: the prior quota wake was
      // already resumed and its attempt died before a successful request, so
      // awaiting is clear while generation 7's current job remains claimable.
      // Enqueue the matching wake identity; the real worker must derive count
      // four from those events, not reset it from the absent awaiting field.
      await fx.harness.moduleRef.get(RunDispatchService).enqueueInTransaction(
        tx,
        {
          runId: seeded.runId,
          chatId: seeded.chatId,
          userId: fx.userId,
          modelId: seeded.modelId,
          userMessage: seeded.userMessage,
          wake: { generation, jobId },
        },
        { id: jobId },
      );
    });

    const failed = await fx.terminal(seeded.runId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatchObject({ code: 'quota_exhausted' });
    expect(await suspensionWaitCounts(seeded.runId)).toEqual([4]);
  });
});
