import { streamText as sdkStreamText } from 'ai';

import {
  createModelStreamFinishCallback,
  type ModelStreamInput,
} from '../models/model-client';
import { forwardChunk } from '../models/stream-parts';
import type { AbortSettlement } from '../testing/fake-streaming-model-client';

/** The streamText event handlers backing a scripted turn. */
export function scriptedStreamHandlers(
  input: ModelStreamInput,
  settlement: AbortSettlement,
): Pick<
  Parameters<typeof sdkStreamText>[0],
  'onChunk' | 'onError' | 'onAbort' | 'onFinish'
> {
  return {
    onChunk: ({ chunk }) => forwardChunk(chunk, input),
    onError: input.onError,
    onAbort: settlement.onAbort,
    onFinish: createModelStreamFinishCallback(input.onFinish),
  };
}

/**
 * The handlers a whole-step script installs instead of `onChunk`: the run's
 * one `fullStream` consumer owns text, reasoning, and call metadata (and their
 * part starts and ends), so only the terminal callbacks are bound here. They
 * are queued after that consumer by `deferTerminalCallbacks` before the SDK
 * call, because the consumer is what drains the stream the callbacks close.
 */
export function stepScriptStreamHandlers(
  input: ModelStreamInput,
  settlement: AbortSettlement,
): Pick<
  Parameters<typeof sdkStreamText>[0],
  'onError' | 'onAbort' | 'onFinish'
> {
  return {
    onError: input.onError,
    onAbort: settlement.onAbort,
    onFinish: createModelStreamFinishCallback(input.onFinish),
  };
}
