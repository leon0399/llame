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
