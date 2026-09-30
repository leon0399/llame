import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import { wrapLanguageModel, type streamText } from 'ai';

import type { ModelStreamInput } from './model-client';

/**
 * How long a provider stream may stay silent before the request is failed
 * (design D4). The window is armed before the request leaves, so a stalled
 * handshake counts, and every part restarts it.
 */
export const STREAM_IDLE_TIMEOUT_MS = 300_000;

/**
 * A provider stream that produced nothing for the whole idle window. The
 * message is llame's own — never endpoint text — so every client's error
 * sanitizer passes this error through with its code intact.
 */
export class ModelStreamIdleError extends Error {
  readonly code = 'model_stream_idle';

  constructor() {
    super(
      `Model stream was idle for ${STREAM_IDLE_TIMEOUT_MS / 1000} seconds.`,
    );
    this.name = 'ModelStreamIdleError';
  }
}

/** One provider request's idle window and what expiry does to it. */
interface IdleWatchdog {
  /** The signal the provider call carries: the Run's, linked to `idle`. */
  readonly signal: AbortSignal;
  /** Restarts the window; the first call is before the request leaves. */
  arm: () => void;
  /** Sets what expiry does: reject the request, or error the stream. */
  onExpiry: (fail: (error: ModelStreamIdleError) => void) => void;
  /** Ends the window for good and detaches the Run's abort listener. */
  settle: () => void;
}

/** What expiry does before the caller has said: nothing, yet. */
const NO_EXPIRY: (error: ModelStreamIdleError) => void = () => undefined;

function createIdleWatchdog(runSignal: AbortSignal | undefined): IdleWatchdog {
  const idle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail: (error: ModelStreamIdleError) => void = NO_EXPIRY;
  // Settling is final: a part that arrives after the stream ended, the
  // provider errored, or the run aborted must not reopen the window.
  let settled = false;

  const settle = (): void => {
    settled = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    runSignal?.removeEventListener('abort', onRunAbort);
  };
  function onRunAbort(): void {
    settle();
    idle.abort();
  }
  runSignal?.addEventListener('abort', onRunAbort, { once: true });

  return {
    signal:
      runSignal === undefined
        ? idle.signal
        : AbortSignal.any([runSignal, idle.signal]),
    arm: () => {
      if (settled) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        idle.abort();
        fail(new ModelStreamIdleError());
      }, STREAM_IDLE_TIMEOUT_MS);
    },
    onExpiry: (next) => (fail = next),
    settle,
  };
}

/**
 * Fails a provider request whose stream is silent for
 * `STREAM_IDLE_TIMEOUT_MS`, before headers and between parts alike (design
 * D4). The middleware issues `doStream` itself: the SDK hands in a
 * closure over the untransformed params, which cannot carry the watchdog's
 * own abort signal.
 */
async function watchStream(
  model: LanguageModelV3,
  params: LanguageModelV3CallOptions,
  runSignal: AbortSignal | undefined,
): Promise<LanguageModelV3StreamResult> {
  const watchdog = createIdleWatchdog(runSignal);
  const stalled = new Promise<never>((_, reject) => {
    watchdog.onExpiry(reject);
  });
  watchdog.arm();
  try {
    const result = await Promise.race([
      model.doStream({ ...params, abortSignal: watchdog.signal }),
      // Once the request settled on its own, an expiry errors the stream
      // instead: this promise has no reader left.
      stalled,
    ]);
    return { ...result, stream: watchedParts(result.stream, watchdog) };
  } catch (error) {
    watchdog.settle();
    throw error;
  }
}

/** The provider parts, each of which restarts the idle window. */
function watchedParts(
  source: ReadableStream<LanguageModelV3StreamPart>,
  watchdog: IdleWatchdog,
): ReadableStream<LanguageModelV3StreamPart> {
  const reader = source.getReader();
  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      watchdog.onExpiry((error) => {
        watchdog.settle();
        controller.error(error);
      });
    },
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          watchdog.settle();
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        watchdog.settle();
        controller.error(error);
        return;
      }
      watchdog.arm();
    },
    cancel(reason) {
      watchdog.settle();
      return reader.cancel(reason);
    },
  });
}

/**
 * Fails a provider stream that stops producing (design D4): the timer is
 * armed before the request leaves, so a stalled handshake counts toward the
 * first part, and every part restarts it. Each provider request is its own
 * `streamText` step, so a long tool between two requests is not provider
 * silence and never arms a window.
 */
export function applyStreamIdleWatchdog(
  streamOptions: Parameters<typeof streamText>[0] & {
    model: LanguageModelV3;
  },
  input: ModelStreamInput,
): void {
  streamOptions.model = wrapLanguageModel({
    model: streamOptions.model,
    middleware: {
      specificationVersion: 'v3',
      wrapStream: async ({ params, model }) =>
        watchStream(model, params, input.abortSignal),
    },
  });
}
