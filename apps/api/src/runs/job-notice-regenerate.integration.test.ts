import { randomUUID } from 'node:crypto';

import { createRunForMessage } from '../chats/run-creation';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { MessagesRepository } from '../chats/chats-repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import {
  useSegmentsFixture,
  call,
  answer,
} from '../testing/run-segments.test-fixture';

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
            sourceRunId: source.runId,
            replacesUsage: true,
            notice: true,
          },
        },
        trigger,
      );

      return { ...source, runId: run.id };
    });

    const launch = await fx.launch(regenerate, [
      call('regenerate-boundary', 'read', { path: fx.directory }),
      answer('regenerated answer'),
    ]);

    await terminal(regenerate.runId);
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
      runId: regenerate.runId,
    });
    expect(await itemState(withdrawnNoticeId)).toMatchObject({
      state: 'withdrawn',
      runId: null,
    });
  });
});
