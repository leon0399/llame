/**
 * The shared reasoning forwarder (`consumeReasoningStream`): every client
 * reads the whole reasoning channel — text and opaque metadata alike — off ONE
 * consumer of the AI SDK result's `fullStream`, with the adapter's raw part
 * ids scoped to the provider invocation (design D15/D18, task 3.4).
 */
import { simulateReadableStream, type TextStreamPart, type ToolSet } from 'ai';

import { consumeReasoningStream } from './reasoning-stream';

type Delivery = [string, string | undefined, unknown];

/** Records every delivery the forwarder makes, in order. */
async function forward(chunks: Array<TextStreamPart<ToolSet>>) {
  const deliveries: Array<Delivery> = [];
  await consumeReasoningStream(
    simulateReadableStream<TextStreamPart<ToolSet>>({ chunks }),
    (text, partId, providerMetadata) =>
      deliveries.push([text, partId, providerMetadata]),
  );
  return deliveries;
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

describe('consumeReasoningStream', () => {
  it('forwards text and metadata in stream order, scoping raw ids per provider step', async () => {
    const signature = { anthropic: { signature: 'SIG_A' } };
    const deliveries = await forward([
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
    expect(deliveries).toEqual([
      ['', '0:0', { anthropic: { redactedData: 'REDACTED_A' } }],
      ['thinking', '0:1', undefined],
      ['', '1:0', signature],
    ]);
  });

  it('forwards nothing for a stream with no reasoning output', async () => {
    const deliveries = await forward([
      { type: 'text-delta', id: 't', text: 'answer' },
      { type: 'reasoning-start', id: '0' },
      { type: 'reasoning-end', id: '0' },
    ]);

    expect(deliveries).toEqual([]);
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
      consumeReasoningStream(failing, (text, partId, providerMetadata) =>
        deliveries.push([text, partId, providerMetadata]),
      ),
    ).resolves.toBeUndefined();
    // What did arrive before the failure was still forwarded.
    expect(deliveries).toEqual([['before the failure', '0:0', undefined]]);
  });
});
