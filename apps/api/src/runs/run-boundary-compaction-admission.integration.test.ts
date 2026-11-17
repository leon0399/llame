import { isRecord } from '@workspace/runtime-safety';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { CompactionService } from '../compaction/compaction.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { runs } from '../db/schema';
import { RunWaitService } from './run-wait.service';
import { waitFor } from '../testing/support';
import {
  answer,
  call,
  useSegmentsFixture,
} from '../testing/run-segments.test-fixture';
import { seedLiveChatJob } from './worker-harness';
import { RunsRepository } from './runs-repository';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'run-boundary-compaction-admission.integration.test.ts requires TEST_DATABASE_URL.',
  );
}

describe('step-boundary compaction admission', () => {
  const fx = useSegmentsFixture('run-boundary-compaction-admission', {
    allowedTools: ['bash', 'wait'],
    nativeExecutorId: 'run-boundary-compaction-admission-host',
  });

  const awaiting = (runId: string) =>
    waitFor(
      async () => {
        const run = await fx.run(runId);

        return run?.status === 'awaiting_jobs' ? run : undefined;
      },
      20_000,
      `Run ${runId} to wait for a job`,
    );

  it('A compact steer yields a foreground command and interrupts a wait', async () => {
    const foreground = await fx.seed('Yield the foreground build.');
    const pidFile = join(fx.directory, `pid-${randomUUID()}`);

    const firstRun = await fx.launch(foreground, [
      call('slow-build', 'bash', {
        command: `echo $$ > ${pidFile}; exec sleep 60`,
        cwd: fx.directory,
      }),
      answer('The build is now a job.'),
    ]);

    await waitFor(
      async () =>
        (await fx.events(foreground.runId)).some(
          (event) =>
            event.eventType === 'tool.started' &&
            isRecord(event.payload) &&
            event.payload['toolCallId'] === 'slow-build',
        )
          ? true
          : undefined,
      20_000,
      'the foreground command to start',
    );

    const [compactId] = await fx.storeItems(
      foreground.chatId,
      ['/compact'],
      'steer',
      foreground.runId,
    );

    await fx.terminal(foreground.runId);

    const bashResult = (await fx.events(foreground.runId)).find(
      (event) =>
        event.eventType === 'tool.completed' &&
        isRecord(event.payload) &&
        event.payload['toolCallId'] === 'slow-build',
    );

    expect(bashResult?.payload).toMatchObject({
      output: { backgrounded: true },
    });
    expect(await fx.itemState(compactId ?? '')).toMatchObject({
      state: 'delivered',
    });
    expect(firstRun.prompts().length).toBeGreaterThan(1);

    // Wait calls are deferred until the current model stream drains. Test the
    // resulting compact-steer interruption with the persisted job in a fresh Run.
    const waiting = await fx.seed('Wait for the build job.');

    const job = await fx.db((tx) =>
      seedLiveChatJob({
        tx,
        userId: fx.userId,
        modelId: waiting.modelId,
        run: { chatId: waiting.chatId, runId: waiting.runId },
      }),
    );

    const waitingRun = await fx.launch(waiting, [
      call('wait-build', 'wait', {
        jobs: [`job://bash-${job.seq}`],
        timeout: 3600,
      }),
      answer('The wait was interrupted.'),
    ]);

    await awaiting(waiting.runId);
    await fx.storeItems(waiting.chatId, ['/compact'], 'steer');

    const woke = await fx.db((tx) =>
      fx.harness.moduleRef.get(RunWaitService).wakeForChatInTransaction(tx, {
        chatId: waiting.chatId,
        userId: fx.userId,
        kind: 'steer',
      }),
    );

    expect(woke).toBe(true);
    await fx.terminal(waiting.runId);

    const waitResult = (await fx.events(waiting.runId)).find(
      (event) =>
        event.eventType === 'tool.completed' &&
        isRecord(event.payload) &&
        event.payload['toolCallId'] === 'wait-build',
    );

    expect(waitResult?.payload).toMatchObject({
      output: { ended: 'interrupted' },
    });
    expect(waitingRun.prompts().length).toBeGreaterThan(1);
    expect(job.state).toBe('running');
  });

  it('Wake compaction skips auto trigger above threshold and sends one strict prefix', async () => {
    const seeded = await fx.seed('Continue after the build job.');

    const job = await fx.db((tx) =>
      seedLiveChatJob({
        tx,
        userId: fx.userId,
        modelId: seeded.modelId,
        run: { chatId: seeded.chatId, runId: seeded.runId },
      }),
    );

    const started = await fx.launch(seeded, [
      call('wait-build', 'wait', { jobs: ['job://bash-1'], timeout: 3600 }),
      answer('Build follow-up complete.'),
    ]);

    await awaiting(seeded.runId);

    const wakeSummary = vi.fn();
    let wakeClosedReply: unknown;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) => {
        if (
          input.focus === 'Keep the build context.' &&
          JSON.stringify(input.closedReply).includes('wait-build')
        ) {
          wakeClosedReply = input.closedReply;
          wakeSummary();
        }

        return Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'waiting task checkpoint',
          usage: {},
        });
      });

    const autoTrigger = vi.spyOn(
      fx.harness.moduleRef.get(CompactionService),
      'summarizeCheckpoint',
    );

    const [compactId] = await fx.storeItems(
      seeded.chatId,
      ['/compact Keep the build context.'],
      'steer',
    );

    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [answer('Build follow-up complete.')],
      compactionThresholdTokens: 1,
    });
    summarize.mockClear();

    const woke = await fx.db((tx) =>
      fx.harness.moduleRef.get(RunWaitService).wakeForChatInTransaction(tx, {
        chatId: seeded.chatId,
        userId: fx.userId,
        kind: 'steer',
      }),
    );

    expect(woke).toBe(true);
    await fx.terminal(seeded.runId);

    const messages = await fx.messages(seeded.chatId);

    const checkpoint = messages.find(
      (message) => message.role === 'checkpoint',
    );

    const continueMessage = messages.find((message) =>
      message.parts.some(
        (part) =>
          isRecord(part) &&
          isRecord(part['data']) &&
          part['data']['producer'] === 'compaction' &&
          part['data']['form'] === 'notice',
      ),
    );

    const events = await fx.events(seeded.runId);

    const completedWait = events.find(
      (event) =>
        event.eventType === 'tool.completed' &&
        isRecord(event.payload) &&
        'toolCallId' in event.payload &&
        event.payload['toolCallId'] === 'wait-build',
    );

    const compactDelivery = events.find(
      (event) =>
        event.eventType === 'run.delivered' &&
        isRecord(event.payload) &&
        event.payload['cause'] === 'compaction',
    );

    expect(compactDelivery?.payload).toMatchObject({ stepBudgetUsed: 1 });
    expect(wakeSummary).toHaveBeenCalledOnce();

    const summaryReply = JSON.stringify(wakeClosedReply);

    expect(summaryReply.match(/wait-build/g)).toHaveLength(2);
    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({ focus: 'Keep the build context.' }),
    );
    expect(autoTrigger).not.toHaveBeenCalled();
    expect(checkpoint).toBeDefined();
    expect(started.prompts()).toHaveLength(2);
    expect(
      await fx.db((tx) =>
        new ChatDeliveriesRepository(tx).findById(compactId, fx.userId),
      ),
    ).toMatchObject({ state: 'delivered', deliveredMessageId: null });
    expect(continueMessage?.role).toBe('user');
    expect(continueMessage?.seq).toBeGreaterThan(checkpoint?.seq ?? 0);
    expect(completedWait?.payload).toMatchObject({
      output: { ended: 'interrupted' },
    });
    expect(
      (
        await fx.db((tx) =>
          new ChatJobsRepository(tx).findById(seeded.chatId, fx.userId, job.id),
        )
      )?.state,
    ).toBe('running');
  });

  it('A withdrawn compact still delivers pending steering on wake', async () => {
    const seeded = await fx.seed('Deliver pending steering after withdrawal.');

    const job = await fx.db((tx) =>
      seedLiveChatJob({
        tx,
        userId: fx.userId,
        modelId: seeded.modelId,
        run: { chatId: seeded.chatId, runId: seeded.runId },
      }),
    );

    await fx.launch(seeded, [
      call('wait-withdrawn-compact', 'wait', {
        jobs: [`job://bash-${job.seq}`],
        timeout: 3600,
      }),
      answer('Build follow-up complete.'),
    ]);
    await awaiting(seeded.runId);

    const [compactId, steerId] = await fx.storeItems(
      seeded.chatId,
      ['/compact Keep the summary.', 'Keep working on the build.'],
      'steer',
    );

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation(async (input) => {
        await fx.db((tx) =>
          new ChatDeliveriesRepository(tx).withdrawPending(
            seeded.chatId,
            compactId,
            fx.userId,
          ),
        );

        return {
          uptoSeq: input.plan.uptoSeq,
          summary: 'withdrawn command summary',
          usage: {},
        };
      });

    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [answer('Build follow-up complete.')],
    });

    const woke = await fx.db((tx) =>
      fx.harness.moduleRef.get(RunWaitService).wakeForChatInTransaction(tx, {
        chatId: seeded.chatId,
        userId: fx.userId,
        kind: 'steer',
      }),
    );

    expect(woke).toBe(true);
    await fx.terminal(seeded.runId);

    expect(summarize).toHaveBeenCalled();
    expect(await fx.itemState(compactId)).toMatchObject({
      state: 'withdrawn',
    });
    expect(await fx.itemState(steerId)).toMatchObject({ state: 'delivered' });
    expect(
      (await fx.messages(seeded.chatId)).some((message) =>
        message.parts.some(
          (part) =>
            isRecord(part) &&
            part['type'] === 'text' &&
            part['text'] === 'Keep working on the build.',
        ),
      ),
    ).toBe(true);
  });

  it('A failed wake compaction persists its failure note', async () => {
    const seeded = await fx.seed('Continue after a failed wake summary.');

    const job = await fx.db((tx) =>
      seedLiveChatJob({
        tx,
        userId: fx.userId,
        modelId: seeded.modelId,
        run: { chatId: seeded.chatId, runId: seeded.runId },
      }),
    );

    await fx.launch(seeded, [
      call('wait-failed-summary', 'wait', {
        jobs: [`job://bash-${job.seq}`],
        timeout: 3600,
      }),
      answer('Build follow-up complete.'),
    ]);
    await awaiting(seeded.runId);
    await fx.storeItems(seeded.chatId, ['/compact'], 'steer');

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockResolvedValue(null);

    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [answer('Build follow-up complete.')],
    });

    const woke = await fx.db((tx) =>
      fx.harness.moduleRef.get(RunWaitService).wakeForChatInTransaction(tx, {
        chatId: seeded.chatId,
        userId: fx.userId,
        kind: 'steer',
      }),
    );

    expect(woke).toBe(true);
    await fx.terminal(seeded.runId);

    const reply = (await fx.messages(seeded.chatId)).find(
      (message) =>
        message.role === 'assistant' &&
        message.inReplyTo === seeded.userMessage.id,
    );

    expect(summarize).toHaveBeenCalled();
    expect(reply?.parts).toContainEqual({
      type: 'data-compaction-failed',
      data: {},
    });
  });

  it('A compact steer interrupts a durable foreground job wait', async () => {
    const seeded = await fx.seed('Wait while the build is running.');
    const attemptId = randomUUID();

    const job = await fx.db(async (tx) => {
      await tx
        .update(runs)
        .set({ status: 'running_tool', activeAttemptId: attemptId })
        .where(eq(runs.id, seeded.runId));

      return seedLiveChatJob({
        tx,
        userId: fx.userId,
        modelId: seeded.modelId,
        run: { chatId: seeded.chatId, runId: seeded.runId },
      });
    });

    await fx.storeItems(seeded.chatId, ['/compact'], 'steer');

    const result = await fx.harness.moduleRef.get(RunWaitService).suspend({
      runId: seeded.runId,
      chatId: seeded.chatId,
      userId: fx.userId,
      attemptId,
      toolCallId: job.toolCallId,
      toolInput: { jobs: ['job://bash-1'], timeout: 3600 },
      jobIds: [job.id],
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      parts: [{ type: 'tool-call', id: job.toolCallId }],
      steps: { [job.toolCallId]: 0 },
    });

    expect(result).toEqual({ kind: 'ready', cause: 'interrupted' });
    expect(
      (
        await fx.db((tx) =>
          new ChatJobsRepository(tx).findById(seeded.chatId, fx.userId, job.id),
        )
      )?.state,
    ).toBe('running');
  });

  it('Stop with only a pending compact', async () => {
    const seeded = await fx.seed('Stop this task.');
    const compactStored = Promise.withResolvers<void>();
    let compactTask: Promise<void> | undefined;

    const started = await fx.launch(
      seeded,
      [
        call('foreground-bash', 'bash', {
          command: 'exec sleep 60',
          cwd: fx.directory,
        }),
      ],
      (stepIndex) => {
        if (stepIndex === 0 && compactTask === undefined) {
          compactTask = (async () => {
            await waitFor(
              async () =>
                (await fx.types(seeded.runId)).includes('tool.started')
                  ? true
                  : undefined,
              20_000,
              'the host command to start before Stop',
            );
            await fx.storeItems(seeded.chatId, ['/compact'], 'steer');
            compactStored.resolve();
          })();
        }
      },
    );

    await compactStored.promise;
    await compactTask;
    await fx.db(async (tx) => {
      const cancelled = await new RunsRepository(tx).requestCancel(
        seeded.runId,
        fx.userId,
      );

      if (!cancelled) throw new Error('The Run was not cancellable.');
    });

    expect((await fx.terminal(seeded.runId)).status).toBe('cancelled');
    expect(await fx.items(seeded.chatId)).toMatchObject([
      { mode: 'queue', state: 'pending', parts: [{ text: '/compact' }] },
    ]);
    expect(started.prompts()).toHaveLength(1);
  });
});
