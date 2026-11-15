import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository } from '../chats/chats-repository';
import { chatDeliveries, workerInstances, type ChatJob } from '../db/schema';
import { appendJobOutput } from '../jobs/bash-job-store';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { readJob } from '../jobs/job-reader';
import { settleBashJob } from '../jobs/bash-job-store';
import { isRecord } from '@workspace/runtime-safety';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import {
  answer,
  call,
  useSegmentsFixture,
} from '../testing/run-segments.test-fixture';
import { dispatchRun, seedRun } from './worker-harness';
import { JobNoticeRunService } from './job-notice-run.service';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'job-notice-activation.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('job notice producer-to-live-Run activation', () => {
  const fx = useSegmentsFixture('job-notice-activation', {
    allowedTools: ['bash', 'read', 'stop'],
    nativeExecutorId: 'job-notice-activation-host',
  });

  async function createRunningJob(input: {
    chatId: string;
    runId: string;
    modelId: string;
    seq?: number;
    workerInstanceId?: string;
  }): Promise<ChatJob> {
    return fx.db((tx) =>
      new ChatJobsRepository(tx).insert({
        chatId: input.chatId,
        ownerUserId: fx.userId,
        executor: 'bash',
        seq: input.seq ?? 1,
        runId: input.runId,
        toolCallId: randomUUID(),
        workerInstanceId: input.workerInstanceId ?? randomUUID(),
        outputs: ['stdout', 'stderr'],
        artifactReadable: false,
        settings: { modelId: input.modelId, permissionMode: 'default' },
      }),
    );
  }

  async function settle(
    job: ChatJob,
    output = 'producer-output',
  ): Promise<void> {
    await settleBashJob(
      fx.harness.tenantDb,
      job,
      {
        output: {
          stdout: output,
          stderr: '',
          truncated: false,
          truncatedStreams: { stdout: false, stderr: false },
        },
        settlement: { state: 'succeeded', result: { exitCode: 0 } },
        offsets: { stdout: 0, stderr: 0 },
      },
      {
        maxBytes: 65_536,
        hostFiles: false,
        noticeRuns: fx.harness.moduleRef.get(JobNoticeRunService),
      },
    );
  }

  const notices = (chatId: string) =>
    fx.db((tx) =>
      new ChatDeliveriesRepository(tx).listPending(chatId, fx.userId),
    );

  it('settles a prior Run job once and delivers its output beside the reply to the next model', async () => {
    const first = await fx.startRun([answer('prior assistant reply')]);
    await fx.terminal(first.runId);

    const followUpModelId = `job-notice-follow-up-${randomUUID()}`;

    const followUp = await seedRun({
      tenantDb: fx.harness.tenantDb,
      userId: fx.userId,
      chatId: first.chatId,
      modelId: followUpModelId,
      text: 'continue after the background work',
    });

    expect(followUpModelId).not.toBe(first.modelId);

    const job = await createRunningJob({
      chatId: first.chatId,
      runId: first.runId,
      modelId: first.modelId,
    });

    expect(job.settings).toMatchObject({ modelId: first.modelId });

    await settle(job);
    const pending = await notices(followUp.chatId);

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      producer: 'job',
      mode: 'notice',
      state: 'pending',
      senderRef: job.id,
    });

    const read = await readJob(
      {
        userId: fx.userId,
        chatId: followUp.chatId,
        tenantDb: fx.harness.tenantDb,
        configuredCredentials: [],
        permissionPolicy: compileTestPermissionPolicy(),
      },
      'read',
      'job://bash-1/stdout',
    );

    expect(JSON.stringify(read)).toContain('producer-output');
    expect(await fx.itemState(pending[0].id)).toMatchObject({
      state: 'pending',
      senderRef: job.id,
    });

    await Promise.all([
      settle(job, 'duplicate-output-one'),
      settle(job, 'duplicate-output-two'),
    ]);

    const started = await fx.launch({ ...followUp, modelId: followUpModelId }, [
      answer('follow-up reply'),
    ]);

    await fx.terminal(started.runId);

    const providerCalls = fx.harness.models.streamCalls.filter(
      ({ chat }) => chat.id === followUp.chatId,
    );

    expect(providerCalls.at(-1)?.modelId).toBe(followUpModelId);
    const prompt = started.prompts().flat().join('\n');
    expect(prompt).toContain('prior assistant reply');
    expect(prompt).toContain('producer-output');
    expect(prompt).not.toContain('duplicate-output');
    expect(await notices(followUp.chatId)).toHaveLength(0);
  });

  it.each(['tool-step', 'final-answer'] as const)(
    'discovers a dead worker after a %s boundary and delivers retained output',
    async (boundary) => {
      const seeded = await fx.seed('continue after a lost background worker');

      const workerInstanceId = randomUUID();
      await fx.harness.db.insert(workerInstances).values({
        id: workerInstanceId,
      });

      const job = await createRunningJob({
        chatId: seeded.chatId,
        runId: seeded.runId,
        modelId: seeded.modelId,
        workerInstanceId,
      });

      const retainedOutput = 'output committed before worker disappeared';

      await fx.db((tx) =>
        appendJobOutput(
          tx,
          job,
          {
            stdout: retainedOutput,
            stderr: '',
            truncated: false,
            truncatedStreams: { stdout: false, stderr: false },
          },
          { stdout: 0, stderr: 0 },
        ),
      );

      const firstRunSteps =
        boundary === 'tool-step'
          ? [
              call('cross-step-boundary', 'read', { path: fx.directory }),
              answer('handled lost work'),
            ]
          : [
              answer('first Run reply before worker loss'),
              answer('handled lost work'),
            ];

      const started = await fx.launch(
        seeded,
        firstRunSteps,
        async (stepIndex) => {
          if (stepIndex !== 0) return;

          const liveJob = await fx.db((tx) =>
            new ChatJobsRepository(tx).findById(job.chatId, fx.userId, job.id),
          );

          expect(liveJob?.state).toBe('running');
          await fx.harness.db
            .update(workerInstances)
            .set({ lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) })
            .where(eq(workerInstances.id, workerInstanceId));
        },
      );

      await fx.terminal(started.runId);

      const providerPrompts = started.prompts();
      expect(providerPrompts).toHaveLength(2);
      expect(providerPrompts[0]?.join('\n')).not.toContain(retainedOutput);

      const settledJob = await fx.db((tx) =>
        new ChatJobsRepository(tx).findById(job.chatId, fx.userId, job.id),
      );

      expect(settledJob).toMatchObject({
        state: 'lost',
        result: { outcomeUnknown: true },
      });

      const producedNotices = await fx.db((tx) =>
        tx.select().from(chatDeliveries),
      );

      const jobNotices = producedNotices.filter(
        (delivery) => delivery.senderRef === job.id,
      );

      expect(jobNotices).toHaveLength(1);
      expect(jobNotices[0]).toMatchObject({
        producer: 'job',
        mode: 'notice',
        state: 'delivered',
        senderRef: job.id,
      });
      const nextProviderPrompt = providerPrompts[1]?.join('\n') ?? '';
      expect(nextProviderPrompt).toContain(retainedOutput);
      expect(nextProviderPrompt).toContain('outcome unknown');

      if (boundary === 'final-answer') {
        expect(nextProviderPrompt).toContain(
          'first Run reply before worker loss',
        );
      }

      await fx.harness.db
        .delete(workerInstances)
        .where(eq(workerInstances.id, workerInstanceId));
    },
  );

  it('keeps a produced notice pending when the live Run fails at its provider', async () => {
    const prior = await fx.startRun([answer('completed before failure')]);
    await fx.terminal(prior.runId);

    const job = await createRunningJob({
      chatId: prior.chatId,
      runId: prior.runId,
      modelId: prior.modelId,
    });

    const failedModelId = `job-notice-provider-failure-${randomUUID()}`;

    const failedRun = await seedRun({
      tenantDb: fx.harness.tenantDb,
      userId: fx.userId,
      chatId: prior.chatId,
      modelId: failedModelId,
      text: 'continue into a provider failure',
    });

    await settle(job, 'output before provider failure');

    fx.harness.models.register(failedModelId, {
      kind: 'provider-error',
      message: 'scripted provider failure',
    });

    await dispatchRun({
      queue: fx.harness.queue,
      ...failedRun,
      userId: fx.userId,
      modelId: failedModelId,
    });
    await fx.terminal(failedRun.runId);

    expect(await fx.run(failedRun.runId)).toMatchObject({ status: 'failed' });
    expect(fx.harness.models.streamCalls).toContainEqual(
      expect.objectContaining({ modelId: failedModelId }),
    );
    expect(await notices(prior.chatId)).toMatchObject([
      {
        producer: 'job',
        mode: 'notice',
        state: 'pending',
        senderRef: job.id,
      },
    ]);
  });

  it('keeps a real produced notice out of a Run after the owner withdraws it', async () => {
    const seeded = await fx.seed('omit the withdrawn background work');

    const job = await createRunningJob({
      chatId: seeded.chatId,
      runId: seeded.runId,
      modelId: seeded.modelId,
    });

    await settle(job, 'owner-dropped-output');
    const [notice] = await notices(seeded.chatId);

    if (!notice) throw new Error('The settlement producer created no notice.');

    const withdrawn = await fx.db((tx) =>
      new ChatDeliveriesRepository(tx).withdrawPending(
        seeded.chatId,
        notice.id,
        fx.userId,
      ),
    );

    expect(withdrawn).toMatchObject({ state: 'withdrawn', senderRef: job.id });

    const started = await fx.launch(seeded, [
      answer('answer without that job'),
    ]);

    await fx.terminal(started.runId);

    const prompt = started.prompts().flat().join('\n');
    expect(prompt).not.toContain('owner-dropped-output');
    expect(await fx.itemState(notice.id)).toMatchObject({
      state: 'withdrawn',
      senderRef: job.id,
    });
  });

  it('records a real settlement notice consumed by a stop result', async () => {
    const seeded = await fx.seed('stop the completed background job');

    const job = await createRunningJob({
      chatId: seeded.chatId,
      runId: seeded.runId,
      modelId: seeded.modelId,
    });

    let noticeId = '';
    await fx.launch(
      seeded,
      [
        call('stop-settled-job', 'stop', { jobs: ['job://bash-1'] }),
        answer('stopped'),
      ],
      async (stepIndex) => {
        if (stepIndex !== 0) return;
        await settle(job, 'stopped-job-output');

        const notice = (await notices(seeded.chatId)).find(
          (delivery) => delivery.senderRef === job.id,
        );

        if (!notice)
          throw new Error('The settlement producer created no notice.');
        noticeId = notice.id;
      },
    );
    await fx.terminal(seeded.runId);
    const row = await fx.itemState(noticeId);

    const completion = (await fx.events(seeded.runId)).find(
      (event) =>
        event.eventType === 'tool.completed' &&
        isRecord(event.payload) &&
        event.payload['toolCallId'] === 'stop-settled-job',
    );

    expect(row).toMatchObject({ producer: 'job', state: 'withdrawn' });
    expect(completion && isRecord(completion.payload)).toBe(true);

    if (completion && isRecord(completion.payload)) {
      expect(completion.payload['consumedJobNoticeIds']).toEqual([noticeId]);
    }
  });

  it('does not create a deliverable notice when the owner deletes the Chat before settlement', async () => {
    const seeded = await fx.seed('delete before producer commit');

    const job = await createRunningJob({
      chatId: seeded.chatId,
      runId: seeded.runId,
      modelId: seeded.modelId,
    });

    await fx.db((tx) =>
      new ChatsRepository(tx).deleteById(seeded.chatId, fx.userId),
    );
    await settle(job, 'must-not-be-delivered');

    expect(await notices(seeded.chatId)).toEqual([]);
    expect(await fx.events(seeded.runId)).toEqual([]);
  });
});
