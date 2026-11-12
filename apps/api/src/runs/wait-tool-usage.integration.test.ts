import { settleBashJob } from '../jobs/bash-job-store';
import { JobNoticeRunService } from './job-notice-run.service';
import { type ChatJob } from '../db/schema';
import { waitFor } from '../testing/support';
import {
  call,
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';
import { dispatchRun, seedLiveChatJob } from './worker-harness';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'wait-tool-usage.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('wait usage accounting across a durable wake', () => {
  const fx = useSegmentsFixture('wait-tool-usage', {
    allowedTools: ['read', 'wait'],
    nativeExecutorId: 'wait-tool-usage-host',
    maxStepsPerRun: 3,
  });

  async function seedJob(seeded: SeededRun): Promise<ChatJob> {
    return fx.db((tx) =>
      seedLiveChatJob({
        tx,
        userId: fx.userId,
        modelId: seeded.modelId,
        run: { chatId: seeded.chatId, runId: seeded.runId },
      }),
    );
  }

  const requestUsage = (inputTokens: number, outputTokens: number) => ({
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens,
      reasoning: 0,
    },
  });

  async function suspendOnWait(
    seeded: SeededRun,
    withPriorRead = false,
  ): Promise<void> {
    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [
        ...(withPriorRead
          ? [call('read-before-wait', 'read', { path: fx.directory })]
          : []),
        call('wait-for-job', 'wait', {
          jobs: ['job://bash-1'],
          timeout: 3600,
        }),
      ],
      requestUsages: [
        ...(withPriorRead ? [requestUsage(17, 5)] : []),
        requestUsage(17, 5),
      ],
    });
    await dispatchRun({
      queue: fx.harness.queue,
      ...seeded,
      userId: fx.userId,
    });
    await waitFor(
      async () =>
        (await fx.run(seeded.runId))?.status === 'awaiting_jobs'
          ? true
          : undefined,
      20_000,
      'Run to suspend in wait',
    );
  }

  async function settle(job: ChatJob): Promise<void> {
    await settleBashJob(
      fx.harness.tenantDb,
      job,
      {
        output: {
          stdout: 'settled output',
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

  it('uses only the resumed attempt requests and marks their usage incomplete', async () => {
    const promptsBefore = fx.harness.models.prompts.length;
    const seeded = await fx.seed('usage through wait');
    const job = await seedJob(seeded);
    await suspendOnWait(seeded);
    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [
        call('read-after-wake', 'read', { path: fx.directory }),
        [{ type: 'text', id: 'answer', text: 'resumed answer' }],
      ],
      requestUsages: [requestUsage(17, 5), requestUsage(17, 5)],
    });
    await settle(job);
    const completed = await fx.terminal(seeded.runId);

    const reply = (await fx.transcript(seeded.chatId)).find(
      (message) =>
        message.role === 'assistant' &&
        message.inReplyTo === seeded.userMessage.id,
    );

    expect(completed.status).toBe('completed');
    expect(fx.harness.models.prompts.length - promptsBefore).toBe(3);
    expect(reply?.text).toBe('resumed answer');
    expect(reply?.usage).toMatchObject({
      inputTokens: 34,
      outputTokens: 10,
      reasoningTokens: 0,
      totalTokens: 44,
      status: 'completed',
      complete: false,
    });
  });

  it('carries earlier steps into the resumed segment budget', async () => {
    const promptsBefore = fx.harness.models.prompts.length;
    const seeded = await fx.seed('budget through wait');
    const job = await seedJob(seeded);
    await suspendOnWait(seeded, true);

    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [
        call('last-budgeted-read', 'read', { path: fx.directory }),
        [{ type: 'text', id: 'final-answer', text: 'final tool-free answer' }],
      ],
      requestUsages: [requestUsage(17, 5), requestUsage(17, 5)],
    });
    await settle(job);
    const completed = await fx.terminal(seeded.runId);
    const events = await fx.events(seeded.runId);

    expect(completed.status).toBe('completed');
    expect(fx.harness.models.prompts.length - promptsBefore).toBe(4);
    expect(
      events.filter((event) => event.eventType === 'run.step_cap_reached'),
    ).toHaveLength(1);
    expect(fx.harness.models.declarations.at(-1)?.tools).toEqual([]);
    expect(
      events.find((event) => event.eventType === 'run.step_cap_reached')
        ?.payload,
    ).toMatchObject({ stepsUsed: 3, maxSteps: 3 });
    expect(
      (await fx.transcript(seeded.chatId))
        .map((message) => message.text)
        .join(String.raw`\n`),
    ).toContain('final tool-free answer');
  });
});
