import type { TextStreamPart, ToolSet } from 'ai';

import type { ModelStreamInput } from './model-client';

/**
 * The whole reasoning channel of one provider invocation, forwarded from ONE
 * consumer of the AI SDK result's `fullStream` (design D15/D18, task 3.4).
 * Every client uses this helper, so part boundaries, their opaque provider
 * metadata, and their order are decided in exactly one place:
 *
 * - Reasoning text rides `reasoning-delta` parts, in stream order.
 * - Provider metadata rides whichever part carries it — `reasoning-start` for
 *   a redacted block, an empty `reasoning-delta` for a withheld thinking
 *   block's signature, `reasoning-end` for a Responses item's `itemId` and
 *   encrypted content — and is forwarded as an empty delivery bound to the id
 *   it names. The run's collector persists that block's signature (or payload)
 *   even when the provider withheld the text, because a later request replays
 *   the block itself.
 * - Part ids are scoped to the provider invocation. An adapter that numbers
 *   its reasoning blocks per provider response (Messages: `String(index)`)
 *   restarts at zero on every step of a tool loop, so `"0"` would otherwise
 *   name two different parts in one turn and the second block's metadata would
 *   bind onto the first (D18). The scope is the SDK's own zero-based step
 *   number (`finish-step` closes a step, its parts are already in), so a tool
 *   turn reads `0:0`, `0:1`, `1:0` and repeated deliveries for one part keep
 *   reusing one scoped id.
 *
 * The caller starts this consumer beside the SDK result and retains its
 * promise. Terminal callbacks wait for that promise before they persist the
 * turn, while the result's own stream keeps flowing, so the callback cannot
 * deadlock the branch it is waiting for. A stream failure ends this consumer
 * quietly: the run's own consumption (`onError` plus the abort settlement)
 * owns the error.
 */
export async function consumeReasoningStream(
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>,
  onReasoningDelta: NonNullable<ModelStreamInput['onReasoningDelta']>,
): Promise<void> {
  // Zero-based step number, matching the SDK's own (`finish-step` closes the
  // step its parts already belong to). A stream that announces no step keeps
  // everything in `0`, which is still unique within the turn.
  let step = 0;
  try {
    for await (const part of fullStream) {
      if (part.type === 'finish-step') {
        step += 1;
        continue;
      }
      if (
        part.type !== 'reasoning-start' &&
        part.type !== 'reasoning-delta' &&
        part.type !== 'reasoning-end'
      ) {
        continue;
      }
      // `fullStream` names a reasoning delta's text `text` (the provider
      // layer's own part spells it `delta`); start and end parts carry no
      // text at all.
      const text = part.type === 'reasoning-delta' ? part.text : '';
      const providerMetadata = part.providerMetadata;
      // A start or end part with no metadata says nothing the deliveries that
      // carry the part's text or metadata do not say themselves.
      if (text.length === 0 && providerMetadata === undefined) continue;
      onReasoningDelta(text, `${step}:${part.id}`, providerMetadata);
    }
  } catch {
    // See the contract above: the run's own stream consumption reports the
    // failure, so this consumer just ends.
  }
}
