import { isRecord, isString } from '@workspace/runtime-safety';

import { CompactionService } from '../compaction/compaction.service';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
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
  it('Compact as a steer', async () => {
    const seeded = await fx.seed('Keep the result concise.');
    let stored = false;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.uptoSeq,
          summary: 'compacted steer context',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    const started = await fx.launch(
      seeded,
      [call('read-once', 'read', { path: fx.directory }), answer('Done.')],
      async (stepIndex) => {
        if (stepIndex === 0 && !stored) {
          stored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    await fx.terminal(seeded.runId);

    const messages = await fx.messages(seeded.chatId);

    const checkpoint = messages.find(
      (message) => message.role === 'checkpoint',
    );

    const continuation = messages.find(
      (message) =>
        message.role === 'user' &&
        partKinds(message).includes('data-context:compaction'),
    );

    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(checkpoint).toBeDefined();
    expect(continuation).toBeDefined();
    expect(partKinds(continuation!)).not.toContain('text');
    expect(started.prompts()).toHaveLength(2);
  });

  it('Two compact items at one boundary', async () => {
    const seeded = await fx.seed('Keep both requests.');
    let stored = false;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.uptoSeq,
          summary: 'one shared compacted context',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;
    let ids: Array<string> = [];

    await fx.launch(
      seeded,
      [call('read-once', 'read', { path: fx.directory }), answer('Done.')],
      async (stepIndex) => {
        if (stepIndex === 0 && !stored) {
          stored = true;
          ids = await fx.storeItems(
            seeded.chatId,
            ['/compact first', '/compact second'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    await fx.terminal(seeded.runId);

    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(
      (await Promise.all(ids.map((id) => fx.itemState(id)))).map(
        (item) => item?.state,
      ),
    ).toEqual(['delivered', 'delivered']);
    expect(
      (await fx.messages(seeded.chatId)).filter(
        (message) => message.role === 'checkpoint',
      ),
    ).toHaveLength(1);
  });

  it('A compact and a steer at one boundary', async () => {
    const seeded = await fx.seed('Keep the requested context.');
    let stored = false;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.uptoSeq,
          summary: 'mixed boundary context',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(
      seeded,
      [call('read-once', 'read', { path: fx.directory }), answer('Done.')],
      async (stepIndex) => {
        if (stepIndex === 0 && !stored) {
          stored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact', 'Keep going'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    await fx.terminal(seeded.runId);

    const delivered = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.delivered',
    );

    const message = (await fx.messages(seeded.chatId)).find(
      (candidate) =>
        candidate.role === 'user' &&
        partKinds(candidate).includes('data-context:compaction'),
    );

    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(delivered?.payload).toMatchObject({ cause: 'steer' });
    expect(
      message?.parts.map((part) => (isRecord(part) ? part['text'] : null)),
    ).toContain('Keep going');
  });
  it('A provider error during a compaction mid-turn', async () => {
    const seeded = await fx.seed('Continue after a failed summary.');
    let stored = false;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockResolvedValue(null);

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(
      seeded,
      [
        call('read-one', 'read', { path: fx.directory }),
        call('read-two', 'read', { path: fx.directory }),
        answer('The task is complete.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 1 && !stored) {
          stored = true;
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
    const events = await fx.events(seeded.runId);

    expect(finished.status).toBe('completed');
    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(events.map((event) => event.eventType)).toContain(
      'run.compaction_failed',
    );
    expect(
      (await fx.messages(seeded.chatId)).filter(
        (message) => message.role === 'checkpoint',
      ),
    ).toHaveLength(0);
  });
  it('Two compactions share one budget', async () => {
    const seeded = await fx.seed('Keep the multi-step task moving.');
    let firstStored = false;
    let secondStored = false;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.uptoSeq,
          summary: 'updated task checkpoint',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(
      seeded,
      [
        call('read-one', 'read', { path: fx.directory }),
        call('read-two', 'read', { path: fx.directory }),
        call('read-three', 'read', { path: fx.directory }),
        call('read-four', 'read', { path: fx.directory }),
        answer('Task complete.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 2 && !firstStored) {
          firstStored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact first'],
            'steer',
            seeded.runId,
          );
        } else if (stepIndex === 3 && !secondStored) {
          secondStored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact second'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    await fx.terminal(seeded.runId);

    const budgets = (await fx.events(seeded.runId))
      .filter((event) => event.eventType === 'run.delivered')
      .map((event) =>
        isRecord(event.payload) ? event.payload['stepBudgetUsed'] : undefined,
      );

    expect(summarize).toHaveBeenCalledTimes(callsBefore + 2);
    expect(budgets).toEqual([3, 4]);
  });
  it('An interrupt compaction keeps its cause', async () => {
    const seeded = await fx.seed('Interrupt and compact.');
    let stored = false;

    await fx.launch(
      seeded,
      [
        call('read-one', 'read', { path: fx.directory }),
        call('read-two', 'read', { path: fx.directory }),
        answer('Finished after interruption.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 1 && !stored) {
          stored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'interrupt',
            seeded.runId,
          );
        }
      },
    );

    await fx.terminal(seeded.runId);

    const delivered = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.delivered',
    );

    expect(delivered?.payload).toMatchObject({
      cause: 'interrupt',
      stepBudgetUsed: 2,
    });
  });
  it('A compact item withdrawn during the compaction', async () => {
    const seeded = await fx.seed('Keep working after withdrawal.');
    const entered = Promise.withResolvers<void>();

    const release = Promise.withResolvers<{
      uptoSeq: number;
      summary: string;
      usage: Record<string, never>;
    } | null>();

    let itemId: string | undefined;

    vi.spyOn(
      fx.harness.moduleRef.get(CompactionService),
      'computeBoundarySummary',
    ).mockImplementation(async (input) => {
      entered.resolve();

      return release.promise.then(() => ({
        uptoSeq: input.uptoSeq,
        summary: 'withdrawn summary',
        usage: {},
      }));
    });

    await fx.launch(
      seeded,
      [
        call('read-one', 'read', { path: fx.directory }),
        call('read-two', 'read', { path: fx.directory }),
        answer('Task finished.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 1 && itemId === undefined) {
          [itemId] = await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    await entered.promise;
    await fx.db((tx) =>
      new ChatDeliveriesRepository(tx).withdrawPending(
        seeded.chatId,
        itemId!,
        fx.userId,
      ),
    );
    release.resolve(null);
    await fx.terminal(seeded.runId);

    expect((await fx.itemState(itemId!))?.state).toBe('withdrawn');
    expect(
      (await fx.messages(seeded.chatId)).filter(
        (message) => message.role === 'checkpoint',
      ),
    ).toHaveLength(0);
    expect(
      (await fx.types(seeded.runId)).filter((type) => type === 'run.delivered'),
    ).toHaveLength(0);
  });
});
