import { stepCountIs, type streamText } from 'ai';

import { type ModelStreamInput } from './model-client';

/** The SDK's `stopWhen` value: one condition or several, any of which stops. */
export type ToolLoopStopWhen = Parameters<typeof streamText>[0]['stopWhen'];

/**
 * The tool loop's `stopWhen`: the configured step cap, OR the caller's
 * `stopWhenExtra` (a segment end, run-steering D3). Shared with the scripted
 * client, which sets its own tool loop.
 */
export function toolLoopStopWhen(
  input: Pick<ModelStreamInput, 'maxSteps' | 'stopWhenExtra'>,
): ToolLoopStopWhen {
  // `null` and absent both mean "no cap" (design D1).
  const cap = input.maxSteps ?? undefined;
  const capped = cap === undefined ? () => false : stepCountIs(cap + 1);
  return input.stopWhenExtra === undefined
    ? capped
    : [capped, input.stopWhenExtra];
}
