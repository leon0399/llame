import { randomUUID } from 'node:crypto';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import {
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';
import { deliverPendingSteering } from './segment-delivery';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { createUser } from './worker-harness';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'job-notice-terminal.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('terminal job notice recovery', () => {
  const fx = useSegmentsFixture('job-notice-terminal', {
    allowedTools: ['read', 'bash', 'stop'],
    nativeExecutorId: 'job-notice-terminal-host',
    maxStepsPerRun: 2,
  });

  const { db, seed, itemState, run } = fx;

  async function insertSettledNotice(seeded: SeededRun, seq = 1) {
    return db(async (tx) => {
      const jobs = new ChatJobsRepository(tx);

      const job = await jobs.insert({
        chatId: seeded.chatId,
        ownerUserId: fx.userId,
        executor: 'bash',
        seq,
        runId: seeded.runId,
        toolCallId: randomUUID(),
        workerInstanceId: randomUUID(),
        outputs: [],
        artifactReadable: false,
        settings: { modelId: seeded.modelId, permissionMode: 'default' },
      });

      const settled = await jobs.settle(seeded.chatId, fx.userId, job.id, {
        state: 'failed',
        result: { exitCode: 2 },
      });

      if (!settled) throw new Error('The test job did not settle.');

      const notice = await new ChatDeliveriesRepository(tx).insertJobNotice(
        settled,
      );

      if (!notice) throw new Error('The test job notice was not inserted.');

      return { job: settled, notice };
    });
  }

  async function deliverNotice(seeded: SeededRun) {
    const started = await db((tx) =>
      new RunsRepository(tx).markStarted(seeded.runId, fx.userId),
    );

    if (!started?.activeAttemptId) throw new Error('The Run did not start.');

    const delivery = await db((tx) =>
      deliverPendingSteering(tx, {
        run: { runId: seeded.runId, userId: fx.userId },
        attemptId: started.activeAttemptId ?? '',
        models: [],
      }),
    );

    if (delivery.kind !== 'delivered' || delivery.cause !== 'notice') {
      throw new Error('The notice did not cross the segment boundary.');
    }

    return delivery;
  }

  it('returns a committed boundary notice when cancellation wins before first dispatch', async () => {
    const seeded = await seed();
    const { notice } = await insertSettledNotice(seeded);
    const delivery = await deliverNotice(seeded);

    expect(await itemState(notice.id)).toMatchObject({
      state: 'delivered',
      runId: seeded.runId,
      deliveredMessageId: delivery.message.id,
    });

    const finished = await db((tx) =>
      new RunsRepository(tx).markFinished(seeded.runId, fx.userId, 'cancelled'),
    );

    expect(finished?.status).toBe('cancelled');
    expect(await itemState(notice.id)).toMatchObject({
      state: 'pending',
      runId: null,
      deliveredMessageId: null,
    });

    // A stale terminal callback and a different owner cannot change the return.
    await expect(
      db((tx) =>
        new RunsRepository(tx).markFinished(seeded.runId, fx.userId, 'failed'),
      ),
    ).resolves.toBeUndefined();
    const foreignUserId = await createUser(fx.harness.db, 'job-notice-foreign');
    await fx.harness.tenantDb.runAs(foreignUserId, (tx) =>
      new RunsRepository(tx).markFinished(
        seeded.runId,
        foreignUserId,
        'failed',
      ),
    );
    expect(await itemState(notice.id)).toMatchObject({ state: 'pending' });
  });

  it('returns a boundary notice after preparation failure but preserves dispatched notices and withdrawals', async () => {
    const seeded = await seed();
    const { notice } = await insertSettledNotice(seeded);
    const withdrawn = await insertSettledNotice(seeded, 2);
    await db((tx) =>
      new ChatDeliveriesRepository(tx).consumeJobNotices({
        chatId: seeded.chatId,
        ownerUserId: fx.userId,
        runId: seeded.runId,
        jobIds: [withdrawn.job.id],
      }),
    );

    const delivery = await deliverNotice(seeded);
    expect(delivery.kind).toBe('delivered');

    // This models a request that reached model.requested after boundary delivery.
    await db((tx) =>
      new RunEventsRepository(tx).append(seeded.runId, 'model.requested', {
        modelId: seeded.modelId,
        attemptId: delivery.kind === 'delivered' ? delivery.attemptId : '',
      }),
    );
    await db((tx) =>
      new RunsRepository(tx).markFinished(seeded.runId, fx.userId, 'failed'),
    );
    expect(await itemState(notice.id)).toMatchObject({
      state: 'delivered',
      deliveredMessageId: delivery.message.id,
    });
    expect(await itemState(withdrawn.notice.id)).toMatchObject({
      state: 'withdrawn',
      runId: seeded.runId,
    });

    // A second delivered notice on a fresh Run fails during preparation, before
    // model.requested, and must be put back into the owner's pending queue.
    const failed = await seed('preparation failure');
    const failedNotice = await insertSettledNotice(failed);
    const failedDelivery = await deliverNotice(failed);
    await db((tx) =>
      new RunsRepository(tx).markFinished(failed.runId, fx.userId, 'failed'),
    );
    expect(await itemState(failedNotice.notice.id)).toMatchObject({
      state: 'pending',
      runId: null,
      deliveredMessageId: null,
    });
    expect((await run(failed.runId))?.messageId).toBe(
      failedDelivery.kind === 'delivered'
        ? failedDelivery.message.id
        : undefined,
    );
  });

  it('keeps the current-trigger notice delivered after the current segment dispatches', async () => {
    const seeded = await seed('dispatch before terminal');
    const { notice } = await insertSettledNotice(seeded);
    const delivery = await deliverNotice(seeded);
    await db((tx) =>
      new RunEventsRepository(tx).append(seeded.runId, 'model.requested', {
        modelId: seeded.modelId,
        attemptId: delivery.kind === 'delivered' ? delivery.attemptId : '',
      }),
    );

    await db((tx) =>
      new RunsRepository(tx).markFinished(seeded.runId, fx.userId, 'failed'),
    );
    expect(await itemState(notice.id)).toMatchObject({
      state: 'delivered',
      deliveredMessageId:
        delivery.kind === 'delivered' ? delivery.message.id : undefined,
    });
  });
});
