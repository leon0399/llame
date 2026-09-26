import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { streamText, wrapLanguageModel, type LanguageModelUsage } from 'ai';

import type { ModelStreamInput } from './model-client';

function toLanguageModelUsage(usage: LanguageModelV3Usage): LanguageModelUsage {
  const {
    total: inputTokens,
    noCache,
    cacheRead,
    cacheWrite,
  } = usage.inputTokens;
  const { total: outputTokens, text, reasoning } = usage.outputTokens;

  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: noCache,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    },
    outputTokens,
    outputTokenDetails: { textTokens: text, reasoningTokens: reasoning },
    totalTokens:
      inputTokens === undefined && outputTokens === undefined
        ? undefined
        : (inputTokens ?? 0) + (outputTokens ?? 0),
    raw: usage.raw,
    reasoningTokens: reasoning,
    cachedInputTokens: cacheRead,
  };
}

/** Captures each provider finish before the SDK releases its step. */
export function applyRequestUsageCallback(
  streamOptions: Parameters<typeof streamText>[0] & {
    model: LanguageModelV3;
  },
  input: ModelStreamInput,
): void {
  const onRequestUsage = input.onRequestUsage;
  if (onRequestUsage === undefined) return;

  streamOptions.model = wrapLanguageModel({
    model: streamOptions.model,
    middleware: {
      specificationVersion: 'v3',
      wrapStream: async ({ doStream }) => {
        const result = await doStream();
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream<
              LanguageModelV3StreamPart,
              LanguageModelV3StreamPart
            >({
              transform(part, controller) {
                if (part.type === 'finish') {
                  onRequestUsage(toLanguageModelUsage(part.usage));
                }
                controller.enqueue(part);
              },
            }),
          ),
        };
      },
    },
  });
}
