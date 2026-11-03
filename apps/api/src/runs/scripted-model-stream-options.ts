import { streamText as sdkStreamText } from 'ai';

import {
  createModelStreamFinishCallback,
  type ModelStreamInput,
} from '../models/model-client';
import { forwardChunk } from '../models/stream-parts';
import type { AbortSettlement } from '../testing/fake-streaming-model-client';

/**
 * The streamText event handlers backing a scripted turn. A whole-step script
 * clears `onChunk`: the run's one `fullStream` consumer owns text, reasoning,
 * and call metadata (and their part starts and ends), so only the terminal
 * callbacks are bound there. Production then overrides `onAbort` with its own
 * settlement, so the abort's `onError` queues behind that consumer.
 */
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
