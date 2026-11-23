import { isRecord, isString } from '@workspace/runtime-safety';

import { isContextItemPart } from '../chats/context-item';
import type { Message } from '../db/schema';
import { ProviderFailure } from '../models/provider-failure/provider-failure';
import {
  answer,
  call,
  useSegmentsFixture,
} from '../testing/run-segments.test-fixture';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { dispatchRun } from './worker-harness';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'in-run-switch.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

const TARGET = 'in-run-switch-target';

const failure = (code: 'overloaded' | 'server_error' = 'overloaded') =>
  new ProviderFailure(`scripted ${code}`, { code });

function hasSwitchItem(parts: ReadonlyArray<unknown>): boolean {
  return parts.some(
    (part) =>
      isContextItemPart(part) &&
      part.data.producer === 'effective-context-change',
  );
}

function hasTextPart(parts: ReadonlyArray<unknown>, text: string): boolean {
  return parts.some(
    (part) => isRecord(part) && isString(part['text']) && part['text'] === text,
  );
}

function partTypes(parts: ReadonlyArray<unknown>): Array<string> {
  return parts.flatMap((part) =>
    isRecord(part) && isString(part['type']) ? [part['type']] : [],
  );
}

describe('in-run model switches', () => {
  const switchDecisionCalls = new Map<string, number>();

  const fx = useSegmentsFixture('in-run-switch', {
    allowedTools: ['bash', 'read'],
    modelSwitchDecision: ({ failure }) => {
      const key = failure.code;
      const calls = switchDecisionCalls.get(key) ?? 0;
      switchDecisionCalls.set(key, calls + 1);

      if (failure.code === 'stream_broken' && calls === 0) {
        return Promise.resolve(undefined);
      }

      return Promise.resolve({ toModelId: TARGET });
    },
  });

  const { db, events, messages, seed, launch, terminal, storeItems } = fx;

  function registerTarget(
    text = 'answer from target',
    compactionThresholdTokens?: number,
  ) {
    fx.harness.models.register(TARGET, {
      kind: 'step-script',
      steps: [answer(text)],
      ...(compactionThresholdTokens !== undefined && {
        compactionThresholdTokens,
      }),
    });
  }

  function replyFor(
    transcript: ReadonlyArray<Message>,
    inReplyTo: string,
  ): Message | undefined {
    return transcript.find(
      (message) =>
        message.role === 'assistant' && message.inReplyTo === inReplyTo,
    );
  }

  it('The transcript after a switch and the failed send is not kept', async () => {
    registerTarget();

    const seeded = await seed('keep this user message');

    const launched = await launch(seeded, [
      [
        { type: 'text', id: 'failed-text', text: 'discard this output' },
        { type: 'error', error: failure() },
      ],
    ]);

    await terminal(launched.runId);

    const transcript = await messages(launched.chatId);
    const failedReply = replyFor(transcript, launched.userMessage.id);
    const host = transcript.find((message) => hasSwitchItem(message.parts));

    expect(failedReply?.usage).toMatchObject({
      status: 'error',
      complete: false,
    });
    expect(partTypes(failedReply?.parts ?? [])).toEqual([]);
    expect(host).toBeDefined();
    expect(hasSwitchItem(host?.parts ?? [])).toBe(true);
    expect(
      transcript.some((message) =>
        hasTextPart(message.parts, 'answer from target'),
      ),
    ).toBe(true);
    const runEvents = await events(launched.runId);

    const delivered = runEvents.find(
      (event) =>
        event.eventType === 'run.delivered' &&
        isRecord(event.payload) &&
        event.payload['cause'] === 'failover',
    );

    const switched = runEvents.find(
      (event) => event.eventType === 'model.switched',
    );

    const supersededIndex = runEvents.findIndex(
      (event) => event.eventType === 'model.superseded',
    );

    const completedIndex = runEvents.findIndex(
      (event) => event.eventType === 'model.completed',
    );

    const run = await db((tx) =>
      new RunsRepository(tx).findById(launched.runId, fx.userId),
    );

    expect(delivered?.payload).toMatchObject({ messageId: host?.id });
    expect(switched?.payload).toMatchObject({ origin: 'policy' });
    expect(supersededIndex).toBeGreaterThanOrEqual(0);
    expect(supersededIndex).toBeLessThan(completedIndex);
    expect(JSON.stringify(host?.parts)).not.toContain('scripted overloaded');
    expect(JSON.stringify(run?.error)).not.toContain('scripted overloaded');
    expect(launched.prompts().flat().join('\n')).not.toContain(
      'scripted overloaded',
    );
  });

  it('A steer that waits at the switch reaches the new segment first', async () => {
    registerTarget('response after steer');

    const seeded = await seed();

    const launched = await launch(
      seeded,
      [[{ type: 'error', error: failure('server_error') }]],
      async (_index, run) => {
        await storeItems(run.chatId, ['steer delivered by switch']);
      },
    );

    await terminal(launched.runId);

    const transcript = await messages(launched.chatId);
    const host = transcript.find((message) => hasSwitchItem(message.parts));

    const switchIndex = host?.parts.findIndex(
      (part) =>
        isContextItemPart(part) &&
        part.data.producer === 'effective-context-change',
    );

    expect(partTypes(host?.parts ?? [])).toContain('text');
    expect(switchIndex).toBe(0);
    expect(launched.prompts().join('\n')).toContain(
      'steer delivered by switch',
    );
  });

  it('Settled tool calls stay while an unsettled send is removed', async () => {
    registerTarget('tool-safe continuation');

    const seeded = await seed();

    const launched = await launch(seeded, [
      call('settled-call', 'bash', { command: 'printf settled-tool-output' }),
      [
        { type: 'text', id: 'failed-text', text: 'unsettled send output' },
        { type: 'error', error: failure() },
      ],
    ]);

    await terminal(launched.runId);

    const transcript = await messages(launched.chatId);
    const failedReply = replyFor(transcript, launched.userMessage.id);
    const toolTypes = partTypes(failedReply?.parts ?? []);

    expect(toolTypes).toContain('tool-bash');
    expect(hasTextPart(failedReply?.parts ?? [], 'unsettled send output')).toBe(
      false,
    );
  });

  it('A model switch removes the failed tool-calling send', async () => {
    registerTarget('tool failure recovered');

    const seeded = await seed();

    const failedSend = new ProviderFailure('scripted broken tool send', {
      code: 'stream_broken',
      toolCallStarted: true,
      sends: 11,
    });

    const launched = await launch(seeded, [
      call('settled-call', 'bash', { command: 'printf settled-tool-output' }),
      [
        ...call('failed-call', 'bash', {
          command: 'printf failed-tool-output',
        }),
        { type: 'text', id: 'failed-text', text: 'discarded tool send text' },
        { type: 'error', error: failedSend },
      ],
    ]);

    await terminal(launched.runId);

    const transcript = await messages(launched.chatId);
    const failedReply = replyFor(transcript, launched.userMessage.id);

    expect(
      hasTextPart(failedReply?.parts ?? [], 'discarded tool send text'),
    ).toBe(false);
    expect(partTypes(failedReply?.parts ?? [])).toContain('tool-bash');
    expect(launched.prompts().at(-1)?.join('\n')).toContain('tool:tool-result');
    expect(
      (await events(launched.runId)).some(
        (event) => event.eventType === 'model.switched',
      ),
    ).toBe(true);
  });

  it('A switch after an overload starts the new segment with fresh counts', async () => {
    fx.harness.models.register(TARGET, {
      kind: 'step-script',
      steps: [
        [
          {
            type: 'error',
            error: new ProviderFailure('scripted target retry', {
              code: 'overloaded',
              superseded: { retry: 1, delayMs: 0 },
            }),
          },
        ],
        answer('fresh target segment'),
      ],
    });

    const streamCallsBefore = fx.harness.models.streamCalls.filter(
      (call) => call.modelId === TARGET,
    ).length;

    const clientCallsBefore = fx.harness.models.createClientCalls.filter(
      (call) => call.modelId === TARGET,
    ).length;

    const seeded = await seed();

    const launched = await launch(seeded, [
      [
        {
          type: 'text',
          id: 'first-attempt',
          text: 'discarded overload response',
        },
        { type: 'error', error: failure() },
      ],
    ]);

    await terminal(launched.runId);

    const retryEvents = (await events(launched.runId)).filter(
      (event) => event.eventType === 'model.retrying',
    );

    expect(retryEvents.map((event) => event.payload)).toContainEqual(
      expect.objectContaining({ retry: 1 }),
    );

    expect(
      fx.harness.models.streamCalls.filter((call) => call.modelId === TARGET)
        .length - streamCallsBefore,
    ).toBe(2);
    expect(
      fx.harness.models.createClientCalls.filter(
        (call) => call.modelId === TARGET,
      ).length - clientCallsBefore,
    ).toBe(1);
    expect(
      (
        await db((tx) =>
          new RunEventsRepository(tx).listByRunId(launched.runId, fx.userId),
        )
      ).filter((event) => event.eventType === 'model.switched'),
    ).toHaveLength(1);
  });

  it('A switch segment runs pre-step compaction for a smaller context', async () => {
    fx.harness.models.register(TARGET, {
      kind: 'step-script',
      steps: [answer('summary for target'), answer('compacted target answer')],
      compactionThresholdTokens: 1,
    });

    const seeded = await seed('a request that does not fit the target context');

    const launched = await launch(seeded, [
      [{ type: 'error', error: failure() }],
    ]);

    await terminal(launched.runId);

    const transcript = await messages(launched.chatId);

    const eventTypes = (await events(launched.runId)).map(
      (event) => event.eventType,
    );

    expect(
      transcript.some((message) => message.role === 'checkpoint') ||
        eventTypes.includes('run.compaction_failed'),
    ).toBe(true);
    expect(
      transcript.some((message) =>
        hasTextPart(message.parts, 'compacted target answer'),
      ),
    ).toBe(true);
  });

  it('An ordinary steer segment does not run a pre-step compaction check', async () => {
    const seeded = await seed();

    const launched = await launch(
      seeded,
      [answer('first segment'), answer('ordinary steer segment')],
      async (index, run) => {
        if (index === 0) {
          await storeItems(run.chatId, ['ordinary steer']);
        }
      },
      { compactionThresholdTokens: 1 },
    );

    await terminal(launched.runId);

    const transcript = await messages(launched.chatId);

    expect(transcript.map((message) => message.role)).not.toContain(
      'checkpoint',
    );
    expect(
      (await events(launched.runId)).map((event) => event.eventType),
    ).not.toContain('model.switched');
  });

  it('A synchronous provider throw switches before terminal settlement', async () => {
    registerTarget('sync throw recovered');

    const seeded = await seed();
    fx.harness.models.register(seeded.modelId, {
      kind: 'sync-throw',
      error: failure('server_error'),
    });
    await dispatchRun({
      queue: fx.harness.queue,
      ...seeded,
      userId: fx.userId,
    });

    await terminal(seeded.runId);

    const transcript = await messages(seeded.chatId);

    expect(
      transcript.some((message) =>
        hasTextPart(message.parts, 'sync throw recovered'),
      ),
    ).toBe(true);
    expect(
      (await events(seeded.runId)).map((event) => event.eventType),
    ).toContain('model.switched');
  });
});
