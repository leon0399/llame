import { isRecord, isString } from '@workspace/runtime-safety';

import { CompactionService } from '../compaction/compaction.service';
import type { Message } from '../db/schema';
import {
  answer,
  call,
  useSegmentsFixture,
} from '../testing/run-segments.test-fixture';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'run-boundary-compaction.integration.test.ts requires TEST_DATABASE_URL.',
  );
}

describe('step-boundary compaction', () => {
  const fx = useSegmentsFixture('run-boundary-compaction', {
    allowedTools: ['read'],
  });

  const partKinds = (message: Message) =>
    message.parts.map((part) =>
      isRecord(part) &&
      isRecord(part['data']) &&
      isString(part['data']['producer'])
        ? `data-context:${part['data']['producer']}`
        : isRecord(part) && isString(part['type'])
          ? part['type']
          : 'unknown',
    );

  it('A compaction in a tool loop absorbs the open turn and continues the Run', async () => {
    const seeded = await fx.seed('Finish the report.');

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.uptoSeq,
          summary: 'the open turn summary',
          usage: {},
        }),
      );

    const started = await fx.launch(
      seeded,
      [
        call('r1', 'read', { path: fx.directory }),
        call('r2', 'read', { path: fx.directory }),
        call('r3', 'read', { path: fx.directory }),
        answer('Report finished.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 2) {
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    const finished = await fx.terminal(seeded.runId);
    const messages = await fx.messages(seeded.chatId);

    const checkpoint = messages.find(
      (message) => message.role === 'checkpoint',
    );

    const delivered = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.delivered',
    );

    expect(finished.status).toBe('completed');
    expect(summarize).toHaveBeenCalledOnce();
    expect(summarize.mock.calls[0]?.[0].closedReply.length).toBeGreaterThan(0);
    expect(checkpoint?.absorbedThroughSeq).toBeGreaterThan(
      seeded.userMessage.seq,
    );

    const assistant = messages.find(
      (message) =>
        message.role === 'assistant' &&
        message.inReplyTo === seeded.userMessage.id,
    );

    const continuation = messages.find(
      (message) =>
        message.role === 'user' &&
        partKinds(message).includes('data-context:compaction'),
    );

    expect(assistant?.seq).toBeLessThan(checkpoint?.seq ?? 0);
    expect(checkpoint?.seq).toBeLessThan(continuation?.seq ?? 0);
    expect(delivered?.payload).toMatchObject({
      cause: 'compaction',
      checkpointId: checkpoint?.id,
      stepBudgetUsed: 3,
    });
    expect(started.prompts()).toHaveLength(4);
    expect(
      started
        .prompts()
        .at(-1)
        ?.some((line) => line.includes('Finish the report.')),
    ).toBe(true);
  });
});
