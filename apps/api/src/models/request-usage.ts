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

/**
 * A provider part that carries streamed output: answer or reasoning text. The
 * run's own delta rule (#155) counts the same deliveries one layer up, so an
 * empty metadata-only delivery — a part boundary whose text the provider
 * withheld — opens no window here either.
 */
function isOutputDelta(part: LanguageModelV3StreamPart): boolean {
  return (
    (part.type === 'text-delta' || part.type === 'reasoning-delta') &&
    part.delta.length > 0
  );
}

/**
 * Re-emits a provider stream unchanged, reporting that one request's
 * generation window as its `finish` part passes: from its first streamed output
 * delta to that finish, or from the request itself when it streamed none. The
 * clock is monotonic, because the sum of these windows is persisted as the
 * turn's generation time and a wall-clock correction mid-run would otherwise
 * inject a negative or absurd gap.
 */
function measureGenerationWindow(
  stream: ReadableStream<LanguageModelV3StreamPart>,
  onRequestUsage: NonNullable<ModelStreamInput['onRequestUsage']>,
  requestStartedAt: number,
): ReadableStream<LanguageModelV3StreamPart> {
  let firstOutputDeltaAt: number | undefined;
  return stream.pipeThrough(
    new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
      transform(part, controller) {
        if (isOutputDelta(part)) {
          firstOutputDeltaAt ??= performance.now();
        }
        if (part.type === 'finish') {
          onRequestUsage(
            toLanguageModelUsage(part.usage),
            // A request that streamed no output still generated — a bare tool
            // call carries argument tokens — so it reports its whole span
            // rather than a zero-length window.
            performance.now() - (firstOutputDeltaAt ?? requestStartedAt),
          );
        }
        controller.enqueue(part);
      },
    }),
  );
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
        const requestStartedAt = performance.now();
        const result = await doStream();
        return {
          ...result,
          stream: measureGenerationWindow(
            result.stream,
            onRequestUsage,
            requestStartedAt,
          ),
        };
      },
    },
  });
}
