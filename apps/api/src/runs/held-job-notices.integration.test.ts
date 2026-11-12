import { eq } from 'drizzle-orm';
import { chatJobs } from '../db/schema';
import { FollowUpAdmissionService } from '../chats/follow-up-admission.service';
import { JobNoticeRunService } from './job-notice-run.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { MediaService } from '../media/media.service';
import { ChatLoopService } from '../chats/chat-loop.service';
import { settleBashJob } from '../jobs/bash-job-store';
import { RunsRepository } from './runs-repository';
import { randomUUID } from 'node:crypto';
import { ChatDeliveriesService } from '../chats/chat-deliveries.service';
import { promoteNextQueueItem } from './queue-promotion';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { type ChatJob } from '../db/schema';
import {
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'held-job-notices.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

describe('held job notices', () => {
  const fx = useSegmentsFixture('held-job-notices', { allowedTools: [] });

  async function settledJob(
    chatId: string,
    runId: string,
    modelId = 'held-job-notice',
    seq = 1,
  ): Promise<ChatJob> {
    const inserted = await fx.db((tx) =>
      new ChatJobsRepository(tx).insert({
        chatId,
        ownerUserId: fx.userId,
        executor: 'bash',
        seq,
        runId,
        toolCallId: `held-${randomUUID()}`,
        workerInstanceId: randomUUID(),
        startedAt: new Date(),
        outputs: [],
        artifactReadable: false,
        settings: { modelId, permissionMode: 'default' },
      }),
    );

    await settleBashJob(
      fx.harness.tenantDb,
      inserted,
      {
        output: {
          stdout: 'settled output that belongs before the owner text',
          stderr: '',
          truncated: false,
          truncatedStreams: { stdout: false, stderr: false },
        },
        settlement: { state: 'failed', result: { exitCode: 1 } },
        offsets: { stdout: 0, stderr: 0 },
      },
      {
        maxBytes: 65_536,
        hostFiles: false,
        noticeRuns: fx.harness.moduleRef.get(JobNoticeRunService),
      },
    );

    const settled = await fx.db((tx) =>
      new ChatJobsRepository(tx).findById(chatId, fx.userId, inserted.id),
    );

    if (!settled) throw new Error('Could not read settled test job.');

    return settled;
  }

  async function noticeForJob(chatId: string, jobId: string) {
    return fx.db(async (tx) =>
      (
        await new ChatDeliveriesRepository(tx).listPending(chatId, fx.userId)
      ).find(({ senderRef }) => senderRef === jobId),
    );
  }

  async function queueItem(seeded: SeededRun, mode: 'queue' | 'steer') {
    const item = await fx.db((tx) =>
      new ChatDeliveriesRepository(tx).insertPending({
        id: randomUUID(),
        chatId: seeded.chatId,
        ownerUserId: fx.userId,
        mode,
        parts: [{ type: 'text', text: `queued ${mode} item` }],
        settings: {
          modelId: seeded.modelId,
          permissionMode: 'default',
        },
      }),
    );

    if (!item) throw new Error('Could not create the test delivery.');

    return item;
  }

  it('locks the first notice and bulk-adopts all pending settled notices', async () => {
    const seeded = await fx.seed('original owner request');

    const firstJob = await settledJob(seeded.chatId, seeded.runId);

    const secondJob = await settledJob(
      seeded.chatId,
      seeded.runId,
      undefined,
      2,
    );

    const notice = await noticeForJob(seeded.chatId, firstJob.id);
    const secondNotice = await noticeForJob(seeded.chatId, secondJob.id);

    if (!notice || !secondNotice)
      throw new Error('Settlement did not create the test notices.');

    const held = await fx.db((tx) =>
      new ChatDeliveriesRepository(tx).lockFirstPendingJobNotice(
        seeded.chatId,
        fx.userId,
      ),
    );

    expect(held).toMatchObject({ id: notice.id });

    const messageId = randomUUID();
    const runId = randomUUID();
    await fx.db((tx) =>
      new ChatDeliveriesRepository(tx).deliverPendingJobNotices(
        seeded.chatId,
        fx.userId,
        { messageId, runId },
      ),
    );

    expect(await fx.itemState(notice.id)).toMatchObject({
      state: 'delivered',
      deliveredMessageId: messageId,
      runId,
    });
    expect(await fx.itemState(secondNotice.id)).toMatchObject({
      state: 'delivered',
      deliveredMessageId: messageId,
      runId,
    });
    expect(
      await fx.db((tx) =>
        new ChatDeliveriesRepository(tx).lockFirstPendingJobNotice(
          seeded.chatId,
          fx.userId,
        ),
      ),
    ).toBeUndefined();
  });

  it('does not adopt notices through a different owner identity', async () => {
    const seeded = await fx.seed('owner-scoped request');
    const job = await settledJob(seeded.chatId, seeded.runId);
    const notice = await noticeForJob(seeded.chatId, job.id);

    if (!notice) throw new Error('Settlement did not create the test notice.');

    const otherOwner = randomUUID();

    const otherRows = await fx.harness.tenantDb.runAs(otherOwner, (tx) =>
      new ChatDeliveriesRepository(tx).lockFirstPendingJobNotice(
        seeded.chatId,
        otherOwner,
      ),
    );

    expect(otherRows).toBeUndefined();
    expect(await fx.itemState(notice.id)).toMatchObject({ state: 'pending' });
  });

  it('adopts a cancelled-run notice on the owner send before provider history', async () => {
    const seeded = await fx.seed('request that was cancelled');
    await fx.db((tx) =>
      new RunsRepository(tx).markFinished(seeded.runId, fx.userId, 'cancelled'),
    );
    const job = await settledJob(seeded.chatId, seeded.runId);
    const notice = await noticeForJob(seeded.chatId, job.id);

    if (!notice) throw new Error('Settlement did not create the test notice.');

    const modelId = `held-owner-send-${randomUUID()}`;
    fx.harness.models.register(modelId, {
      kind: 'complete',
      text: 'owner request completed',
    });

    const loop = new ChatLoopService(
      fx.harness.tenantDb,
      fx.harness.models,
      { config: BUILT_IN_DEFAULTS },
      { createUiMessageStreamResponse: () => new Response() },
      fx.harness.dispatch,
      new MediaService(fx.harness.tenantDb),
    );

    const ownerText = 'owner text after the completed background job';
    await loop.createMessageStream({
      chatId: seeded.chatId,
      userId: fx.userId,
      modelId,
      message: { id: randomUUID(), parts: [{ type: 'text', text: ownerText }] },
    });

    const ownerMessage = (await fx.messages(seeded.chatId)).find(({ parts }) =>
      JSON.stringify(parts).includes(ownerText),
    );

    if (!ownerMessage) throw new Error('Owner message was not persisted.');

    const ownerRun = (
      await fx.db((tx) =>
        new RunsRepository(tx).findByChatId(seeded.chatId, fx.userId),
      )
    ).find(({ messageId }) => messageId === ownerMessage.id);

    if (!ownerRun) throw new Error('Owner Run was not persisted.');

    await fx.terminal(ownerRun.id);
    const stored = await fx.itemState(notice.id);
    const prompt = JSON.stringify(fx.harness.models.prompts.at(-1));

    expect(stored).toMatchObject({
      state: 'delivered',
      deliveredMessageId: ownerMessage.id,
      runId: ownerRun.id,
    });
    expect(prompt.indexOf('job://bash-1')).toBeGreaterThanOrEqual(0);
    expect(prompt.indexOf('job://bash-1')).toBeLessThan(
      prompt.indexOf(ownerText),
    );
  });

  it('promotes a queued item despite a notice alone and adopts the notice', async () => {
    const seeded = await fx.seed('queue promotion base');
    const job = await settledJob(seeded.chatId, seeded.runId);
    const notice = await noticeForJob(seeded.chatId, job.id);

    if (!notice) throw new Error('Settlement did not create the test notice.');
    const item = await queueItem(seeded, 'queue');
    fx.harness.models.register(seeded.modelId, { kind: 'complete' });

    const completed = await fx.db((tx) =>
      new RunsRepository(tx).markFinished(seeded.runId, fx.userId, 'completed'),
    );

    if (!completed) throw new Error('Could not complete the base Run.');

    const promoted = await fx.db((tx) =>
      promoteNextQueueItem(tx, {
        completed,
        models: fx.harness.models,
        enabledPermissionModes: ['default'],
      }),
    );

    if (!promoted) throw new Error('The queued item was not promoted.');

    await fx.harness.dispatch.dispatch(promoted);
    await fx.terminal(promoted.runId);

    expect(await fx.itemState(item.id)).toMatchObject({
      state: 'delivered',
      runId: promoted.runId,
    });
    expect(await fx.itemState(notice.id)).toMatchObject({
      state: 'delivered',
      deliveredMessageId: item.id,
      runId: promoted.runId,
    });
    const prompt = JSON.stringify(fx.harness.models.prompts.at(-1));
    expect(prompt).toContain('job://bash-1');
  });

  it('adopts held notices when an owner changes a pending queue item to steer', async () => {
    const seeded = await fx.seed('mode change base');
    const job = await settledJob(seeded.chatId, seeded.runId);
    const notice = await noticeForJob(seeded.chatId, job.id);

    if (!notice) throw new Error('Settlement did not create the test notice.');
    const item = await queueItem(seeded, 'queue');
    fx.harness.models.register(seeded.modelId, { kind: 'complete' });

    const completed = await fx.db((tx) =>
      new RunsRepository(tx).markFinished(seeded.runId, fx.userId, 'completed'),
    );

    if (!completed) throw new Error('Could not complete the base Run.');

    const deliveries = new ChatDeliveriesService(
      fx.harness.tenantDb,
      fx.harness.models,
      { config: BUILT_IN_DEFAULTS },
      fx.harness.dispatch,
    );

    const changed = await deliveries.changeMode(
      seeded.chatId,
      item.id,
      'steer',
      fx.userId,
    );

    const runId = changed.item.runId;

    if (!runId) throw new Error('Mode change did not start its Run.');
    await fx.terminal(runId);

    expect(changed.item).toMatchObject({ state: 'delivered', mode: 'steer' });
    expect(await fx.itemState(notice.id)).toMatchObject({
      state: 'delivered',
      deliveredMessageId: item.id,
      runId,
    });
    const prompt = JSON.stringify(fx.harness.models.prompts.at(-1));
    expect(prompt).toContain('job://bash-1');
  });
  it('returns an adopted notice when enqueue fails before the first dispatch', async () => {
    const seeded = await fx.seed('dispatch failure base');
    await fx.db((tx) =>
      new RunsRepository(tx).markFinished(seeded.runId, fx.userId, 'cancelled'),
    );
    const job = await settledJob(seeded.chatId, seeded.runId);
    const notice = await noticeForJob(seeded.chatId, job.id);

    if (!notice) throw new Error('Settlement did not create the test notice.');
    const modelId = `held-dispatch-failure-${randomUUID()}`;
    fx.harness.models.register(modelId, { kind: 'complete' });

    const loop = new ChatLoopService(
      fx.harness.tenantDb,
      fx.harness.models,
      { config: BUILT_IN_DEFAULTS },
      { createUiMessageStreamResponse: () => new Response() },
      {
        dispatch: () => Promise.reject(new Error('queue unavailable')),
        jobState: () => Promise.resolve('absent'),
      },
      new MediaService(fx.harness.tenantDb),
    );

    await expect(
      loop.createMessageStream({
        chatId: seeded.chatId,
        userId: fx.userId,
        modelId,
        message: {
          id: randomUUID(),
          parts: [{ type: 'text', text: 'request before any dispatch' }],
        },
      }),
    ).rejects.toThrow('queue unavailable');

    const ownerRun = (
      await fx.db((tx) =>
        new RunsRepository(tx).findByChatId(seeded.chatId, fx.userId),
      )
    ).find(({ messageId }) => messageId !== seeded.userMessage.id);

    if (!ownerRun) throw new Error('Accepted Run was not persisted.');

    const terminal = await fx.db((tx) =>
      new RunsRepository(tx).markFinished(ownerRun.id, fx.userId, 'cancelled'),
    );

    if (!terminal) throw new Error('Run did not become terminal.');
    await fx.db((tx) =>
      new ChatDeliveriesRepository(tx).returnUndispatchedJobNotices(terminal),
    );

    expect(await fx.itemState(notice.id)).toMatchObject({
      state: 'pending',
      runId: null,
      deliveredMessageId: null,
    });
  });

  it('admits Continue from a real host-started senderless Run', async () => {
    const seeded = await fx.seed('completed owner turn');
    await fx.db((tx) =>
      new RunsRepository(tx).markFinished(seeded.runId, fx.userId, 'completed'),
    );
    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [
        [
          {
            type: 'text',
            id: 'partial-host-answer',
            text: 'Host kept this partial answer before failure.',
          },
          { type: 'error', message: 'host provider failed after partial text' },
        ],
      ],
    });

    // Settlement of a job after a completed owner Run commits the host trigger,
    // notice delivery, and queued host Run through the production service.
    const job = await settledJob(seeded.chatId, seeded.runId, seeded.modelId);

    const runs = await fx.db((tx) =>
      new RunsRepository(tx).findByChatId(seeded.chatId, fx.userId),
    );

    const hostRun = runs.find(
      ({ messageId }) =>
        messageId !== null && messageId !== seeded.userMessage.id,
    );

    if (!hostRun?.messageId)
      throw new Error(`Settlement ${job.id} did not start a host Run.`);
    const hostMessageId = hostRun.messageId;

    const hostTrigger = (await fx.messages(seeded.chatId)).find(
      ({ id }) => id === hostMessageId,
    );

    expect(hostTrigger).toMatchObject({
      role: 'user',
      senderUserId: null,
    });

    expect((await fx.terminal(hostRun.id)).status).toBe('failed');

    const partialReply = (await fx.messages(seeded.chatId)).find(
      ({ inReplyTo }) => inReplyTo === hostMessageId,
    );

    expect(partialReply?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: 'Host kept this partial answer before failure.',
        }),
      ]),
    );

    const followUps = new FollowUpAdmissionService(
      fx.harness.tenantDb,
      fx.harness.models,
      { config: BUILT_IN_DEFAULTS },
      fx.harness.dispatch,
    );

    const continued = await followUps.admitFollowUpRun({
      chatId: seeded.chatId,
      userId: fx.userId,
      userMessageId: hostMessageId,
      request: { action: 'continue', permissionMode: 'default' },
    });

    expect(await fx.run(continued.runId)).toMatchObject({
      messageId: hostMessageId,
      followUpAction: 'continue',
      sourceRunId: hostRun.id,
    });
    await fx.harness.dispatch.dispatch({
      runId: continued.runId,
      chatId: seeded.chatId,
      userId: fx.userId,
      modelId: continued.modelId,
      userMessage: continued.userMessage,
    });
    await fx.terminal(continued.runId);
  });

  it.each(['cancelled', 'lost'] as const)(
    'adopts a %s job notice on the first owner request',
    async (jobState) => {
      const seeded = await fx.seed(`request before ${jobState} job result`);
      await fx.db((tx) =>
        new RunsRepository(tx).markFinished(
          seeded.runId,
          fx.userId,
          'cancelled',
        ),
      );
      const modelId = `held-${jobState}-job-${randomUUID()}`;
      const job = await settledJob(seeded.chatId, seeded.runId, modelId);
      const notice = await noticeForJob(seeded.chatId, job.id);

      if (!notice)
        throw new Error('Settlement did not create the test notice.');
      await fx.db((tx) =>
        tx
          .update(chatJobs)
          .set({ state: jobState })
          .where(eq(chatJobs.id, job.id)),
      );
      fx.harness.models.register(modelId, {
        kind: 'complete',
        text: 'owner request completed',
      });

      const loop = new ChatLoopService(
        fx.harness.tenantDb,
        fx.harness.models,
        { config: BUILT_IN_DEFAULTS },
        { createUiMessageStreamResponse: () => new Response() },
        fx.harness.dispatch,
        new MediaService(fx.harness.tenantDb),
      );

      const ownerText = `owner request after ${jobState} job result`;
      await loop.createMessageStream({
        chatId: seeded.chatId,
        userId: fx.userId,
        modelId,
        message: {
          id: randomUUID(),
          parts: [{ type: 'text', text: ownerText }],
        },
      });

      const ownerMessage = (await fx.messages(seeded.chatId)).find(
        ({ parts }) => JSON.stringify(parts).includes(ownerText),
      );

      if (!ownerMessage) throw new Error('Owner message was not persisted.');

      const ownerRun = (
        await fx.db((tx) =>
          new RunsRepository(tx).findByChatId(seeded.chatId, fx.userId),
        )
      ).find(({ messageId }) => messageId === ownerMessage.id);

      if (!ownerRun) throw new Error('Owner Run was not persisted.');
      await fx.terminal(ownerRun.id);

      expect(await fx.itemState(notice.id)).toMatchObject({
        state: 'delivered',
        deliveredMessageId: ownerMessage.id,
        runId: ownerRun.id,
      });
      expect(JSON.stringify(fx.harness.models.prompts.at(-1))).toContain(
        'job://bash-1',
      );
    },
  );
});
