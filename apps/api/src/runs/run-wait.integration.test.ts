import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { chatJobs, runs, workerInstances, type ChatJob } from '../db/schema';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { RunsRepository } from './runs-repository';
import { recordJobSettlementNotice } from '../jobs/job-notices';
import { RunWaitService } from './run-wait.service';
import { RunExecutionService } from './run-execution.service';
import { RunsWorkerService } from './runs-worker.service';
import { type RunJob } from './run-queues';
import { createUser } from './worker-harness';
import {
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';

type SeededWaitingRun = SeededRun & { attemptId: string; job: ChatJob };

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'run-wait.integration.test.ts requires the integration database',
  );
}

describe('Run wait transactions', () => {
  const fx = useSegmentsFixture('run-wait', { allowedTools: [] });
  afterEach(() => vi.restoreAllMocks());

  async function seedWaitingRun(): Promise<SeededWaitingRun> {
    const seeded = await fx.seed();
    const attemptId = randomUUID();
    const workerId = randomUUID();
    await fx.db(async (tx) => {
      await tx
        .update(runs)
        .set({ status: 'running_tool', activeAttemptId: attemptId })
        .where(eq(runs.id, seeded.runId));
      await tx.insert(workerInstances).values({ id: workerId });
      await new ChatJobsRepository(tx).insert({
        chatId: seeded.chatId,
        ownerUserId: fx.userId,
        executor: 'bash',
        seq: 1,
        runId: seeded.runId,
        toolCallId: `call-${randomUUID()}`,
        workerInstanceId: workerId,
        outputs: ['stdout', 'stderr'],
        artifactReadable: false,
        settings: { modelId: seeded.modelId, permissionMode: 'default' },
      });
    });

    const [job] = await fx.db((tx) =>
      new ChatJobsRepository(tx).listByChat(seeded.chatId, fx.userId),
    );

    if (!job) throw new Error('Expected seeded background job');

    return { ...seeded, attemptId, job };
  }

  function suspendInput(seeded: SeededWaitingRun) {
    return {
      runId: seeded.runId,
      chatId: seeded.chatId,
      userId: fx.userId,
      attemptId: seeded.attemptId,
      toolCallId: seeded.job.toolCallId,
      toolInput: { jobs: [seeded.job.id], timeout: 3600 },
      jobIds: [seeded.job.id],
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      parts: [{ type: 'tool-call', id: seeded.job.toolCallId }],
      steps: { [seeded.job.toolCallId]: 0 },
    };
  }

  it('rolls back suspension state and events when the transactional queue insert fails', async () => {
    const seeded = await seedWaitingRun();
    const dispatch = fx.harness.dispatch;

    vi.spyOn(dispatch, 'enqueueInTransaction').mockRejectedValueOnce(
      new Error('queue unavailable'),
    );

    await expect(
      fx.harness.moduleRef.get(RunWaitService).suspend(suspendInput(seeded)),
    ).rejects.toThrow('queue unavailable');

    const run = await fx.run(seeded.runId);
    expect(run).toMatchObject({
      status: 'running_tool',
      awaiting: null,
      currentJobId: null,
    });
    expect(await fx.types(seeded.runId)).not.toContain('run.suspended');
  });

  it('allows one concurrent wake winner and a restarted service reads the persisted generation', async () => {
    const seeded = await seedWaitingRun();
    const service = fx.harness.moduleRef.get(RunWaitService);
    await service.suspend(suspendInput(seeded));
    vi.spyOn(fx.harness.dispatch, 'enqueueInTransaction').mockResolvedValue(
      undefined,
    );
    const awaiting = await fx.run(seeded.runId);

    if (!awaiting?.currentJobId)
      throw new Error('Suspended Run has no current queue job');

    const restartedService = new RunWaitService(
      fx.harness.tenantDb,
      fx.harness.dispatch,
      fx.harness.moduleRef.get(InstanceConfigService),
    );

    const wake = () =>
      fx.harness.tenantDb.runAs(fx.userId, (tx) =>
        restartedService.wakeInTransaction(tx, {
          runId: seeded.runId,
          userId: fx.userId,
          generation: awaiting.wakeGeneration,
          cause: 'interrupted',
        }),
      );

    const outcomes = await Promise.all([wake(), wake()]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);

    const oldAttemptUpdate = await fx.db((tx) =>
      new RunsRepository(tx).updateForAttempt(
        seeded.runId,
        fx.userId,
        seeded.attemptId,
        { status: 'failed' },
      ),
    );

    expect(oldAttemptUpdate).toBeUndefined();
    expect(await fx.types(seeded.runId)).toContain('run.resumed');
    expect((await fx.run(seeded.runId))?.status).toBe('queued');
  });
  it('wakes after a listed job settles and records a settled resume', async () => {
    const seeded = await seedWaitingRun();
    const service = fx.harness.moduleRef.get(RunWaitService);
    await service.suspend(suspendInput(seeded));
    vi.spyOn(fx.harness.dispatch, 'enqueueInTransaction').mockResolvedValue(
      undefined,
    );

    const woke = await fx.harness.tenantDb.runAs(fx.userId, async (tx) => {
      await new ChatJobsRepository(tx).settle(
        seeded.chatId,
        fx.userId,
        seeded.job.id,
        {
          state: 'succeeded',
          result: { exitCode: 0 },
        },
      );

      return service.wakeForChatInTransaction(tx, {
        chatId: seeded.chatId,
        userId: fx.userId,
        jobId: seeded.job.id,
        kind: 'settlement',
      });
    });

    expect(woke).toBe(true);
    expect(await fx.types(seeded.runId)).toContain('run.resumed');

    const resumed = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.resumed',
    );

    expect(resumed?.payload).toMatchObject({ cause: 'settled' });
  });
  it('turns a settlement outside the wait list into an interrupted wake', async () => {
    const seeded = await seedWaitingRun();
    const service = fx.harness.moduleRef.get(RunWaitService);
    await service.suspend(suspendInput(seeded));
    vi.spyOn(fx.harness.dispatch, 'enqueueInTransaction').mockResolvedValue(
      undefined,
    );

    const woke = await fx.harness.tenantDb.runAs(fx.userId, (tx) =>
      service.wakeForChatInTransaction(tx, {
        chatId: seeded.chatId,
        userId: fx.userId,
        jobId: randomUUID(),
        kind: 'settlement',
      }),
    );

    expect(woke).toBe(true);

    const resumed = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.resumed',
    );

    expect(resumed?.payload).toMatchObject({ cause: 'interrupted' });
  });

  it('queues cancellation as a resume for the next Run claim', async () => {
    const seeded = await seedWaitingRun();
    const service = fx.harness.moduleRef.get(RunWaitService);
    await service.suspend(suspendInput(seeded));
    vi.spyOn(fx.harness.dispatch, 'enqueueInTransaction').mockResolvedValue(
      undefined,
    );
    const waiting = await fx.run(seeded.runId);

    if (!waiting?.currentJobId) throw new Error('Run did not suspend');

    const woke = await fx.harness.tenantDb.runAs(fx.userId, (tx) =>
      service.wakeForChatInTransaction(tx, {
        chatId: seeded.chatId,
        userId: fx.userId,
        kind: 'cancel',
      }),
    );

    expect(woke).toBe(true);
    const resumedRun = await fx.run(seeded.runId);
    expect(resumedRun?.status).toBe('queued');
    expect(resumedRun?.wakeGeneration).toBe(waiting.wakeGeneration);
    expect(resumedRun?.currentJobId).not.toBe(waiting.currentJobId);
    expect(resumedRun?.awaiting).toEqual(waiting.awaiting);

    const resumed = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.resumed',
    );

    expect(resumed?.payload).toMatchObject({
      cause: 'cancelled',
      generation: waiting.wakeGeneration,
    });
  });

  it('returns listed settlement before an already-pending notice interrupts suspension', async () => {
    const seeded = await seedWaitingRun();
    const service = fx.harness.moduleRef.get(RunWaitService);
    await fx.harness.tenantDb.runAs(fx.userId, async (tx) => {
      await new ChatJobsRepository(tx).settle(
        seeded.chatId,
        fx.userId,
        seeded.job.id,
        {
          state: 'succeeded',
          result: { exitCode: 0 },
        },
      );
      await recordJobSettlementNotice(tx, seeded.job);
    });

    await expect(service.suspend(suspendInput(seeded))).resolves.toEqual({
      kind: 'ready',
      cause: 'settled',
    });
    expect(await fx.types(seeded.runId)).not.toContain('run.suspended');
  });
  it('interrupts suspension when a lost unrelated job creates a pending notice', async () => {
    const seeded = await seedWaitingRun();
    const lostWorkerId = randomUUID();

    const lostJob = await fx.db(async (tx) => {
      await tx.insert(workerInstances).values({ id: lostWorkerId });

      const job = await new ChatJobsRepository(tx).insert({
        chatId: seeded.chatId,
        ownerUserId: fx.userId,
        executor: 'bash',
        seq: 2,
        runId: seeded.runId,
        toolCallId: `call-${randomUUID()}`,
        workerInstanceId: lostWorkerId,
        outputs: ['stdout', 'stderr'],
        artifactReadable: false,
        settings: { modelId: seeded.modelId, permissionMode: 'default' },
      });

      await tx
        .update(workerInstances)
        .set({ lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(workerInstances.id, lostWorkerId));

      return job;
    });

    const service = fx.harness.moduleRef.get(RunWaitService);

    await expect(service.suspend(suspendInput(seeded))).resolves.toEqual({
      kind: 'ready',
      cause: 'interrupted',
    });
    expect(await fx.types(seeded.runId)).not.toContain('run.suspended');

    const [storedLostJob] = await fx.db((tx) =>
      tx.select().from(chatJobs).where(eq(chatJobs.id, lostJob.id)),
    );

    expect(storedLostJob?.state).toBe('lost');
  });

  it('reuses the deadline job id and refuses an early or stale deadline wake', async () => {
    const seeded = await seedWaitingRun();
    const service = fx.harness.moduleRef.get(RunWaitService);
    await service.suspend(suspendInput(seeded));
    const waiting = await fx.run(seeded.runId);

    if (!waiting?.currentJobId || !waiting.awaiting)
      throw new Error('Run did not suspend');
    const deadlineJobId = waiting.currentJobId;

    const early = await fx.harness.tenantDb.runAs(fx.userId, (tx) =>
      service.wakeInTransaction(tx, {
        runId: seeded.runId,
        userId: fx.userId,
        generation: waiting.wakeGeneration,
        cause: 'timeout',
        deadlineJobId,
      }),
    );

    expect(early).toBe(false);

    const awaiting = {
      ...waiting.awaiting,
      deadline: new Date(Date.now() - 1000).toISOString(),
    };

    await fx.db((tx) =>
      tx.update(runs).set({ awaiting }).where(eq(runs.id, seeded.runId)),
    );

    const woken = await fx.harness.tenantDb.runAs(fx.userId, (tx) =>
      service.wakeInTransaction(tx, {
        runId: seeded.runId,
        userId: fx.userId,
        generation: waiting.wakeGeneration,
        cause: 'timeout',
        deadlineJobId,
      }),
    );

    expect(woken).toBe(true);
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'queued',
      currentJobId: waiting.currentJobId,
      wakeGeneration: waiting.wakeGeneration,
      awaiting,
    });

    const stale = await fx.harness.tenantDb.runAs(fx.userId, (tx) =>
      service.wakeInTransaction(tx, {
        runId: seeded.runId,
        userId: fx.userId,
        generation: waiting.wakeGeneration,
        cause: 'timeout',
        deadlineJobId: randomUUID(),
      }),
    );

    expect(stale).toBe(false);
  });
  it('a deadline that discovers a listed lost job reuses the deadline job without enqueueing', async () => {
    const seeded = await seedWaitingRun();
    const service = fx.harness.moduleRef.get(RunWaitService);
    await service.suspend(suspendInput(seeded));
    const waiting = await fx.run(seeded.runId);

    if (!waiting?.currentJobId) throw new Error('Run did not suspend');
    const deadlineJobId = waiting.currentJobId;

    const enqueue = vi
      .spyOn(fx.harness.dispatch, 'enqueueInTransaction')
      .mockResolvedValue(undefined);

    await fx.db((tx) =>
      tx
        .update(workerInstances)
        .set({ lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(workerInstances.id, seeded.job.workerInstanceId)),
    );

    const woken = await fx.harness.tenantDb.runAs(fx.userId, (tx) =>
      service.wakeInTransaction(tx, {
        runId: seeded.runId,
        userId: fx.userId,
        generation: waiting.wakeGeneration,
        cause: 'timeout',
        deadlineJobId,
      }),
    );

    expect(woken).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'queued',
      currentJobId: waiting.currentJobId,
      wakeGeneration: waiting.wakeGeneration,
      awaiting: waiting.awaiting,
    });

    const resumed = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.resumed',
    );

    expect(resumed?.payload).toMatchObject({
      generation: waiting.wakeGeneration,
      cause: 'settled',
    });

    const lostJob = await fx.db(
      async (tx) =>
        (
          await tx.select().from(chatJobs).where(eq(chatJobs.id, seeded.job.id))
        )[0],
    );

    expect(lostJob?.state).toBe('lost');
  });
  it('refuses suspension for every terminal status with an active attempt', async () => {
    for (const status of ['completed', 'failed', 'expired'] as const) {
      const seeded = await seedWaitingRun();
      await fx.db((tx) =>
        tx
          .update(runs)
          .set({ status, finishedAt: new Date() })
          .where(eq(runs.id, seeded.runId)),
      );

      await expect(
        fx.harness.moduleRef.get(RunWaitService).suspend(suspendInput(seeded)),
      ).resolves.toEqual({ kind: 'ready', cause: 'cancelled' });
      expect(await fx.run(seeded.runId)).toMatchObject({
        status,
        activeAttemptId: seeded.attemptId,
      });
      expect(await fx.types(seeded.runId)).not.toContain('run.suspended');
    }
  });

  it('records settled when a lost-worker batch includes any awaited job', async () => {
    const seeded = await seedWaitingRun();
    const outsideWorkerId = randomUUID();

    const outsideJob = await fx.db(async (tx) => {
      await tx.insert(workerInstances).values({ id: outsideWorkerId });

      return new ChatJobsRepository(tx).insert({
        chatId: seeded.chatId,
        ownerUserId: fx.userId,
        executor: 'bash',
        seq: 2,
        runId: seeded.runId,
        toolCallId: `call-${randomUUID()}`,
        workerInstanceId: outsideWorkerId,
        outputs: ['stdout', 'stderr'],
        artifactReadable: false,
        settings: { modelId: seeded.modelId, permissionMode: 'default' },
      });
    });

    const service = fx.harness.moduleRef.get(RunWaitService);
    await service.suspend(suspendInput(seeded));
    await fx.db((tx) =>
      tx
        .update(workerInstances)
        .set({ lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(
          inArray(workerInstances.id, [
            seeded.job.workerInstanceId,
            outsideWorkerId,
          ]),
        ),
    );

    const woke = await fx.harness.tenantDb.runAs(fx.userId, (tx) =>
      service.wakeForChatInTransaction(tx, {
        chatId: seeded.chatId,
        userId: fx.userId,
        jobId: outsideJob.id,
        kind: 'settlement',
      }),
    );

    expect(woke).toBe(true);

    const resumed = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.resumed',
    );

    expect(resumed?.payload).toMatchObject({ cause: 'settled' });
  });

  it('does not expire a resumed Run from its obsolete dead-letter identity', async () => {
    const seeded = await seedWaitingRun();
    const dispatch = fx.harness.dispatch;
    let oldJob: RunJob | undefined;

    const enqueue = vi
      .spyOn(dispatch, 'enqueueInTransaction')
      .mockImplementationOnce(async (tx, job, options) => {
        if (job.wake) oldJob = job;
        enqueue.mockRestore();

        return dispatch.enqueueInTransaction(tx, job, options);
      });

    const wait = fx.harness.moduleRef.get(RunWaitService);
    await wait.suspend(suspendInput(seeded));
    const oldWake = oldJob?.wake;

    if (!oldJob || !oldWake)
      throw new Error('Suspension did not enqueue its wake job');
    const obsoleteJob = oldJob;

    const delayEnqueue = vi
      .spyOn(dispatch, 'enqueueInTransaction')
      .mockImplementationOnce(async (tx, job, options) => {
        delayEnqueue.mockRestore();

        return dispatch.enqueueInTransaction(tx, job, {
          ...options,
          startAfter: new Date(Date.now() + 60 * 60 * 1000),
        });
      });

    const execution = fx.harness.moduleRef.get(RunExecutionService);

    const { promise: settlementGate, resolve: continueSettlement } =
      Promise.withResolvers<void>();

    const { promise: observed, resolve: notifyObserved } =
      Promise.withResolvers<void>();

    const settle = vi
      .spyOn(execution, 'settleTerminalRun')
      .mockImplementationOnce(async (input) => {
        notifyObserved();
        await settlementGate;
        settle.mockRestore();

        return execution.settleTerminalRun(input);
      });

    const worker = fx.harness.moduleRef.get(RunsWorkerService);
    const deadLetter = worker['expireDeadLetteredRun'](obsoleteJob);
    await observed;
    let resumedJobId: string | undefined;

    try {
      const woke = await fx.harness.tenantDb.runAs(fx.userId, async (tx) => {
        await new ChatJobsRepository(tx).settle(
          seeded.chatId,
          fx.userId,
          seeded.job.id,
          { state: 'succeeded', result: { exitCode: 0 } },
        );

        return wait.wakeForChatInTransaction(tx, {
          chatId: seeded.chatId,
          userId: fx.userId,
          jobId: seeded.job.id,
          kind: 'settlement',
        });
      });

      expect(woke).toBe(true);
      const resumedRun = await fx.run(seeded.runId);

      if (!resumedRun?.currentJobId)
        throw new Error('Wake did not commit a current queue identity');
      expect(resumedRun.status).toBe('queued');
      resumedJobId = resumedRun.currentJobId;
      expect(resumedJobId).not.toBe(oldWake.jobId);
    } finally {
      continueSettlement();
      await deadLetter;
    }

    const finalRun = await fx.run(seeded.runId);
    expect(finalRun?.status).toBe('queued');
    expect(finalRun?.currentJobId).toBe(resumedJobId);
    expect(finalRun?.currentJobId).not.toBe(oldWake.jobId);
    expect(finalRun?.wakeGeneration).toBe(oldWake.generation);
    expect(await fx.types(seeded.runId)).not.toContain('run.expired');
  });

  it('leaves another owner unable to suspend or wake an owned Run', async () => {
    const seeded = await seedWaitingRun();
    const foreignOwner = await createUser(fx.harness.db, 'foreign-wait-owner');
    const service = fx.harness.moduleRef.get(RunWaitService);
    const input = suspendInput(seeded);

    await expect(
      service.suspend({ ...input, userId: foreignOwner }),
    ).resolves.toEqual({ kind: 'ready', cause: 'cancelled' });
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'running_tool',
      awaiting: null,
      currentJobId: null,
      activeAttemptId: seeded.attemptId,
    });

    await service.suspend(input);
    const waiting = await fx.run(seeded.runId);

    if (!waiting) throw new Error('Owned Run disappeared');

    const woke = await fx.harness.tenantDb.runAs(foreignOwner, (tx) =>
      service.wakeInTransaction(tx, {
        runId: seeded.runId,
        userId: foreignOwner,
        generation: waiting.wakeGeneration,
        cause: 'interrupted',
      }),
    );

    expect(woke).toBe(false);
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'awaiting_jobs',
      currentJobId: waiting.currentJobId,
      wakeGeneration: waiting.wakeGeneration,
    });
    expect(await fx.types(seeded.runId)).not.toContain('run.resumed');
  });
});
