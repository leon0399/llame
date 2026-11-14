import { randomUUID } from 'node:crypto';

import { createRunForMessage } from '../chats/run-creation';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { MessagesRepository } from '../chats/messages-repository';
import { RunEventsRepository } from './runs-repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import {
  useSegmentsFixture,
  call,
  answer,
} from '../testing/run-segments.test-fixture';
import { sourceSegmentJobNoticeIds } from './job-notice-recovery';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'job-notice-regenerate.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('Regenerate restores consumed job notices', () => {
  const fx = useSegmentsFixture('job-notice-regenerate', {
    allowedTools: ['read', 'stop'],
    nativeExecutorId: 'job-notice-regenerate-host',
    maxStepsPerRun: 2,
  });

  const { db, seed, terminal, itemState, events } = fx;

  it('replays a source Run stop receipt into the Regenerate provider request but not an owner withdrawal', async () => {
    const source = await seed('Regenerate this answer');
    let consumedNoticeId = '';
    let withdrawnNoticeId = '';

    const sourceLaunch = await fx.launch(
      source,
      [
        call('stop-settled-job', 'stop', { jobs: ['job://bash-1'] }),
        answer('source completed'),
      ],
      async (stepIndex, seeded) => {
        if (stepIndex !== 0) return;

        const notice = await db(async (tx) => {
          const jobs = new ChatJobsRepository(tx);

          const job = await jobs.insert({
            chatId: seeded.chatId,
            ownerUserId: fx.userId,
            executor: 'bash',
            seq: 1,
            runId: seeded.runId,
            toolCallId: randomUUID(),
            workerInstanceId: randomUUID(),
            outputs: [],
            artifactReadable: false,
            settings: { modelId: seeded.modelId, permissionMode: 'default' },
          });

          const settled = await jobs.settle(seeded.chatId, fx.userId, job.id, {
            state: 'succeeded',
          });

          if (!settled) throw new Error('The stop fixture job did not settle.');

          const inserted = await new ChatDeliveriesRepository(
            tx,
          ).insertJobNotice(settled);

          if (!inserted)
            throw new Error('The stop fixture notice was not inserted.');

          return inserted;
        });

        consumedNoticeId = notice.id;

        const withdrawn = await db(async (tx) => {
          const jobs = new ChatJobsRepository(tx);

          const job = await jobs.insert({
            chatId: seeded.chatId,
            ownerUserId: fx.userId,
            executor: 'bash',
            seq: 2,
            runId: seeded.runId,
            toolCallId: randomUUID(),
            workerInstanceId: randomUUID(),
            outputs: [],
            artifactReadable: false,
            settings: { modelId: seeded.modelId, permissionMode: 'default' },
          });

          const settled = await jobs.settle(seeded.chatId, fx.userId, job.id, {
            state: 'succeeded',
          });

          if (!settled)
            throw new Error('The withdrawal fixture job did not settle.');
          const delivery = new ChatDeliveriesRepository(tx);
          const item = await delivery.insertJobNotice(settled);

          if (!item)
            throw new Error('The withdrawal fixture notice was not inserted.');
          await delivery.withdrawPending(seeded.chatId, item.id, fx.userId);

          return item;
        });

        withdrawnNoticeId = withdrawn.id;
      },
    );

    const sourceFinished = await terminal(source.runId);
    expect(sourceFinished.status).toBe('completed');
    expect(sourceLaunch.prompts()).toHaveLength(2);
    expect(await itemState(consumedNoticeId)).toMatchObject({
      state: 'withdrawn',
      runId: source.runId,
    });

    const completion = (await events(source.runId)).find(
      (event) => event.eventType === 'tool.completed',
    );

    expect(completion?.payload).toMatchObject({
      consumedJobNoticeIds: [consumedNoticeId],
    });
    await db(async (tx) => {
      const runEvents = new RunEventsRepository(tx);
      await runEvents.append(source.runId, 'tool.completed', {
        toolCallId: 'not-kept-tool-result',
        consumedJobNoticeIds: ['unrelated-receipt'],
      });
      await runEvents.append(source.runId, 'tool.completed', {
        toolCallId: 'owner-deleted-stop',
        consumedJobNoticeIds: [withdrawnNoticeId],
      });
    });

    const continued = await db(async (tx) => {
      const trigger = await new MessagesRepository(tx).findById(
        source.chatId,
        fx.userId,
        source.userMessage.id,
      );

      if (!trigger) throw new Error('The Continue trigger was not found.');

      const { run } = await createRunForMessage(
        tx,
        {
          userId: fx.userId,
          chatId: source.chatId,
          modelId: source.modelId,
          effort: undefined,
          permissionMode: 'default',
          targetRunId: randomUUID(),
          followUp: {
            action: 'continue',
            sourceRunId: source.runId,
            replacesUsage: true,
            keptParts: [
              {
                type: 'tool-stop',
                toolCallId: 'stop-settled-job',
                state: 'output-available',
                input: { jobs: ['job://bash-1'] },
                output: { status: 'success', text: 'stopped job' },
                outcome: 'success',
              },
              {
                type: 'tool-stop',
                toolCallId: 'owner-deleted-stop',
                state: 'output-available',
                input: { jobs: ['job://bash-3'] },
                output: { status: 'success', text: 'stopped job' },
                outcome: 'success',
              },
            ],
          },
        },
        trigger,
      );

      return run;
    });

    await fx.launch({ ...source, runId: continued.id }, [answer('continued')]);
    await terminal(continued.id);

    const regenerate = await db(async (tx) => {
      const trigger = await new MessagesRepository(tx).findById(
        source.chatId,
        fx.userId,
        source.userMessage.id,
      );

      if (!trigger) throw new Error('The Regenerate trigger was not found.');

      const { run } = await createRunForMessage(
        tx,
        {
          userId: fx.userId,
          chatId: source.chatId,
          modelId: source.modelId,
          effort: undefined,
          permissionMode: 'default',
          targetRunId: randomUUID(),
          followUp: {
            action: 'regenerate',
            sourceRunId: continued.id,
            replacesUsage: true,
            notice: true,
          },
        },
        trigger,
      );

      return run;
    });

    const receipts = await db((tx) =>
      sourceSegmentJobNoticeIds({
        tx,
        sourceRunId: continued.id,
        chatId: source.chatId,
        ownerUserId: fx.userId,
      }),
    );

    expect(receipts).toEqual([
      {
        runId: source.runId,
        deliveryIds: [consumedNoticeId, withdrawnNoticeId],
      },
    ]);

    const launch = await fx.launch({ ...source, runId: regenerate.id }, [
      call('regenerate-boundary', 'read', { path: fx.directory }),
      answer('regenerated answer'),
    ]);

    await terminal(regenerate.id);

    const requests = launch.prompts();
    expect(
      requests.some(
        (request) =>
          request.join('\n').includes('job://bash-1') &&
          request.join('\n').includes('succeeded'),
      ),
    ).toBe(true);
    expect(await itemState(consumedNoticeId)).toMatchObject({
      state: 'delivered',
      runId: regenerate.id,
    });
    expect(await itemState(withdrawnNoticeId)).toMatchObject({
      state: 'withdrawn',
      runId: null,
    });
  });
  it('does not restore an earlier Continue receipt after the source Run delivered', async () => {
    const source = await seed('Continue after a delivered segment');

    const { notice, continuedRunId } = await db(async (tx) => {
      const jobs = new ChatJobsRepository(tx);

      const job = await jobs.insert({
        chatId: source.chatId,
        ownerUserId: fx.userId,
        executor: 'bash',
        seq: 1,
        runId: source.runId,
        toolCallId: randomUUID(),
        workerInstanceId: randomUUID(),
        outputs: [],
        artifactReadable: false,
        settings: { modelId: source.modelId, permissionMode: 'default' },
      });

      const settled = await jobs.settle(source.chatId, fx.userId, job.id, {
        state: 'succeeded',
      });

      if (!settled) throw new Error('The Continue fixture job did not settle.');

      const deliveries = new ChatDeliveriesRepository(tx);
      const notice = await deliveries.insertJobNotice(settled);

      if (!notice)
        throw new Error('The Continue fixture notice was not inserted.');
      await deliveries.consumeJobNotices({
        chatId: source.chatId,
        ownerUserId: fx.userId,
        runId: source.runId,
        jobIds: [job.id],
      });
      await new RunEventsRepository(tx).append(source.runId, 'tool.completed', {
        toolCallId: 'kept-before-delivery',
        consumedJobNoticeIds: [notice.id],
      });

      const trigger = await new MessagesRepository(tx).findById(
        source.chatId,
        fx.userId,
        source.userMessage.id,
      );

      if (!trigger) throw new Error('The Continue trigger was not found.');

      const { run } = await createRunForMessage(
        tx,
        {
          userId: fx.userId,
          chatId: source.chatId,
          modelId: source.modelId,
          effort: undefined,
          permissionMode: 'default',
          targetRunId: randomUUID(),
          followUp: {
            action: 'continue',
            sourceRunId: source.runId,
            replacesUsage: true,
            keptParts: [
              {
                type: 'tool-read',
                toolCallId: 'kept-before-delivery',
                state: 'output-available',
                input: { path: '/tmp/kept-before-delivery' },
                output: { status: 'success', text: 'kept result' },
                outcome: 'success',
              },
            ],
          },
        },
        trigger,
      );

      await new RunEventsRepository(tx).append(run.id, 'run.delivered', {
        messageId: source.userMessage.id,
      });

      return { notice, continuedRunId: run.id };
    });

    const receipts = await db((tx) =>
      sourceSegmentJobNoticeIds({
        tx,
        sourceRunId: continuedRunId,
        chatId: source.chatId,
        ownerUserId: fx.userId,
      }),
    );

    expect(receipts).toEqual([]);
    expect(await itemState(notice.id)).toMatchObject({
      state: 'withdrawn',
      runId: source.runId,
    });
  });

  it('restores only kept receipts across multiple Continues', async () => {
    const source = await seed('Continue through retained results');
    const trigger = source.userMessage;

    const createContinue = async (
      sourceRunId: string,
      toolCallIds: Array<string>,
    ): Promise<string> =>
      db(async (tx) => {
        const { run } = await createRunForMessage(
          tx,
          {
            userId: fx.userId,
            chatId: source.chatId,
            modelId: source.modelId,
            effort: undefined,
            permissionMode: 'default',
            targetRunId: randomUUID(),
            followUp: {
              action: 'continue',
              sourceRunId,
              replacesUsage: true,
              keptParts: toolCallIds.map((toolCallId) => ({
                type: 'tool-read',
                toolCallId,
                state: 'output-available',
                input: { path: `/tmp/${toolCallId}` },
                output: { status: 'success', text: toolCallId },
              })),
            },
          },
          trigger,
        );

        return run.id;
      });

    const firstContinueId = await createContinue(source.runId, [
      'base-kept-tool',
    ]);

    const secondContinueId = await createContinue(firstContinueId, [
      'first-kept-tool',
      'base-kept-tool',
    ]);

    await db(async (tx) => {
      const log = new RunEventsRepository(tx);
      await log.append(source.runId, 'tool.completed', {
        toolCallId: 'base-kept-tool',
        consumedJobNoticeIds: ['base-kept-receipt'],
      });
      await log.append(source.runId, 'tool.completed', {
        toolCallId: 'base-discarded-tool',
        consumedJobNoticeIds: ['base-discarded-receipt'],
      });
      await log.append(firstContinueId, 'tool.completed', {
        toolCallId: 'first-kept-tool',
        consumedJobNoticeIds: ['first-kept-receipt'],
      });
      await log.append(firstContinueId, 'tool.completed', {
        toolCallId: 'first-discarded-tool',
        consumedJobNoticeIds: ['first-discarded-receipt'],
      });
    });

    const receipts = await db((tx) =>
      sourceSegmentJobNoticeIds({
        tx,
        sourceRunId: secondContinueId,
        chatId: source.chatId,
        ownerUserId: fx.userId,
      }),
    );

    expect(receipts).toEqual([
      { runId: firstContinueId, deliveryIds: ['first-kept-receipt'] },
      { runId: source.runId, deliveryIds: ['base-kept-receipt'] },
    ]);
  });
});
