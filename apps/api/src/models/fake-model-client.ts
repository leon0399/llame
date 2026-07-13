import type { LanguageModelUsage, TextStreamPart, streamText } from 'ai';

import type { ModelClient, ModelStreamInput } from './model-client';

type TextStream = AsyncIterable<string> & ReadableStream<string>;
type FullStream = AsyncIterable<TextStreamPart<never>> &
  ReadableStream<TextStreamPart<never>>;

export const ZERO_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  inputTokenDetails: {
    noCacheTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  outputTokens: 0,
  outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
  totalTokens: 0,
};

/**
 * Creates a fake model client that cycles through preset text responses.
 *
 * @param responses - The text responses returned by successive `streamText` calls
 * @returns A model client that streams the provided responses in order
 */
export function createFakeModelClient(
  responses: string[],
  contextWindowTokens = 128_000,
): ModelClient {
  let responseIndex = 0;

  return {
    model: 'fake-model',
    provider: 'fake',
    contextWindowTokens,
    streamText(input: ModelStreamInput) {
      const response =
        responses.length === 0
          ? ''
          : responses[responseIndex++ % responses.length];

      // #73 fidelity: like the real AI SDK, callbacks fire on CONSUMPTION —
      // during the first stream read (or text/consumeStream access), awaited,
      // never synchronously at call time.
      let finishOnce: Promise<void> | undefined;
      const finish = () =>
        (finishOnce ??= (async () => {
          if (response.length > 0) {
            input.onTextDelta?.(response);
          }
          await input.onFinish?.({
            text: response,
            usage: ZERO_USAGE,
            finishReason: 'stop',
          });
        })());

      return createFakeStreamTextResult(response, finish);
    },
  };
}

function createFakeStreamTextResult(
  response: string,
  finish: () => Promise<void>,
): ReturnType<typeof streamText> {
  return {
    // Lazy getter: accessing `text` consumes the (fake) stream, like the SDK.
    get text() {
      return finish().then(() => response);
    },
    textStream: createTextStream(response, finish),
    fullStream: createFullStream(response, finish),
    consumeStream: () => finish(),
  } as unknown as ReturnType<typeof streamText>;
}

function createTextStream(
  response: string,
  finish: () => Promise<void>,
): TextStream {
  let emitted = false;
  return new ReadableStream<string>(
    {
      // pull (not start): runs on the first READ, so an unconsumed stream never
      // fires callbacks — the consumption-driven timing of the real SDK.
      async pull(controller) {
        if (emitted) {
          controller.close();
          return;
        }
        emitted = true;
        if (response.length > 0) {
          controller.enqueue(response);
        }
        await finish();
        controller.close();
      },
      // highWaterMark 0: a default stream pre-fills its queue by calling pull()
      // once AT CONSTRUCTION (WHATWG streams §pull steps) — which would fire
      // the callbacks with no consumer and break consumption-driven timing.
      // With 0, pull runs only on an actual read request.
    },
    { highWaterMark: 0 },
  ) as TextStream;
}

function createFullStream(
  response: string,
  finish: () => Promise<void>,
): FullStream {
  let emitted = false;
  return new ReadableStream<TextStreamPart<never>>(
    {
      // pull (not start): consumption-driven like textStream — reading the full
      // stream fires the same once-only callbacks as the real SDK, where
      // onTextDelta/onFinish fire regardless of which interface is consumed.
      async pull(controller) {
        if (emitted) {
          controller.close();
          return;
        }
        emitted = true;
        controller.enqueue({ type: 'text-start', id: 'fake-response' });

        if (response.length > 0) {
          controller.enqueue({
            type: 'text-delta',
            id: 'fake-response',
            text: response,
          });
        }

        controller.enqueue({ type: 'text-end', id: 'fake-response' });
        await finish();
        controller.enqueue({
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: undefined,
          totalUsage: ZERO_USAGE,
        });
        controller.close();
      },
      // highWaterMark 0 — same construction-time pull() consideration as
      // createTextStream above.
    },
    { highWaterMark: 0 },
  ) as FullStream;
}
