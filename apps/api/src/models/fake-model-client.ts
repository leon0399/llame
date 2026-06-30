import type { LanguageModelUsage, TextStreamPart, streamText } from 'ai';

import type { ModelClient, ModelStreamInput } from './model-client';

type TextStream = AsyncIterable<string> & ReadableStream<string>;
type FullStream = AsyncIterable<TextStreamPart<never>> &
  ReadableStream<TextStreamPart<never>>;

const ZERO_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
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
export function createFakeModelClient(responses: string[]): ModelClient {
  let responseIndex = 0;

  return {
    model: 'fake-model',
    provider: 'fake',
    streamText(input: ModelStreamInput) {
      const response =
        responses.length === 0
          ? ''
          : responses[responseIndex++ % responses.length];

      void input.onFinish?.({
        text: response,
        usage: ZERO_USAGE,
        finishReason: 'stop',
      });

      return createFakeStreamTextResult(response);
    },
  };
}

function createFakeStreamTextResult(
  response: string,
): ReturnType<typeof streamText> {
  return {
    text: Promise.resolve(response),
    textStream: createTextStream(response),
    fullStream: createFullStream(response),
    consumeStream: async () => {},
  } as unknown as ReturnType<typeof streamText>;
}

function createTextStream(response: string): TextStream {
  return new ReadableStream<string>({
    start(controller) {
      if (response.length > 0) {
        controller.enqueue(response);
      }

      controller.close();
    },
  }) as TextStream;
}

function createFullStream(response: string): FullStream {
  return new ReadableStream<TextStreamPart<never>>({
    start(controller) {
      controller.enqueue({ type: 'text-start', id: 'fake-response' });

      if (response.length > 0) {
        controller.enqueue({
          type: 'text-delta',
          id: 'fake-response',
          text: response,
        });
      }

      controller.enqueue({ type: 'text-end', id: 'fake-response' });
      controller.enqueue({
        type: 'finish',
        finishReason: 'stop',
        rawFinishReason: undefined,
        totalUsage: ZERO_USAGE,
      });
      controller.close();
    },
  }) as FullStream;
}
