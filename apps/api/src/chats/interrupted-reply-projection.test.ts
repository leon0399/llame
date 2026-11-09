/**
 * The interrupted-reply reasoning rule of `reasoning-output` (run-steering D8),
 * on the three part shapes the wires store: an OpenAI Responses item, an
 * Anthropic Messages signed block, and a Chat Completions thought signature.
 * Pure projection, no database.
 */

import { isRecord } from '@workspace/runtime-safety';

import {
  buildContext,
  type MessagePart,
  type ModelMessage,
  projectStoredReplyParts,
  type StoredMessage,
} from './context-builder';
import { createTemporalItem } from './context-item-producers';

const MODEL = 'test-model';

const WIRES = [
  [
    'Responses',
    { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'ENCRYPTED' } },
  ],
  ['Messages', { anthropic: { signature: 'SIGNED' } }],
  ['Chat Completions', { openaiCompatible: { thoughtSignature: 'SIG' } }],
] as const;

let seq = 0;

function stored(
  overrides: Pick<StoredMessage, 'role' | 'parts'> &
    Partial<Pick<StoredMessage, 'usage'>>,
): StoredMessage {
  seq += 1;
  return {
    id: `message-${seq}`,
    chatId: 'chat-1',
    seq,
    senderUserId: null,
    attachments: [],
    createdAt: new Date('2026-11-08T10:00:00Z'),
    ...overrides,
  };
}

const user = () =>
  stored({ role: 'user', parts: [{ type: 'text', text: 'start' }] });

/** The assistant messages the reply projects to, as one list of content parts. */
function replayedParts(messages: Array<ModelMessage>): Array<unknown> {
  return messages.flatMap((message) =>
    message.role === 'assistant' && Array.isArray(message.content)
      ? message.content
      : [],
  );
}

function project(reply: StoredMessage, modelId = MODEL) {
  const { messages } = buildContext([user(), reply], {
    systemPrompt: 'prompt',
    modelId,
  });
  return replayedParts(messages);
}

const interruptedUsage = {
  status: 'aborted',
  complete: false,
  interrupted: true,
  modelId: MODEL,
};

describe.each(WIRES)('an interrupted reply on the %s wire', (_wire, signed) => {
  const first: MessagePart = {
    type: 'reasoning',
    text: 'first thought',
    providerMetadata: signed,
  };
  const text: MessagePart = { type: 'text', text: 'partial answer' };
  const second: MessagePart = {
    type: 'reasoning',
    text: 'second thought',
    providerMetadata: signed,
  };
  const cut: MessagePart = {
    type: 'reasoning',
    text: 'cut mid-thought',
    providerMetadata: { ...signed, llame: { interrupted: true } },
  };

  it('An interrupted reply keeps only reasoning with a later part', () => {
    const replayed = project(
      stored({
        role: 'assistant',
        usage: interruptedUsage,
        parts: [first, text, second, cut],
      }),
    );

    expect(replayed).toEqual([
      {
        type: 'reasoning',
        text: 'first thought',
        providerOptions: signed,
      },
      { type: 'text', text: 'partial answer' },
    ]);
  });

  it('The cut reasoning part never replays, with a later part or in a completed reply', () => {
    // A withdrawn interrupt: the reply goes on and completes with the cut part
    // still in its transcript, so the mark alone keeps it out of any request.
    const replayed = project(
      stored({
        role: 'assistant',
        usage: { status: 'completed', modelId: MODEL },
        parts: [first, cut, text],
      }),
    );

    expect(replayed).toEqual([
      { type: 'reasoning', text: 'first thought', providerOptions: signed },
      { type: 'text', text: 'partial answer' },
    ]);
  });

  it('keeps a reasoning part that a tool call follows, and drops the one after the last call', () => {
    const call: MessagePart = {
      type: 'tool-read',
      toolCallId: 'call_1',
      state: 'output-available',
      input: { path: '/tmp/a' },
      output: { status: 'success', content: 'a' },
      outcome: 'success',
      classification: 'read_only',
      step: 0,
    };

    const replayed = project(
      stored({
        role: 'assistant',
        usage: interruptedUsage,
        parts: [first, call, { ...second, step: 1 }],
      }),
    );

    expect(
      replayed.map((part) => (isRecord(part) ? part['type'] : part)),
    ).toEqual(['reasoning', 'tool-call']);
  });

  it('replays nothing of the reasoning when the reply ran on another model', () => {
    const replayed = project(
      stored({
        role: 'assistant',
        usage: interruptedUsage,
        parts: [first, text, second],
      }),
      'another-model',
    );

    expect(replayed).toEqual([{ type: 'text', text: 'partial answer' }]);
  });
});

describe('an interrupted reply that ends in reasoning', () => {
  it('projects no assistant message when nothing but reasoning was stored', () => {
    const { messages } = buildContext(
      [
        user(),
        stored({
          role: 'assistant',
          usage: interruptedUsage,
          parts: [
            {
              type: 'reasoning',
              text: 'cut',
              providerMetadata: { llame: { interrupted: true } },
            },
          ],
        }),
      ],
      { systemPrompt: 'prompt', modelId: MODEL },
    );

    expect(messages.map(({ role }) => role)).toEqual(['user']);
  });

  it('keeps the rule of an aborted reply that no interrupt closed: no reasoning replays', () => {
    const replayed = project(
      stored({
        role: 'assistant',
        usage: { status: 'aborted', modelId: MODEL },
        parts: [
          {
            type: 'reasoning',
            text: 'thought',
            providerMetadata: { openai: { itemId: 'rs_1' } },
          },
          { type: 'text', text: 'answer' },
        ],
      }),
    );

    expect(replayed).toEqual([{ type: 'text', text: 'answer' }]);
  });
});

describe('the edges of the interrupted-reply rule', () => {
  const signed = { anthropic: { signature: 'SIGNED' } };
  const thought: MessagePart = {
    type: 'reasoning',
    text: 'thought',
    providerMetadata: signed,
  };
  const text: MessagePart = { type: 'text', text: 'answer' };
  const rolesOf = (messages: Array<ModelMessage>) =>
    messages.map(({ role }) => role);

  it('projects no assistant message when the reply holds nothing but unmarked reasoning', () => {
    const { messages } = buildContext(
      [
        user(),
        stored({
          role: 'assistant',
          usage: interruptedUsage,
          parts: [thought],
        }),
      ],
      { systemPrompt: 'prompt', modelId: MODEL },
    );

    expect(rolesOf(messages)).toEqual(['user']);
  });

  it('keeps every part of an interrupted reply that ends in text', () => {
    expect(
      project(
        stored({
          role: 'assistant',
          usage: interruptedUsage,
          parts: [thought, text],
        }),
      ),
    ).toEqual([
      { type: 'reasoning', text: 'thought', providerOptions: signed },
      { type: 'text', text: 'answer' },
    ]);
  });

  it('keeps a reasoning part that a context item follows', () => {
    const item = createTemporalItem({
      runId: '11111111-1111-4111-8111-111111111111',
      instant: new Date('2026-11-08T10:00:00Z'),
      timeZone: 'UTC',
    });

    const replayed = project(
      stored({
        role: 'assistant',
        usage: interruptedUsage,
        parts: [text, thought, item],
      }),
    );

    expect(replayed).toEqual([
      { type: 'text', text: 'answer' },
      { type: 'reasoning', text: 'thought', providerOptions: signed },
    ]);
  });

  it('drops reasoning that follows the last call of its step, and keeps the call result', () => {
    const call: MessagePart = {
      type: 'tool-read',
      toolCallId: 'call_1',
      state: 'output-available',
      input: { path: '/tmp/a' },
      output: { status: 'success', content: 'a' },
      outcome: 'success',
      classification: 'read_only',
      step: 0,
    };
    const { messages } = buildContext(
      [
        user(),
        stored({
          role: 'assistant',
          usage: interruptedUsage,
          parts: [call, { ...thought, step: 0 }],
        }),
      ],
      { systemPrompt: 'prompt', modelId: MODEL },
    );

    expect(rolesOf(messages)).toEqual(['user', 'assistant', 'tool']);
    expect(
      replayedParts(messages).map((part) =>
        isRecord(part) ? part['type'] : part,
      ),
    ).toEqual(['tool-call']);
  });

  it('replays the reasoning of an unmarked part whose metadata carries another llame key', () => {
    const replayed = project(
      stored({
        role: 'assistant',
        usage: { status: 'completed', modelId: MODEL },
        parts: [
          {
            type: 'reasoning',
            text: 'thought',
            providerMetadata: { ...signed, llame: { interrupted: false } },
          },
          text,
        ],
      }),
    );

    expect(
      replayed.map((part) => (isRecord(part) ? part['type'] : part)),
    ).toEqual(['reasoning', 'text']);
  });

  it('does not treat a reply that failed with an interrupted flag as one an interrupt closed', () => {
    expect(
      project(
        stored({
          role: 'assistant',
          usage: { status: 'failed', interrupted: true, modelId: MODEL },
          parts: [thought, text],
        }),
      ),
    ).toEqual([{ type: 'text', text: 'answer' }]);
  });

  it('keeps trailing reasoning when a Continue Run or compaction replays the parts', () => {
    const { messages } = projectStoredReplyParts([text, thought], {
      privateParts: true,
      mediaKey: (index) => `key-${index}`,
    });

    expect(replayedParts(messages)).toEqual([
      { type: 'text', text: 'answer' },
      { type: 'reasoning', text: 'thought', providerOptions: signed },
    ]);
  });
});
