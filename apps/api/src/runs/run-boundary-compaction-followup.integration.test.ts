import { isNumber, isRecord, isString } from '@workspace/runtime-safety';

import { CompactionService } from '../compaction/compaction.service';
import { createCompactionCheckpointPart } from '../chats/context-item-producers';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { MessagesRepository } from '../chats/messages-repository';
import {
  answer,
  call,
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { deliverPendingSteering } from './segment-delivery';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'run-boundary-compaction-followup.integration.test.ts requires TEST_DATABASE_URL.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('step-boundary compaction follow-up', () => {
  const fx = useSegmentsFixture('run-boundary-compaction-followup', {
    allowedTools: ['read'],
    maxStepsPerRun: 6,
  });

  async function settleNotice(runId: string, chatId: string) {
    await fx.db(async (tx) => {
      const jobs = new ChatJobsRepository(tx);

      const inserted = await jobs.insert({
        chatId,
        ownerUserId: fx.userId,
        executor: 'bash',
        seq: 1,
        runId,
        toolCallId: `job-${crypto.randomUUID()}`,
        workerInstanceId: crypto.randomUUID(),
        outputs: [],
        artifactReadable: false,
        settings: { modelId: 'boundary-job-test', permissionMode: 'default' },
      });

      const settled = await jobs.settle(chatId, fx.userId, inserted.id, {
        state: 'succeeded',
        result: { exitCode: 0 },
      });

      if (!settled) throw new Error('The boundary test job did not settle.');

      const notice = await new ChatDeliveriesRepository(tx).insertJobNotice(
        settled,
      );

      if (!notice)
        throw new Error('The boundary test job notice was not inserted.');
    });
  }

  async function compactDuringStep(
    mode: 'steer' | 'interrupt',
    text: string,
    waitForNotice: (seeded: SeededRun) => Promise<void>,
  ) {
    const seeded = await fx.seed(text);
    const summaryStarted = Promise.withResolvers<void>();
    const releaseSummary = Promise.withResolvers<void>();

    vi.spyOn(
      fx.harness.moduleRef.get(CompactionService),
      'computeBoundarySummary',
    ).mockImplementation(async (input) => {
      summaryStarted.resolve();
      await releaseSummary.promise;

      return {
        uptoSeq: input.uptoSeq,
        summary: 'follow-up checkpoint',
        usage: {},
      };
    });

    const started = await fx.launch(
      seeded,
      [
        call('read-one', 'read', { path: fx.directory }),
        call('read-two', 'read', { path: fx.directory }),
        answer('Finished after the checkpoint.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 1) {
          await fx.storeItems(seeded.chatId, ['/compact'], mode, seeded.runId);
        }
      },
    );

    await summaryStarted.promise;
    await waitForNotice(seeded);
    releaseSummary.resolve();

    return { seeded, started };
  }

  const partProducers = (message: { parts: Array<unknown> }) =>
    message.parts.flatMap((part) =>
      isRecord(part) &&
      isRecord(part['data']) &&
      isString(part['data']['producer'])
        ? [part['data']['producer']]
        : [],
    );

  it('A job result during a compaction', async () => {
    const { seeded, started } = await compactDuringStep(
      'steer',
      'Continue after the job.',
      (seeded) => settleNotice(seeded.runId, seeded.chatId),
    );

    await fx.terminal(seeded.runId);

    const continuation = (await fx.messages(seeded.chatId)).find(
      (message) =>
        message.role === 'user' &&
        partProducers(message).includes('compaction'),
    );

    expect(continuation).toBeDefined();
    expect(partProducers(continuation!)).toEqual([
      'job',
      'compaction',
      'temporal',
    ]);
    expect(
      started
        .prompts()
        .at(-1)
        ?.some((line) => line.includes('Continue after the job.')),
    ).toBe(true);
  });

  it('A continue message after an interrupt and a job', async () => {
    const { seeded } = await compactDuringStep(
      'interrupt',
      'Continue after the interrupt.',
      (seeded) => settleNotice(seeded.runId, seeded.chatId),
    );

    await fx.terminal(seeded.runId);

    const continuation = (await fx.messages(seeded.chatId)).find(
      (message) =>
        message.role === 'user' &&
        partProducers(message).includes('compaction'),
    );

    const delivered = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.delivered',
    );

    expect(delivered?.payload).toMatchObject({ cause: 'interrupt' });
    expect(partProducers(continuation!)).toEqual([
      'interrupted',
      'job',
      'compaction',
      'temporal',
    ]);
  });
  it('A crash retry retains the compaction step budget', async () => {
    const seeded = await fx.seed('Retain the remaining steps.');

    const started = await fx.db((tx) =>
      new RunsRepository(tx).markStarted(seeded.runId, fx.userId),
    );

    const attemptId = started?.activeAttemptId;

    if (!attemptId) {
      throw new Error('Could not start the pre-delivery Run.');
    }

    const reply = await fx.db((tx) =>
      new MessagesRepository(tx).createAssistantReplyIfAbsent({
        chatId: seeded.chatId,
        inReplyTo: seeded.userMessage.id,
        parts: [{ type: 'text', text: 'The first segment used two steps.' }],
        usage: {
          status: 'running',
          complete: false,
          runId: seeded.runId,
          attemptId,
          modelId: seeded.modelId,
        },
      }),
    );

    if (!reply) throw new Error('Could not seed the running assistant reply.');
    await fx.db((tx) =>
      new RunEventsRepository(tx).append(seeded.runId, 'run.started'),
    );

    const commandIds = await fx.storeItems(
      seeded.chatId,
      ['/compact'],
      'steer',
      seeded.runId,
    );

    const delivered = await fx.db((tx) =>
      deliverPendingSteering(tx, {
        run: { runId: seeded.runId, userId: fx.userId },
        attemptId,
        deadWorkerAfterSeconds: 60,
        models: [],
        live: {
          chatId: seeded.chatId,
          inReplyTo: seeded.userMessage.id,
          parts: [{ type: 'text', text: 'The first segment used two steps.' }],
          telemetry: {
            runId: seeded.runId,
            attemptId,
            modelId: seeded.modelId,
            latencyMs: 0,
            finishReason: 'stop',
            status: 'completed',
            complete: true,
          },
        },
        boundaryCompaction: {
          ids: commandIds,
          summary: {
            uptoSeq: reply.seq,
            summary: 'Persisted before the crash.',
            usage: {},
          },
          quote: 'Retain the remaining steps.',
          stepBudgetUsed: 2,
          publishCheckpoint: async (tx, closedReply) =>
            (
              await new MessagesRepository(tx).createCheckpoint({
                chatId: seeded.chatId,
                absorbedThroughSeq: closedReply.seq,
                part: createCompactionCheckpointPart(
                  'Persisted before the crash.',
                ),
              })
            ).id,
        },
      }),
    );

    if (delivered.kind !== 'delivered') {
      throw new Error('The compaction boundary was not delivered.');
    }

    const readCalls = Array.from({ length: 4 }, (_, index) =>
      call(`retry-read-${index}`, 'read', { path: fx.directory }),
    );

    const retry = await fx.launch(seeded, [
      ...readCalls,
      answer('Recovered with the remaining budget.'),
    ]);

    await fx.terminal(seeded.runId);

    const events = await fx.events(seeded.runId);

    const deliveryEvent = events.find(
      (event) => event.eventType === 'run.delivered',
    );

    const requestedReadSteps = events.flatMap((event) => {
      if (
        event.eventType !== 'tool.requested' ||
        !isRecord(event.payload) ||
        event.payload['toolName'] !== 'read' ||
        !isNumber(event.payload['stepNumber'])
      ) {
        return [];
      }

      return [event.payload['stepNumber']];
    });

    const completedReads = events.filter(
      (event) =>
        event.eventType === 'tool.completed' &&
        isRecord(event.payload) &&
        event.payload['toolName'] === 'read',
    );

    const declarations = fx.harness.models.declarations
      .filter(({ modelId }) => modelId === seeded.modelId)
      .map(({ tools }) => tools.some(({ toolId }) => toolId === 'read'));

    expect(deliveryEvent?.payload).toMatchObject({
      cause: 'compaction',
      stepBudgetUsed: 2,
    });
    expect({
      completedReadCount: completedReads.length,
      requestedReadSteps,
      modelPromptCount: retry.prompts().length,
      readToolOffered: declarations,
    }).toEqual({
      completedReadCount: 4,
      requestedReadSteps: [0, 1, 2, 3],
      modelPromptCount: 5,
      readToolOffered: [true, true, true, true, false],
    });
  });
});
