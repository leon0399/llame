import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { runs, type AwaitingQuota } from '../db/schema';
import { clearActiveRunSlot } from '../chats/chat-admission';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { recordJobSettlementNotice } from '../jobs/job-notices';
import {
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';
import { RunsController } from './runs.controller';
import { RUNS_QUEUE } from './run-queues';
import { RunWaitService } from './run-wait.service';
import { retryRunTransaction } from './run-transaction';
import { createUser, seedLiveChatJob } from './worker-harness';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'quota-wait.integration.test.ts requires the integration database',
  );
}

describe('quota wait lifecycle persistence', () => {
  const queueSchema = `quota_wait_${randomUUID().replaceAll('-', '')}`;

  const fx = useSegmentsFixture('quota-wait', {
    allowedTools: [],
    runsConcurrency: null,
    queueSchema,
  });

  async function seedActiveRun(): Promise<QuotaTestRun> {
    const seeded = await fx.seed();
    const attemptId = randomUUID();
    await fx.db((tx) =>
      tx
        .update(runs)
        .set({ status: 'running_model', activeAttemptId: attemptId })
        .where(eq(runs.id, seeded.runId)),
    );

    return { ...seeded, attemptId };
  }

  type QuotaTestRun = SeededRun & { attemptId: string };

  function quotaWait(
    wakeAt = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
  ): AwaitingQuota {
    const resetsAt = new Date(
      Date.now() + 8 * 24 * 60 * 60 * 1000 - 70_000,
    ).toISOString();

    return {
      kind: 'quota',
      failureClass: 'quota_exhausted',
      resetsAt,
      wakeAt,
      resumeAt: 'request',
      waitCount: 1,
    };
  }

  async function suspend(seeded: QuotaTestRun, awaiting = quotaWait()) {
    return fx.harness.moduleRef.get(RunWaitService).suspendForQuota({
      runId: seeded.runId,
      chatId: seeded.chatId,
      userId: fx.userId,
      attemptId: seeded.attemptId,
      awaiting,
      parts: [{ type: 'text', text: 'checkpoint before failed send' }],
      steps: { 'step-1': 2 },
    });
  }

  it('attempt-fences the checkpoint and persists its exact quota job identity', async () => {
    const seeded = await seedActiveRun();
    const wrongAttempt = { ...seeded, attemptId: randomUUID() };

    await expect(suspend(wrongAttempt)).resolves.toEqual({
      kind: 'ready',
      cause: 'cancelled',
    });
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'running_model',
    });
    expect(await fx.types(seeded.runId)).not.toContain('run.suspended');

    const awaiting = quotaWait();
    await expect(suspend(seeded, awaiting)).resolves.toEqual({
      kind: 'suspended',
    });
    const run = await fx.run(seeded.runId);
    expect(run).toMatchObject({
      status: 'awaiting_quota',
      awaiting,
      wakeGeneration: 1,
      activeAttemptId: null,
    });

    if (!run?.currentJobId)
      throw new Error('Quota wait did not persist its deadline job');
    expect(await fx.harness.queue.jobState(RUNS_QUEUE, run.currentJobId)).toBe(
      'queued',
    );
    expect(
      (await fx.events(seeded.runId)).filter(
        (event) => event.eventType === 'run.suspended',
      ),
    ).toMatchObject([
      {
        eventType: 'run.suspended',
        payload: {
          kind: 'quota',
          attemptId: seeded.attemptId,
          generation: 1,
          failureClass: awaiting.failureClass,
          resetsAt: awaiting.resetsAt,
          wakeAt: awaiting.wakeAt,
          resumeAt: awaiting.resumeAt,
          waitCount: awaiting.waitCount,
          parts: [{ type: 'text', text: 'checkpoint before failed send' }],
          steps: { 'step-1': 2 },
        },
      },
    ]);

    const [{ start_after: startAfter, keep_until: keepUntil }] = z
      .tuple([
        z.object({ start_after: z.coerce.date(), keep_until: z.coerce.date() }),
      ])
      .parse(
        await fx.harness.db.execute(sql`
      SELECT start_after, keep_until FROM ${sql.identifier(queueSchema)}.job WHERE id = ${run.currentJobId}
    `),
      );

    expect(startAfter.toISOString()).toBe(awaiting.wakeAt);
    expect(keepUntil.getTime()).toBeGreaterThan(startAfter.getTime());
  });

  it('lets cancellation and the due deadline race to one resume event', async () => {
    const seeded = await seedActiveRun();
    const awaiting = quotaWait(new Date(Date.now() - 1000).toISOString());
    await suspend(seeded, awaiting);
    const waiting = await fx.run(seeded.runId);

    if (!waiting?.currentJobId)
      throw new Error('Quota wait did not persist its deadline job');

    const controller = fx.harness.moduleRef.get(RunsController, {
      strict: false,
    });

    await Promise.all([
      controller.updateRun(fx.userId, seeded.runId, { status: 'cancelled' }),
      retryRunTransaction(() =>
        fx.db((tx) =>
          fx.harness.moduleRef.get(RunWaitService).wakeInTransaction(tx, {
            runId: seeded.runId,
            userId: fx.userId,
            generation: waiting.wakeGeneration,
            cause: 'timeout',
            deadlineJobId: waiting.currentJobId!,
          }),
        ),
      ),
    ]);
    const events = await fx.events(seeded.runId);
    expect(
      events.filter((event) => event.eventType === 'run.resumed'),
    ).toHaveLength(1);
    expect(await fx.run(seeded.runId)).toMatchObject({ status: 'queued' });
  });

  it('keeps steering, interrupt, and job notices pending and rejects a plain send', async () => {
    const seeded = await seedActiveRun();
    await suspend(seeded);

    const steerIds = await fx.storeItems(
      seeded.chatId,
      ['steer'],
      'steer',
      seeded.runId,
    );

    const interruptIds = await fx.storeItems(
      seeded.chatId,
      ['interrupt'],
      'interrupt',
      seeded.runId,
    );

    const job = await fx.db((tx) =>
      seedLiveChatJob({
        tx,
        userId: fx.userId,
        modelId: seeded.modelId,
        run: seeded,
      }),
    );

    await fx.db((tx) => recordJobSettlementNotice(tx, job));

    expect(await fx.itemState(steerIds[0])).toMatchObject({
      state: 'pending',
      mode: 'steer',
    });
    expect(await fx.itemState(interruptIds[0])).toMatchObject({
      state: 'pending',
      mode: 'interrupt',
    });

    const notices = await fx.db((tx) =>
      new ChatDeliveriesRepository(tx).listPending(seeded.chatId, fx.userId),
    );

    expect(
      notices.some(
        (notice) => notice.mode === 'notice' && notice.state === 'pending',
      ),
    ).toBe(true);
    await expect(
      fx.db((tx) =>
        clearActiveRunSlot({
          tx,
          chatId: seeded.chatId,
          userId: fx.userId,
          dispatch: fx.harness.dispatch,
          instanceConfig: fx.harness.moduleRef.get(InstanceConfigService, {
            strict: false,
          }),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'awaiting_quota',
    });
  });
  it('does not expose an awaiting quota Run to another owner', async () => {
    const seeded = await seedActiveRun();
    await suspend(seeded);

    const otherUserId = await createUser(
      fx.harness.db,
      'quota-wait-other-owner',
    );

    const controller = fx.harness.moduleRef.get(RunsController, {
      strict: false,
    });

    await expect(
      controller.getRun(otherUserId, seeded.runId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
