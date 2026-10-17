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
 * A provider part that opens a request's generation window: the first part
 * carrying generated text, whichever channel it is on. Wider than the run's own
 * delta rule (`ModelStreamInput.onTextDelta`, which keeps counting answer and
 * reasoning text for `chunkCount`/`firstTokenMs`): a streamed tool-call argument
 * is output too, so a request whose only output is a tool call measures from the
 * moment the provider produced its first argument instead of billing its own
 * prefill. A part that carries none — a part boundary, a metadata-only delivery,
 * an adapter that hands over its arguments as one `tool-call` — opens nothing,
 * and such a request falls back to its whole span rather than dropping its
 * argument tokens out from under the rate.
 */
function opensGenerationWindow(part: LanguageModelV3StreamPart): boolean {
  if (
    part.type === 'tool-input-delta' ||
    part.type === 'text-delta' ||
    part.type === 'reasoning-delta'
  ) {
    return part.delta.length > 0;
  }
  return false;
}

/**
 * Re-emits a provider stream unchanged, reporting that one request's
 * generation window as its `finish` part passes: from the first part that opens
 * it (`opensGenerationWindow`) to that finish, or from the request itself when
 * nothing opened one. The clock is monotonic, because the sum of these windows
 * is persisted as the turn's generation time and a wall-clock correction
 * mid-run would otherwise inject a negative or absurd gap.
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
        if (opensGenerationWindow(part)) {
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
