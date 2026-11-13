import { randomUUID } from 'node:crypto';

import { isRecord, isString } from '@workspace/runtime-safety';

import { runEvents } from '../db/schema';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { waitFor } from '../testing/support';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RunsController } from './runs.controller';
import { RunWaitService } from './run-wait.service';
import {
  bootWorkerHarness,
  createUser,
  seedLiveChatJob,
  seedRun,
  type WorkerHarness,
} from './worker-harness';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'runs-worker-suspension.integration.test.ts requires the integration database',
  );
}

describe('RunsWorkerService suspension lifecycle', () => {
  let harness: WorkerHarness;
  let userId: string;

  beforeAll(async () => {
    harness = await bootWorkerHarness({ runsConcurrency: 1 });
    userId = await createUser(harness.db, `suspend-${randomUUID()}`);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('releases the sole worker after suspension so another Chat can execute', async () => {
    const firstModel = `suspend-first-${randomUUID()}`;
    const secondModel = `suspend-second-${randomUUID()}`;
    let stepHasStarted = false;
    let releaseStep!: () => void;

    const stepGate = new Promise<void>((resolve) => {
      releaseStep = resolve;
    });

    harness.models.register(firstModel, {
      kind: 'step-script',
      steps: [[{ type: 'text', id: 'first-answer', text: 'suspended text' }]],
      beforeStep: async () => {
        stepHasStarted = true;
        await stepGate;
      },
    });
    harness.models.register(secondModel, {
      kind: 'complete',
      text: 'second chat completed',
    });

    const waiting = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId: firstModel,
      text: 'wait for the job',
    });

    const next = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId: secondModel,
      text: 'run while the first waits',
    });

    const job = await harness.tenantDb.runAs(userId, (tx) =>
      seedLiveChatJob({
        tx,
        userId,
        modelId: firstModel,
        run: waiting,
      }),
    );

    const waitService = harness.moduleRef.get(RunWaitService);
    let suspension: Awaited<ReturnType<RunWaitService['suspend']>> | undefined;

    try {
      await harness.dispatch.dispatch({
        runId: waiting.runId,
        chatId: waiting.chatId,
        userId,
        modelId: firstModel,
        userMessage: waiting.userMessage,
      });
      await harness.dispatch.dispatch({
        runId: next.runId,
        chatId: next.chatId,
        userId,
        modelId: secondModel,
        userMessage: next.userMessage,
      });

      await waitFor(
        () => stepHasStarted || undefined,
        15_000,
        'the first Run to enter its scripted provider step',
      );

      const startedEvent = await harness.tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).findFirstByType(
          waiting.runId,
          userId,
          'run.started',
        ),
      );

      const startedPayload = startedEvent?.payload;

      if (
        !startedEvent ||
        !isRecord(startedPayload) ||
        !isString(startedPayload['attemptId'])
      ) {
        throw new Error('Expected the active attempt ID from run.started');
      }

      suspension = await waitService.suspend({
        runId: waiting.runId,
        chatId: waiting.chatId,
        userId,
        attemptId: startedPayload['attemptId'],
        toolCallId: job.toolCallId,
        toolInput: { jobs: [job.id], timeout: 3600 },
        jobIds: [job.id],
        deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        parts: [],
        steps: {},
      });

      releaseStep();

      await waitFor(
        async () => {
          const [waitingRun, nextRun] = await Promise.all([
            harness.tenantDb.runAs(userId, (tx) =>
              new RunsRepository(tx).findById(waiting.runId, userId),
            ),
            harness.tenantDb.runAs(userId, (tx) =>
              new RunsRepository(tx).findById(next.runId, userId),
            ),
          ]);

          return waitingRun?.status === 'awaiting_jobs' &&
            nextRun?.status === 'completed'
            ? true
            : undefined;
        },
        15_000,
        'the waiting Run to suspend and the next Chat to complete on the sole worker',
      );

      expect(suspension).toEqual({ kind: 'suspended' });
      expect(harness.models.createClientCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ modelId: firstModel }),
          expect.objectContaining({ modelId: secondModel }),
        ]),
      );

      const waitingRun = await harness.tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(waiting.runId, userId),
      );

      expect(waitingRun).toMatchObject({
        status: 'awaiting_jobs',
        wakeGeneration: 1,
        awaiting: { jobIds: [job.id], toolCallId: job.toolCallId },
      });

      if (!waitingRun?.currentJobId) {
        throw new Error('Suspended Run has no deadline job pointer');
      }

      expect(await harness.dispatch.jobState(waiting.runId)).toBe('completed');
      expect(await harness.dispatch.jobState(waitingRun.currentJobId)).toBe(
        'queued',
      );

      const events = await harness.tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(waiting.runId, userId),
      );

      expect(events.map((event) => event.eventType)).toContain('run.suspended');
      expect(events.map((event) => event.eventType)).not.toContain(
        'run.completed',
      );
      expect(
        await harness.tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(next.runId, userId),
        ),
      ).toMatchObject({ status: 'completed' });
    } finally {
      releaseStep();
    }
  });

  it('rejects a pickup claim after a newer wake generation suspends the Run', async () => {
    const modelId = `stale-claim-${randomUUID()}`;

    const run = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      text: 'become suspended before claim',
    });

    const { attemptId, job } = await harness.tenantDb.runAs(
      userId,
      async (tx) => {
        const job = await seedLiveChatJob({
          tx,
          userId,
          modelId,
          run,
        });

        const started = await new RunsRepository(tx).markStarted(
          run.runId,
          userId,
        );

        if (!started?.activeAttemptId) {
          throw new Error('Expected the initial Run attempt to start');
        }

        await new RunEventsRepository(tx).append(run.runId, 'run.started', {
          attemptId: started.activeAttemptId,
        });

        return { attemptId: started.activeAttemptId, job };
      },
    );

    const waiting = await harness.moduleRef.get(RunWaitService).suspend({
      runId: run.runId,
      chatId: run.chatId,
      userId,
      attemptId,
      toolCallId: job.toolCallId,
      toolInput: { jobs: [job.id], timeout: 3600 },
      jobIds: [job.id],
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      parts: [],
      steps: {},
    });

    expect(waiting).toEqual({ kind: 'suspended' });

    const suspended = await harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(run.runId, userId),
    );

    expect(suspended).toMatchObject({
      status: 'awaiting_jobs',
      wakeGeneration: 1,
    });

    const wakeService = harness.moduleRef.get(RunWaitService);
    await expect(
      harness.tenantDb.runAs(userId, (tx) =>
        wakeService.wakeInTransaction(tx, {
          runId: run.runId,
          userId,
          generation: 1,
          cause: 'interrupted',
        }),
      ),
    ).resolves.toBe(true);

    const queued = await harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(run.runId, userId),
    );

    expect(queued).toMatchObject({
      status: 'queued',
      wakeGeneration: 1,
    });

    if (!queued?.currentJobId) {
      throw new Error('Woken Run has no current queue job');
    }

    // This models a worker paused after pickup: its queue identity is the
    // original one, while the Run now belongs to the newer queued generation.
    const staleClaim = await harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).markStarted(run.runId, userId, {
        expectedQueueIdentity: { currentJobId: null, wakeGeneration: 0 },
      }),
    );

    expect(staleClaim).toBeUndefined();

    const staleSettlement = await harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).markFinished(run.runId, userId, 'cancelled', {
        expectedQueueIdentity: { currentJobId: null, wakeGeneration: 0 },
      }),
    );

    expect(staleSettlement).toBeUndefined();

    const currentClaim = await harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).markStarted(run.runId, userId, {
        workerId: 'worker-current',
        expectedQueueIdentity: {
          currentJobId: queued.currentJobId,
          wakeGeneration: queued.wakeGeneration,
        },
      }),
    );

    expect(currentClaim).toMatchObject({
      status: 'running_model',
      workerId: 'worker-current',
    });
    expect(currentClaim?.activeAttemptId).toBeTruthy();
    expect(
      await harness.tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(run.runId, userId),
      ),
    ).toMatchObject({
      status: 'running_model',
      currentJobId: queued.currentJobId,
      wakeGeneration: queued.wakeGeneration,
      workerId: 'worker-current',
      activeAttemptId: currentClaim?.activeAttemptId,
    });
  });

  it('cancels a suspended Run through the controller and settles it at real pickup', async () => {
    const modelId = `cancel-waiting-${randomUUID()}`;
    harness.models.register(modelId, {
      kind: 'complete',
      text: 'must not execute',
    });

    const run = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      text: 'cancel while waiting',
    });

    const { attemptId, job } = await harness.tenantDb.runAs(
      userId,
      async (tx) => {
        const job = await seedLiveChatJob({
          tx,
          userId,
          modelId,
          run,
        });

        const started = await new RunsRepository(tx).markStarted(
          run.runId,
          userId,
        );

        if (!started?.activeAttemptId) {
          throw new Error('Expected the waiting Run to have an active attempt');
        }

        await new RunEventsRepository(tx).append(run.runId, 'run.started', {
          attemptId: started.activeAttemptId,
        });

        return { attemptId: started.activeAttemptId, job };
      },
    );

    const waitService = harness.moduleRef.get(RunWaitService);

    const suspension = await waitService.suspend({
      runId: run.runId,
      chatId: run.chatId,
      userId,
      attemptId,
      toolCallId: job.toolCallId,
      toolInput: { jobs: [job.id], timeout: 3600 },
      jobIds: [job.id],
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      parts: [],
      steps: {},
    });

    expect(suspension).toEqual({ kind: 'suspended' });

    const controller = harness.moduleRef.get(RunsController, {
      strict: false,
    });

    await expect(
      controller.updateRun(userId, run.runId, { status: 'cancelled' }),
    ).resolves.toMatchObject({ status: 'queued' });

    await waitFor(
      async () => {
        const current = await harness.tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(run.runId, userId),
        );

        return current?.status === 'cancelled' ? true : undefined;
      },
      15_000,
      'the real worker to settle the woken cancelled Run at pickup',
    );

    const current = await harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(run.runId, userId),
    );

    expect(current?.cancelRequestedAt).not.toBeNull();
    expect(current?.currentJobId).toBeTruthy();
    expect(
      harness.models.createClientCalls.some((call) => call.modelId === modelId),
    ).toBe(false);
    expect(
      await harness.tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(run.runId, userId, {
          eventTypes: ['run.cancelled'],
        }),
      ),
    ).toHaveLength(1);
    expect(await harness.dispatch.jobState(current!.currentJobId!)).toBe(
      'completed',
    );
  });

  it('expires on actual worker pickup after the budget elapsed during a wait', async () => {
    const modelId = `budget-waiting-${randomUUID()}`;
    const instanceConfig = harness.moduleRef.get(InstanceConfigService);
    const originalTimeoutSeconds = instanceConfig.config.runs.timeoutSeconds;
    instanceConfig.config.runs.timeoutSeconds = null;

    let stepHasStarted = false;
    let releaseStep!: () => void;

    const stepGate = new Promise<void>((resolve) => {
      releaseStep = resolve;
    });

    harness.models.register(modelId, {
      kind: 'step-script',
      steps: [[{ type: 'text', id: 'budget-answer', text: 'suspended text' }]],
      beforeStep: async () => {
        stepHasStarted = true;
        await stepGate;
      },
    });

    const run = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      text: 'wait past the budget',
    });

    const job = await harness.tenantDb.runAs(userId, async (tx) => {
      await tx.insert(runEvents).values({
        runId: run.runId,
        eventType: 'run.started',
        payload: { attemptId: `budget-anchor-${randomUUID()}` },
        createdAt: new Date(Date.now() - 2000),
      });

      return seedLiveChatJob({ tx, userId, modelId, run });
    });

    const waitService = harness.moduleRef.get(RunWaitService);

    try {
      await harness.dispatch.dispatch({
        runId: run.runId,
        chatId: run.chatId,
        userId,
        modelId,
        userMessage: run.userMessage,
      });
      await waitFor(
        () => stepHasStarted || undefined,
        15_000,
        'the initial worker to reach the scripted provider step',
      );

      const startedEvent = await harness.tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).findFirstByType(
          run.runId,
          userId,
          'run.started',
          { newest: true },
        ),
      );

      if (
        !isRecord(startedEvent?.payload) ||
        !isString(startedEvent.payload['attemptId'])
      ) {
        throw new Error('Expected the live attempt ID from run.started');
      }

      const suspension = await waitService.suspend({
        runId: run.runId,
        chatId: run.chatId,
        userId,
        attemptId: startedEvent.payload['attemptId'],
        toolCallId: job.toolCallId,
        toolInput: { jobs: [job.id], timeout: 3600 },
        jobIds: [job.id],
        deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        parts: [],
        steps: {},
      });

      expect(suspension).toEqual({ kind: 'suspended' });
      releaseStep();

      await waitFor(
        async () => {
          const current = await harness.tenantDb.runAs(userId, (tx) =>
            new RunsRepository(tx).findById(run.runId, userId),
          );

          return current?.status === 'awaiting_jobs' &&
            (await harness.dispatch.jobState(run.runId)) === 'completed'
            ? true
            : undefined;
        },
        15_000,
        'the first queue job to acknowledge its waiting Run',
      );

      // The old run.started timestamp is an intentional logical-time fixture:
      // it proves the budget includes time in awaiting_jobs without sleeping.
      const firstStarted = await harness.tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).findFirstByType(
          run.runId,
          userId,
          'run.started',
        ),
      );

      expect(firstStarted?.createdAt.getTime()).toBeLessThan(Date.now() - 1000);
      instanceConfig.config.runs.timeoutSeconds = 1;

      const current = await harness.tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(run.runId, userId),
      );

      if (!current) throw new Error('Expected the suspended Run');

      const woke = await harness.tenantDb.runAs(userId, (tx) =>
        waitService.wakeInTransaction(tx, {
          runId: run.runId,
          userId,
          generation: current.wakeGeneration,
          cause: 'interrupted',
        }),
      );

      expect(woke).toBe(true);

      await waitFor(
        async () => {
          const resumed = await harness.tenantDb.runAs(userId, (tx) =>
            new RunsRepository(tx).findById(run.runId, userId),
          );

          return resumed?.status === 'expired' ? true : undefined;
        },
        15_000,
        'the resumed Run to expire before another model request',
      );

      expect(
        harness.models.createClientCalls.filter(
          (call) => call.modelId === modelId,
        ),
      ).toHaveLength(1);
      expect(
        await harness.tenantDb.runAs(userId, (tx) =>
          new RunEventsRepository(tx).listByRunId(run.runId, userId, {
            eventTypes: ['run.expired'],
          }),
        ),
      ).toHaveLength(1);
    } finally {
      releaseStep();
      instanceConfig.config.runs.timeoutSeconds = originalTimeoutSeconds;
    }
  });
});
