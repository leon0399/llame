import {
  simulateReadableStream,
  streamText,
  type LanguageModelUsage,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';

import type { ModelClient, ModelStreamInput } from './model-client';

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

      const chunks: LanguageModelV3StreamPart[] = [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'fake-response' },
      ];

      if (response.length > 0) {
        chunks.push({
          type: 'text-delta',
          id: 'fake-response',
          delta: response,
        });
      }

      chunks.push(
        { type: 'text-end', id: 'fake-response' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: {
              total: 0,
              noCache: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            outputTokens: { total: 0, text: 0, reasoning: 0 },
          },
        },
      );

      let resolveCompletion: () => void = () => undefined;
      let rejectCompletion: (reason?: unknown) => void = () => undefined;
      const completion = new Promise<void>((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      });
      const result = streamText({
        model: new MockLanguageModelV3({
          provider: 'fake',
          modelId: 'fake-model',
          doStream: () =>
            Promise.resolve({
              stream: simulateReadableStream({ chunks }),
            }),
        }),
        messages: input.messages,
        system: input.system,
        abortSignal: input.abortSignal,
        ...(input.tools
          ? {
              tools: input.tools,
              ...(input.toolChoice !== undefined
                ? { toolChoice: input.toolChoice }
                : {}),
            }
          : {}),
        onChunk: ({ chunk }) => {
          if (chunk.type === 'text-delta') {
            input.onTextDelta?.(chunk.text);
          } else if (chunk.type === 'reasoning-delta') {
            input.onReasoningDelta?.(chunk.text);
          }
        },
        onError: async (event) => {
          try {
            await input.onError?.(event);
            resolveCompletion();
          } catch (error) {
            rejectCompletion(error);
          }
        },
        onFinish: async (event) => {
          try {
            await input.onFinish?.({
              text: event.text,
              usage: ZERO_USAGE,
              finishReason: event.finishReason,
            });
            resolveCompletion();
          } catch (error) {
            rejectCompletion(error);
          }
        },
      });

      return new Proxy(result, {
        get(target, property, receiver): unknown {
          if (property === 'text') {
            return Promise.all([target.text, completion]).then(
              ([text]) => text,
            );
          }

          return Reflect.get(target, property, receiver);
        },
      });
    },
  };
}
