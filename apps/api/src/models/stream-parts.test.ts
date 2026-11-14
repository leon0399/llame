/**
 * The shared stream forwarder (`consumeStreamParts`): every client reads the
 * whole text and reasoning channels — deltas, part ids, and opaque metadata
 * alike — off ONE consumer of the AI SDK result's `fullStream`, with the
 * adapter's raw part ids scoped to the provider invocation (design A7/D15/D18,
 * task 2.1).
 */
import { simulateReadableStream, type TextStreamPart, type ToolSet } from 'ai';

import { consumeStreamParts, forwardChunk } from './stream-parts';
import { createToolCallGate } from './tool-call-gate';

type Delivery = [string, string | undefined, unknown];

type Forwards = {
  texts: Array<Delivery>;
  reasoning: Array<Delivery>;
  tools: Array<[string, unknown]>;
};

/** Runs the forwarder and records every delivery it makes, in order. */
async function forward(
  chunks: Array<TextStreamPart<ToolSet>>,
): Promise<Forwards> {
  const forwards: Forwards = { texts: [], reasoning: [], tools: [] };
  await consumeStreamParts(
    simulateReadableStream<TextStreamPart<ToolSet>>({ chunks }),
    {
      onTextDelta: (text, partId, providerMetadata) =>
        forwards.texts.push([text, partId, providerMetadata]),
      onReasoningDelta: (text, partId, providerMetadata) =>
        forwards.reasoning.push([text, partId, providerMetadata]),
      onToolCallMetadata: (toolCallId, providerMetadata) =>
        forwards.tools.push([toolCallId, providerMetadata]),
    },
    createToolCallGate(),
  );

  return forwards;
}

/** The SDK's own step boundary: the step it closes is `stepNumber` steps in. */
function finishStep(): Extract<
  TextStreamPart<ToolSet>,
  { type: 'finish-step' }
> {
  return {
    type: 'finish-step',
    response: { id: 'response-1', timestamp: new Date(0), modelId: 'test' },
    usage: {
      inputTokens: 0,
      inputTokenDetails: {
        noCacheTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokens: 0,
      outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      totalTokens: 0,
    },
    finishReason: 'stop',
    rawFinishReason: undefined,
    providerMetadata: undefined,
  };
}

describe('consumeStreamParts', () => {
  it('forwards a text part’s id and metadata in stream order, scoping raw ids per provider step', async () => {
    const first = { openai: { itemId: 'msg_1' } };

    const { texts } = await forward([
      { type: 'text-start', id: 'msg_1', providerMetadata: first },
      { type: 'text-delta', id: 'msg_1', text: 'a' },
      // The end repeats the item id and adds the item's own channels; it
      // carries no text, and the collector must still see it by id.
      {
        type: 'text-end',
        id: 'msg_1',
        providerMetadata: { openai: { itemId: 'msg_1', annotations: [] } },
      },
      // The adapter restarts its ids on the next provider step.
      finishStep(),
      { type: 'text-start', id: 'msg_1' },
      { type: 'text-delta', id: 'msg_1', text: 'b' },
    ]);

    // A start or end with no metadata says nothing the other deliveries do
    // not, so it is not forwarded; the scoped id keeps the two `msg_1`s apart.
    expect(texts).toEqual([
      ['', '0:msg_1', first],
      ['a', '0:msg_1', undefined],
      ['', '0:msg_1', { openai: { itemId: 'msg_1', annotations: [] } }],
      ['b', '1:msg_1', undefined],
    ]);
  });

  it('forwards a reasoning part’s id and metadata in stream order, scoping raw ids per provider step', async () => {
    const signature = { anthropic: { signature: 'SIG_A' } };

    const { reasoning } = await forward([
      // Step 0: a redacted block (its metadata rides the start, and it has no
      // text at all), then a thinking block whose text streams normally.
      {
        type: 'reasoning-start',
        id: '0',
        providerMetadata: { anthropic: { redactedData: 'REDACTED_A' } },
      },
      { type: 'reasoning-end', id: '0' },
      { type: 'reasoning-start', id: '1' },
      { type: 'reasoning-delta', id: '1', text: 'thinking' },
      { type: 'reasoning-end', id: '1' },
      finishStep(),
      // Step 1 of the same tool loop: the adapter restarts at index `0`.
      { type: 'reasoning-start', id: '0' },
      {
        type: 'reasoning-delta',
        id: '0',
        text: '',
        providerMetadata: signature,
      },
      { type: 'reasoning-end', id: '0' },
    ]);

    // The withheld and redacted deliveries carry no text and their metadata;
    // the scoped id keeps the turn's two `0`s apart. A part with neither text
    // nor metadata says nothing the other deliveries do not, so it is not
    // forwarded at all.
    expect(reasoning).toEqual([
      ['', '0:0', { anthropic: { redactedData: 'REDACTED_A' } }],
      ['thinking', '0:1', undefined],
      ['', '1:0', signature],
    ]);
  });

  it('keeps text and reasoning deliveries in one stream order', async () => {
    // One consumer for both channels is what preserves their relative order
    // (design D18); the log below records nothing else.
    const log: Array<string> = [];
    const metadata = { openai: { itemId: 'msg_1' } };
    await consumeStreamParts(
      simulateReadableStream<TextStreamPart<ToolSet>>({
        chunks: [
          { type: 'reasoning-delta', id: '0', text: 'think' },
          { type: 'text-start', id: 'msg_1', providerMetadata: metadata },
          { type: 'text-delta', id: 'msg_1', text: 'answer' },
          { type: 'text-end', id: 'msg_1' },
          { type: 'reasoning-delta', id: '0', text: 'more' },
        ],
      }),
      {
        onTextDelta: (text, partId) =>
          log.push(`text ${partId}:${text.length}`),
        onReasoningDelta: (text) => log.push(`reasoning ${text}`),
      },
      createToolCallGate(),
    );

    expect(log).toEqual([
      'reasoning think',
      'text 0:msg_1:0',
      'text 0:msg_1:6',
      'reasoning more',
    ]);
  });

  it('forwards a call’s metadata before the gate reaches the call', async () => {
    const order: Array<string> = [];
    const gate = createToolCallGate();
    gate.attach();
    // The refusal path reports through the synchronous `whenReached`, so a
    // report that ran after `gate.reach` would land here second.
    gate.whenReached('call-1', () => order.push('call'));
    const metadata = { openai: { itemId: 'fc_1' } };

    const reported: Array<[string, unknown]> = [];

    const reportedCalls: Array<{
      toolCallId: string;
      toolName: string;
      input: unknown;
    }> = [];

    await consumeStreamParts(
      simulateReadableStream<TextStreamPart<ToolSet>>({
        chunks: [
          { type: 'reasoning-delta', id: '0', text: 'think' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'echo',
            input: { value: 'hello' },
            providerMetadata: metadata,
          },
        ],
      }),
      {
        onToolCallMetadata: (toolCallId, providerMetadata) => {
          order.push('metadata');
          reported.push([toolCallId, providerMetadata]);
        },
        onToolCall: (call) => {
          order.push('tool');
          reportedCalls.push(call);
        },
      },
      gate,
    );

    expect(order).toEqual(['metadata', 'tool', 'call']);
    expect(reported).toEqual([['call-1', metadata]]);
    expect(reportedCalls).toEqual([
      { toolCallId: 'call-1', toolName: 'echo', input: { value: 'hello' } },
    ]);
  });

  it('reports a streamed tool call to the model callback', () => {
    const reportedCalls: Array<unknown> = [];
    const metadata: Array<unknown> = [];

    forwardChunk(
      {
        type: 'tool-call',
        toolCallId: 'call-2',
        toolName: 'echo',
        input: { value: 'world' },
        providerMetadata: { openai: { itemId: 'fc_2' } },
      },
      {
        onToolCall: (call) => reportedCalls.push(call),
        onToolCallMetadata: (_id, value) => metadata.push(value),
      },
    );

    expect(reportedCalls).toEqual([
      { toolCallId: 'call-2', toolName: 'echo', input: { value: 'world' } },
    ]);
    expect(metadata).toEqual([{ openai: { itemId: 'fc_2' } }]);
  });

  it('ends quietly when the stream fails, leaving the error to the caller’s own consumption', async () => {
    // The caller's own consumption of the same result owns the failure
    // (`onError` plus the abort settlement); this fire-and-forget consumer
    // must not throw a second error out of a promise nobody awaits.
    const failing: AsyncIterable<TextStreamPart<ToolSet>> = {
      [Symbol.asyncIterator]() {
        let delivered = false;

        return {
          next: () => {
            if (delivered) {
              return Promise.reject(new Error('provider stream died'));
            }

            delivered = true;

            return Promise.resolve({
              done: false,
              value: {
                type: 'reasoning-delta',
                id: '0',
                text: 'before the failure',
              },
            });
          },
        };
      },
    };

    const deliveries: Array<Delivery> = [];

    await expect(
      consumeStreamParts(
        failing,
        {
          onReasoningDelta: (text, partId, providerMetadata) =>
            deliveries.push([text, partId, providerMetadata]),
        },
        createToolCallGate(),
      ),
    ).resolves.toBeUndefined();
    // What did arrive before the failure was still forwarded.
    expect(deliveries).toEqual([['before the failure', '0:0', undefined]]);
  });

  it('releases calls it never reached when the stream ends', async () => {
    const gate = createToolCallGate();
    gate.attach();
    const released = gate.reached('never-reached').then(() => true);

    await consumeStreamParts(
      simulateReadableStream<TextStreamPart<ToolSet>>({ chunks: [] }),
      {},
      gate,
    );

    await expect(released).resolves.toBe(true);
  });
});
