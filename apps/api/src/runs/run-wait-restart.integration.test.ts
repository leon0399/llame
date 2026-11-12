import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { chatJobs, runs } from '../db/schema';
import { waitFor } from '../testing/support';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RunsController } from './runs.controller';
import { RunWaitService } from './run-wait.service';
import { RUNS_QUEUE } from './run-queues';
import {
  bootWorkerHarness,
  createUser,
  seedLiveChatJob,
  seedRun,
  type WorkerHarness,
} from './worker-harness';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'run-wait-restart.integration.test.ts requires the integration database',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('Run wait application graph restart', () => {
  let harness: WorkerHarness | undefined;
  const queueSchema = `${process.env.LLAME_TEST_SCHEMA_PREFIX ?? 'llame_t'}_wait_restart_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

  afterAll(async () => {
    await harness?.close();
  });

  it('reloads the owner checkpoint and resumes the same Run from its committed wake', async () => {
    harness = await bootWorkerHarness({ runsConcurrency: null, queueSchema });

    const ownerId = await createUser(
      harness.db,
      `wait-restart-${randomUUID()}`,
    );

    const modelId = `wait-restart-model-${randomUUID()}`;

    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId: ownerId,
      modelId,
      text: 'the original owner request',
    });

    const attemptId = randomUUID();

    const job = await harness.tenantDb.runAs(ownerId, async (tx) => {
      await tx
        .update(runs)
        .set({ status: 'running_tool', activeAttemptId: attemptId })
        .where(eq(runs.id, seeded.runId));

      return seedLiveChatJob({ tx, userId: ownerId, modelId, run: seeded });
    });

    await expect(
      harness.moduleRef.get(RunWaitService).suspend({
        runId: seeded.runId,
        chatId: seeded.chatId,
        userId: ownerId,
        attemptId,
        toolCallId: job.toolCallId,
        toolInput: { jobs: [job.id], timeout: 3600 },
        jobIds: [job.id],
        deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        parts: [{ type: 'tool-call', id: job.toolCallId }],
        steps: { [job.toolCallId]: 0 },
      }),
    ).resolves.toEqual({ kind: 'suspended' });

    const suspended = await harness.tenantDb.runAs(ownerId, (tx) =>
      new RunsRepository(tx).findById(seeded.runId, ownerId),
    );

    if (!suspended?.currentJobId) throw new Error('Run has no deadline job');
    const deadlineJobId = suspended.currentJobId;
    expect(suspended).toMatchObject({
      status: 'awaiting_jobs',
      activeAttemptId: null,
      wakeGeneration: 1,
      awaiting: { jobIds: [job.id], toolCallId: job.toolCallId },
    });
    expect(await harness.queue.jobState(RUNS_QUEUE, deadlineJobId)).toBe(
      'queued',
    );

    await harness.close();
    harness = await bootWorkerHarness({ runsConcurrency: null, queueSchema });
    const controller = harness.moduleRef.get(RunsController, { strict: false });
    await expect(
      controller.getRun(ownerId, seeded.runId),
    ).resolves.toMatchObject({
      id: seeded.runId,
      status: 'awaiting_jobs',
    });

    const ownerEventFrames: Array<string> = [];
    const request = { headers: {}, destroyed: false };
    await controller.streamRunEvents(
      ownerId,
      seeded.runId,
      { after_sequence: 0 },
      request,
      {
        writableEnded: false,
        status: () => undefined,
        setHeader: () => undefined,
        flushHeaders: () => undefined,
        write: (frame) => {
          ownerEventFrames.push(frame);

          if (frame.includes('run.suspended')) request.destroyed = true;
        },
        end: () => undefined,
      },
    );
    expect(ownerEventFrames.join('')).toContain('run.suspended');
    expect(ownerEventFrames.join('')).toContain(job.id);

    await harness.tenantDb.runAs(ownerId, (tx) =>
      tx
        .update(chatJobs)
        .set({ state: 'succeeded' })
        .where(eq(chatJobs.id, job.id)),
    );

    // Commit the actual settlement wake route in the API graph; closing this
    // consumer-only graph leaves pickup to the next application graph.
    expect(
      await harness.tenantDb.runAs(ownerId, (tx) =>
        harness!.moduleRef.get(RunWaitService).wakeForChatInTransaction(tx, {
          chatId: seeded.chatId,
          userId: ownerId,
          jobId: job.id,
          kind: 'settlement',
        }),
      ),
    ).toBe(true);

    const awakened = await harness.tenantDb.runAs(ownerId, (tx) =>
      new RunsRepository(tx).findById(seeded.runId, ownerId),
    );

    if (!awakened?.currentJobId) throw new Error('Wake has no queue job');
    expect(awakened).toMatchObject({
      status: 'queued',
      wakeGeneration: suspended.wakeGeneration,
    });
    expect(awakened.currentJobId).not.toBe(deadlineJobId);
    const wakeJobId = awakened.currentJobId;
    expect(await harness.queue.jobState(RUNS_QUEUE, wakeJobId)).toBe('queued');
    expect(ownerEventFrames.join('')).toContain('toolCallId');
    expect(ownerEventFrames.join('')).toContain(job.toolCallId);
    expect(ownerEventFrames.join('')).toContain('"deadline"');
    expect(ownerEventFrames.join('')).toContain('"jobIds"');
    await harness.close();

    harness = await bootWorkerHarness({
      queueSchema,
      runsConcurrency: 1,
      beforeInit: (models) => {
        models.register(modelId, {
          kind: 'complete',
          text: 'completed after application reload',
        });
      },
    });

    const completed = await waitFor(
      async () => {
        const run = await harness!.tenantDb.runAs(ownerId, (tx) =>
          new RunsRepository(tx).findById(seeded.runId, ownerId),
        );

        return run?.status === 'completed' ? run : undefined;
      },
      40_000,
      'the same Run to complete from the queued wake after graph restart',
    );

    expect(completed.id).toBe(seeded.runId);
    expect(
      harness.models.createClientCalls.filter(
        (call) => call.modelId === modelId,
      ),
    ).toHaveLength(1);

    await waitFor(
      async () =>
        (await harness!.queue.jobState(RUNS_QUEUE, wakeJobId)) === 'completed'
          ? true
          : undefined,
      40_000,
      'the wake queue job to complete after the Run',
    );

    expect(
      await harness.tenantDb.runAs(ownerId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.runId, ownerId),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'run.suspended' }),
        expect.objectContaining({ eventType: 'run.resumed' }),
        expect.objectContaining({ eventType: 'run.completed' }),
      ]),
    );
    expect(await harness.queue.jobState(RUNS_QUEUE, wakeJobId)).toBe(
      'completed',
    );
  });
  it('redelivers the due deadline job after a transient post-wake failure', async () => {
    await harness?.close();
    harness = await bootWorkerHarness({ runsConcurrency: null, queueSchema });

    const ownerId = await createUser(
      harness.db,
      `wait-deadline-${randomUUID()}`,
    );

    const modelId = `wait-deadline-model-${randomUUID()}`;

    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId: ownerId,
      modelId,
      text: 'the original deadline request',
    });

    const attemptId = randomUUID();

    const job = await harness.tenantDb.runAs(ownerId, async (tx) => {
      await tx
        .update(runs)
        .set({ status: 'running_tool', activeAttemptId: attemptId })
        .where(eq(runs.id, seeded.runId));

      return seedLiveChatJob({ tx, userId: ownerId, modelId, run: seeded });
    });

    await expect(
      harness.moduleRef.get(RunWaitService).suspend({
        runId: seeded.runId,
        chatId: seeded.chatId,
        userId: ownerId,
        attemptId,
        toolCallId: job.toolCallId,
        toolInput: { jobs: [job.id], timeout: 3600 },
        jobIds: [job.id],
        deadline: new Date(Date.now() + 30_000).toISOString(),
        parts: [{ type: 'tool-call', id: job.toolCallId }],
        steps: { [job.toolCallId]: 0 },
      }),
    ).resolves.toEqual({ kind: 'suspended' });

    const suspended = await harness.tenantDb.runAs(ownerId, (tx) =>
      new RunsRepository(tx).findById(seeded.runId, ownerId),
    );

    if (!suspended?.currentJobId) throw new Error('Run has no deadline job');
    const deadlineJobId = suspended.currentJobId;
    const generation = suspended.wakeGeneration;
    expect(await harness.queue.jobState(RUNS_QUEUE, deadlineJobId)).toBe(
      'queued',
    );

    await harness.close();
    harness = undefined;

    const providerRelease = Promise.withResolvers<void>();
    let providerEntered = false;
    let firstFactoryFailure = false;
    let restoreCreateClientSpy = () => {};

    harness = await bootWorkerHarness({
      queueSchema,
      runsConcurrency: 1,
      beforeInit: (models) => {
        models.register(modelId, {
          kind: 'step-script',
          steps: [
            [{ type: 'text', id: 'final', text: 'deadline resumed once' }],
          ],
          beforeStep: async () => {
            providerEntered = true;
            await providerRelease.promise;
          },
        });

        const createClientSpy = vi
          .spyOn(models, 'createClient')
          .mockImplementationOnce((requestedModelId) => {
            createClientSpy.mockRestore();
            firstFactoryFailure = true;

            if (requestedModelId !== modelId)
              throw new Error('Unexpected model in deadline retry');
            throw new Error('one transient model-factory failure');
          });

        restoreCreateClientSpy = () => createClientSpy.mockRestore();
      },
    });

    try {
      await waitFor(
        () => (providerEntered ? true : undefined),
        40_000,
        'the deadline-retried model provider to enter',
      );
      expect(firstFactoryFailure).toBe(true);

      const duringRetry = await harness.tenantDb.runAs(ownerId, (tx) =>
        new RunsRepository(tx).findById(seeded.runId, ownerId),
      );

      expect(duringRetry).toMatchObject({
        id: seeded.runId,
        status: 'running_model',
        currentJobId: deadlineJobId,
        wakeGeneration: generation,
      });

      const eventsBeforeCompletion = await harness.tenantDb.runAs(
        ownerId,
        (tx) => new RunEventsRepository(tx).listByRunId(seeded.runId, ownerId),
      );

      expect(
        eventsBeforeCompletion.filter(
          (event) => event.eventType === 'run.resumed',
        ),
      ).toHaveLength(1);
      expect(harness.models.createClientCalls).toEqual([{ modelId }]);
      expect(harness.models.streamCalls).toHaveLength(1);

      providerRelease.resolve();

      const completed = await waitFor(
        async () => {
          const run = await harness!.tenantDb.runAs(ownerId, (tx) =>
            new RunsRepository(tx).findById(seeded.runId, ownerId),
          );

          return run?.status === 'completed' ? run : undefined;
        },
        40_000,
        'the deadline-redelivered Run to complete',
      );

      expect(completed.id).toBe(seeded.runId);

      await waitFor(
        async () =>
          (await harness!.queue.jobState(RUNS_QUEUE, deadlineJobId)) ===
          'completed'
            ? true
            : undefined,
        40_000,
        'the deadline queue job to complete after the Run',
      );

      const finalEvents = await harness.tenantDb.runAs(ownerId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seeded.runId, ownerId),
      );

      expect(
        finalEvents.filter((event) => event.eventType === 'run.resumed'),
      ).toHaveLength(1);
      expect(
        finalEvents.filter((event) => event.eventType === 'run.completed'),
      ).toHaveLength(1);
      expect(harness.models.createClientCalls).toEqual([{ modelId }]);
      expect(harness.models.streamCalls).toHaveLength(1);
      expect(await harness.queue.jobState(RUNS_QUEUE, deadlineJobId)).toBe(
        'completed',
      );
    } finally {
      providerRelease.resolve();
      restoreCreateClientSpy();
    }
  });
});
