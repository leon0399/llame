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
  const fx = useSegmentsFixture('in-run-switch', {
    allowedTools: ['bash', 'read'],
    modelSwitchDecision: () => Promise.resolve({ toModelId: TARGET }),
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

    const switchPart = host?.parts.find(
      (part) =>
        isContextItemPart(part) &&
        part.data.producer === 'effective-context-change',
    );

    expect(isContextItemPart(switchPart)).toBe(true);

    const switchText = isContextItemPart(switchPart)
      ? switchPart.data.text
      : undefined;

    expect(isString(switchText) && switchText.trim().length > 0).toBe(true);

    if (isString(switchText)) {
      expect(launched.prompts().flat().join('\n')).toContain(switchText);
    }

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

    const deliveredIndex = runEvents.findIndex(
      (event) =>
        event.eventType === 'run.delivered' &&
        isRecord(event.payload) &&
        event.payload['cause'] === 'failover',
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
    expect(supersededIndex).toBeLessThan(deliveredIndex);
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

    const targetPrompt = launched.prompts().at(-1)?.join('\n') ?? '';
    expect(targetPrompt).toContain('steer delivered by switch');

    const reminder = host?.parts.find(
      (part) =>
        isContextItemPart(part) &&
        part.data.producer === 'effective-context-change',
    );

    expect(isContextItemPart(reminder)).toBe(true);

    const reminderText = isContextItemPart(reminder)
      ? reminder.data.text
      : undefined;

    expect(isString(reminderText) && reminderText.length > 0).toBe(true);

    if (isString(reminderText)) {
      expect(targetPrompt.indexOf(reminderText)).toBeGreaterThanOrEqual(0);
      expect(targetPrompt.indexOf(reminderText)).toBeLessThan(
        targetPrompt.indexOf('steer delivered by switch'),
      );
    }
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

    const settledPart = failedReply?.parts.find(
      (part) => isRecord(part) && part['toolCallId'] === 'settled-call',
    );

    const failedPart = failedReply?.parts.find(
      (part) => isRecord(part) && part['toolCallId'] === 'failed-call',
    );

    // Both calls settled before the send broke, so both stay with their
    // outcomes; only the send's streamed text is cut (spec: "Settled tool
    // calls stay").
    expect(settledPart).toMatchObject({
      state: 'output-error',
      errorText:
        'No current Machine: configure machines.default or enter a Workspace.',
    });
    expect(failedPart).toMatchObject({ state: 'output-error' });

    const targetPrompt = launched.prompts().at(-1)?.join('\n') ?? '';

    expect(targetPrompt).toContain('tool:tool-result');
    expect(targetPrompt).not.toContain('discarded tool send text');
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

  it('A switch segment runs threshold-based pre-step compaction', async () => {
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

    const checkpoint = transcript.find(
      (message) => message.role === 'checkpoint',
    );

    const checkpointText = checkpoint?.parts.find(
      (part) => isContextItemPart(part) && part.data.producer === 'compaction',
    );

    const eventTypes = (await events(launched.runId)).map(
      (event) => event.eventType,
    );

    expect(JSON.stringify(checkpointText)).toContain('summary for target');
    expect(
      transcript.some((message) =>
        hasTextPart(message.parts, 'compacted target answer'),
      ),
    ).toBe(true);
    expect(eventTypes).not.toContain('run.compaction_failed');
  });

  it('An ordinary steer segment does not run a pre-step compaction check', async () => {
    const seeded = await seed();
    const streamCallsBefore = fx.harness.models.streamCalls.length;

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

    const pending = await fx.items(launched.chatId);

    const transcript = await messages(launched.chatId);

    expect(
      transcript.some((message) =>
        hasTextPart(message.parts, 'ordinary steer'),
      ),
    ).toBe(true);
    expect(
      (await events(launched.runId)).some(
        (event) => event.eventType === 'run.delivered',
      ),
    ).toBe(true);
    expect(
      (await messages(launched.chatId)).some((message) =>
        hasTextPart(message.parts, 'ordinary steer segment'),
      ),
    ).toBe(true);
    expect(fx.harness.models.streamCalls.length - streamCallsBefore).toBe(2);
    expect(pending).toHaveLength(0);
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
