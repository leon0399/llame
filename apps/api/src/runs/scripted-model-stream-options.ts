import { stepCountIs, streamText as sdkStreamText } from 'ai';

import {
  createModelStreamFinishCallback,
  type ModelStreamInput,
} from '../models/model-client';
import type { AbortSettlement } from '../testing/fake-streaming-model-client';
import type { HarnessBehavior } from './scripted-model-client';

/** Forwards tool options, plus the conversation-recall step cap, as offered. */
export function resolveHarnessStreamOptions(
  input: ModelStreamInput,
  behavior: HarnessBehavior,
): Pick<
  Parameters<typeof sdkStreamText>[0],
  'tools' | 'toolChoice' | 'stopWhen'
> {
  if (!input.tools) return {};
  return {
    tools: input.tools,
    ...(input.toolChoice !== undefined && { toolChoice: input.toolChoice }),
    ...((behavior.kind === 'conversation-recall' ||
      behavior.kind === 'tool-script') && {
      stopWhen: stepCountIs((input.maxSteps ?? 8) + 1),
    }),
  };
}

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
