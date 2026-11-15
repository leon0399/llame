import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { chatJobs, runs, workerInstances, type ChatJob } from '../db/schema';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { recordJobSettlementNotice } from '../jobs/job-notices';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  clearActiveRunSlot,
  claimActiveRunSlot,
} from '../chats/chat-admission';
import { RunWaitService } from './run-wait.service';
import { RunEnqueueCollisionError } from './run-enqueue-collision-error';
import { RUNS_QUEUE } from './run-queues';
import {
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'run-wait-durability.integration.test.ts requires the integration database',
  );
}

type SeededWaitingRun = SeededRun & { attemptId: string; job: ChatJob };

describe('Run wait durable wake publication', () => {
  const fx = useSegmentsFixture('run-wait-durability', { allowedTools: [] });
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

  it('blocks a plain-send admission while its recorded wait job remains queued', async () => {
    const seeded = await seedWaitingRun();
    await fx.harness.moduleRef
      .get(RunWaitService)
      .suspend(suspendInput(seeded));
    const waiting = await fx.run(seeded.runId);

    if (!waiting?.currentJobId) throw new Error('Run did not suspend');
    expect(
      await fx.harness.queue.jobState(RUNS_QUEUE, waiting.currentJobId),
    ).toBe('queued');

    await expect(
      fx.harness.tenantDb.runAs(fx.userId, (tx) =>
        clearActiveRunSlot({
          tx,
          chatId: seeded.chatId,
          userId: fx.userId,
          dispatch: fx.harness.dispatch,
          instanceConfig: fx.harness.moduleRef.get(InstanceConfigService),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await fx.run(seeded.runId))?.status).toBe('awaiting_jobs');
  });

  it('expires an awaiting Run immediately when its recorded current job is absent', async () => {
    const seeded = await seedWaitingRun();
    await fx.harness.moduleRef
      .get(RunWaitService)
      .suspend(suspendInput(seeded));
    const missingId = randomUUID();
    await fx.db((tx) =>
      tx
        .update(runs)
        .set({ currentJobId: missingId })
        .where(eq(runs.id, seeded.runId)),
    );
    expect(await fx.harness.queue.jobState(RUNS_QUEUE, missingId)).toBe(
      'absent',
    );

    const result = await fx.harness.tenantDb.runAs(fx.userId, (tx) =>
      claimActiveRunSlot({
        tx,
        chatId: seeded.chatId,
        userId: fx.userId,
        dispatch: fx.harness.dispatch,
        instanceConfig: fx.harness.moduleRef.get(InstanceConfigService),
      }),
    );

    expect(result).toBe('free');
    expect(await fx.run(seeded.runId)).toMatchObject({ status: 'expired' });
    expect(await fx.types(seeded.runId)).toContain('run.expired');
  });
  it('commits the deadline job to pg-boss and makes a stale deadline delivery a no-op', async () => {
    const seeded = await seedWaitingRun();
    const service = fx.harness.moduleRef.get(RunWaitService);
    await expect(service.suspend(suspendInput(seeded))).resolves.toEqual({
      kind: 'suspended',
    });

    const waiting = await fx.run(seeded.runId);

    if (!waiting?.currentJobId) throw new Error('Run did not suspend');
    const deadlineJobId = waiting.currentJobId;
    expect(waiting.status).toBe('awaiting_jobs');
    expect(
      await fx.harness.queue.jobState(RUNS_QUEUE, waiting.currentJobId),
    ).toBe('queued');

    const stale = await fx.harness.tenantDb.runAs(fx.userId, (tx) =>
      service.wakeInTransaction(tx, {
        runId: seeded.runId,
        userId: fx.userId,
        generation: waiting.wakeGeneration - 1,
        cause: 'timeout',
        deadlineJobId,
      }),
    );

    expect(stale).toBe(false);
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'awaiting_jobs',
      currentJobId: waiting.currentJobId,
      wakeGeneration: waiting.wakeGeneration,
    });
    expect(await fx.types(seeded.runId)).not.toContain('run.resumed');
  });

  it('publishes the wake to pg-boss and persists that exact id as current', async () => {
    const seeded = await seedWaitingRun();
    const service = fx.harness.moduleRef.get(RunWaitService);
    await service.suspend(suspendInput(seeded));
    const waiting = await fx.run(seeded.runId);

    if (!waiting?.currentJobId) throw new Error('Run did not suspend');

    expect(
      await fx.harness.tenantDb.runAs(fx.userId, (tx) =>
        service.wakeInTransaction(tx, {
          runId: seeded.runId,
          userId: fx.userId,
          generation: waiting.wakeGeneration,
          cause: 'interrupted',
        }),
      ),
    ).toBe(true);

    const resumed = await fx.run(seeded.runId);

    if (!resumed?.currentJobId)
      throw new Error('Wake has no current queue job');
    expect(resumed.wakeGeneration).toBe(waiting.wakeGeneration);
    expect(resumed.currentJobId).not.toBe(waiting.currentJobId);
    expect(
      await fx.harness.queue.jobState(RUNS_QUEUE, resumed.currentJobId),
    ).not.toBe('absent');
    expect(await fx.types(seeded.runId)).toContain('run.resumed');
  });

  it('retries an actual pg-boss id collision with a newly generated id', async () => {
    const seeded = await seedWaitingRun();
    const dispatch = fx.harness.dispatch;
    const ids: Array<string> = [];

    const enqueue = vi
      .spyOn(dispatch, 'enqueueInTransaction')
      .mockImplementationOnce(async (tx, job, options) => {
        ids.push(options?.id ?? job.runId);
        enqueue.mockRestore();
        await dispatch.enqueueInTransaction(tx, job, options);
        await dispatch.enqueueInTransaction(tx, job, options);
      });

    await expect(
      fx.harness.moduleRef.get(RunWaitService).suspend(suspendInput(seeded)),
    ).resolves.toEqual({ kind: 'suspended' });

    const waiting = await fx.run(seeded.runId);

    if (!waiting?.currentJobId)
      throw new Error('Suspended Run has no current queue job');
    expect(ids).toHaveLength(1);
    expect(waiting.currentJobId).not.toBe(ids[0]);
    expect(
      await fx.harness.queue.jobState(RUNS_QUEUE, waiting.currentJobId),
    ).not.toBe('absent');
    expect(await fx.types(seeded.runId)).toContain('run.suspended');
  });

  it('rolls back job settlement and its notice when wake publication cannot succeed', async () => {
    const seeded = await seedWaitingRun();
    const service = fx.harness.moduleRef.get(RunWaitService);
    await service.suspend(suspendInput(seeded));
    const waiting = await fx.run(seeded.runId);

    if (!waiting?.currentJobId) throw new Error('Run did not suspend');

    const dispatch = fx.harness.dispatch;

    const enqueue = vi
      .spyOn(dispatch, 'enqueueInTransaction')
      .mockImplementationOnce(async (tx, job, options) => {
        enqueue.mockRestore();
        await dispatch.enqueueInTransaction(tx, job, options);
        await dispatch.enqueueInTransaction(tx, job, options);
      });

    await expect(
      fx.harness.tenantDb.runAs(fx.userId, async (tx) => {
        await new ChatJobsRepository(tx).settle(
          seeded.chatId,
          fx.userId,
          seeded.job.id,
          { state: 'succeeded', result: { exitCode: 0 } },
        );

        const [job] = await tx
          .select()
          .from(chatJobs)
          .where(eq(chatJobs.id, seeded.job.id));

        if (!job) throw new Error('Settled job disappeared');
        await recordJobSettlementNotice(tx, job);

        return service.wakeForChatInTransaction(tx, {
          chatId: seeded.chatId,
          userId: fx.userId,
          jobId: seeded.job.id,
          kind: 'settlement',
        });
      }),
    ).rejects.toThrow(RunEnqueueCollisionError);

    const [storedJob] = await fx.db((tx) =>
      tx.select().from(chatJobs).where(eq(chatJobs.id, seeded.job.id)),
    );

    expect(storedJob?.state).toBe('running');

    const pending = await fx.db((tx) =>
      new ChatDeliveriesRepository(tx).listPending(seeded.chatId, fx.userId),
    );

    expect(
      pending.filter((delivery) => delivery.senderRef === seeded.job.id),
    ).toHaveLength(0);
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'awaiting_jobs',
      currentJobId: waiting.currentJobId,
    });
    expect(await fx.types(seeded.runId)).not.toContain('run.resumed');
  });
});
