import { streamText as sdkStreamText } from 'ai';

import {
  createModelStreamFinishCallback,
  type ModelStreamInput,
} from '../models/model-client';
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
    onChunk: ({ chunk }) => {
      if (chunk.type === 'text-delta') {
        input.onTextDelta?.(chunk.text);
      } else if (chunk.type === 'reasoning-delta') {
        input.onReasoningDelta?.(chunk.text);
      }
    },
    onError: input.onError,
    onAbort: settlement.onAbort,
    onFinish: createModelStreamFinishCallback(input.onFinish),
  };
}
