import type { TextStreamPart, ToolSet } from 'ai';

import type { ModelStreamInput } from './model-client';
import type { ToolCallGate } from './tool-call-gate';

/** The stream seams driven by one provider invocation. */
type StreamInput = Pick<
  ModelStreamInput,
  'onTextDelta' | 'onReasoningDelta' | 'onToolCallMetadata' | 'onToolCall'
>;

/** One part of the SDK's `fullStream`. */
type ForwardedPart = TextStreamPart<ToolSet>;

/**
 * The text and reasoning channels of one provider invocation, forwarded from
 * ONE consumer of the AI SDK result's `fullStream` (design A7/D15/D18).
 * Every client uses this helper, so part boundaries, their opaque provider
 * metadata, and their order are decided in exactly one place:
 *
 * - Text rides `text-delta` parts; a part's start and end carry no text but
 *   may carry its metadata (a Responses item's `itemId` arrives on
 *   `text-start`/`text-end`, never on the delta; a Messages compaction block's
 *   marker rides the start, its citations the end).
 * - Reasoning text rides `reasoning-delta` parts, in stream order.
 * - Provider metadata rides whichever part carries it — `reasoning-start` for
 *   a redacted block, an empty `reasoning-delta` for a withheld thinking
 *   block's signature, `reasoning-end` for a Responses item's `itemId` and
 *   encrypted content — and is forwarded as an empty delivery bound to the id
 *   it names. The run's collector persists that block's signature (or payload)
 *   even when the provider withheld the text, because a later request replays
 *   the block itself. A text part gets the opposite treatment: its metadata
 *   binds to the part its id names and never starts an empty part (design A7).
 * - Part ids are scoped to the provider invocation. An adapter that numbers
 *   its parts per provider response (Messages: `String(index)`) restarts at
 *   zero on every step of a tool loop, so `"0"` would otherwise name two
 *   different parts in one turn and the second block's metadata would bind onto
 *   the first (D18). The scope is the SDK's own zero-based step number
 *   (`finish-step` closes a step, its parts are already in), so a tool turn
 *   reads `0:0`, `0:1`, `1:0` and repeated deliveries for one part keep reusing
 *   one scoped id.
 * - A `tool-call` part's metadata (the Responses item id, a Chat Completions
 *   `thoughtSignature`) is reported from the same loop, right before the gate
 *   releases the call, so the run holds it before the call can execute or be
 *   refused (design A7).
 *
 * The caller starts this consumer beside the SDK result and retains its
 * promise. Terminal callbacks wait for that promise before they persist the
 * turn, while the result's own stream keeps flowing, so the callback cannot
 * deadlock the branch it is waiting for. A stream failure ends this consumer
 * quietly: the run's own consumption (`onError` plus the abort settlement)
 * owns the error.
 */
export async function consumeStreamParts(
  fullStream: AsyncIterable<ForwardedPart>,
  input: StreamInput,
  gate: Pick<ToolCallGate, 'reach' | 'close'>,
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

      if (part.type === 'tool-call') {
        reportCall(part, input, gate);
        continue;
      }

      forwardDelivery(part, step, input);
    }
  } catch {
    // See the contract above: the run's own stream consumption reports the
    // failure, so this consumer just ends.
  } finally {
    gate.close();
  }
}

/**
 * Reports a call's own metadata, then releases the call: every delta ahead of
 * it is delivered by now (#1184), and the metadata is durable before the gate
 * lets the call execute or be refused (A7).
 */
function reportCall(
  part: Extract<ForwardedPart, { type: 'tool-call' }>,
  input: StreamInput,
  gate: Pick<ToolCallGate, 'reach'>,
): void {
  if (part.providerMetadata !== undefined) {
    input.onToolCallMetadata?.(part.toolCallId, part.providerMetadata);
  }

  if (!('invalid' in part && part.invalid)) {
    input.onToolCall?.({
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: part.input,
    });
  }

  gate.reach(part.toolCallId);
}

/** Forwards one text or reasoning delivery, in stream order. */
function forwardDelivery(
  part: ForwardedPart,
  step: number,
  input: StreamInput,
): void {
  // `fullStream` names a delta's text `text` (the provider layer's own part
  // spells a reasoning delta's `delta`); start and end parts carry none. A
  // start or end part with no metadata says nothing the deliveries that carry
  // the part's text or metadata do not say.
  switch (part.type) {
    case 'text-start':
    case 'text-delta':
    case 'text-end': {
      const text = part.type === 'text-delta' ? part.text : '';

      if (text.length === 0 && part.providerMetadata === undefined) return;
      input.onTextDelta?.(text, `${step}:${part.id}`, part.providerMetadata);

      return;
    }

    case 'reasoning-start':
    case 'reasoning-delta':
    case 'reasoning-end': {
      const text = part.type === 'reasoning-delta' ? part.text : '';

      if (text.length === 0 && part.providerMetadata === undefined) return;
      input.onReasoningDelta?.(
        text,
        `${step}:${part.id}`,
        part.providerMetadata,
      );

      return;
    }
  }
}

/**
 * Forwards one `onChunk` delivery to the same seams the `fullStream` consumer
 * drives, for a wire whose adapter puts text starts, ends, and their metadata
 * out of `onChunk`'s reach. A text delta's own metadata is dropped: only the
 * `fullStream` consumer sees a part's start and end, so a delta-level value
 * could bind to a part the other deliveries do not name.
 */
export function forwardChunk(chunk: ForwardedPart, input: StreamInput): void {
  if (chunk.type === 'text-delta') {
    input.onTextDelta?.(chunk.text, chunk.id);

    return;
  }

  if (chunk.type === 'reasoning-delta') {
    input.onReasoningDelta?.(chunk.text, chunk.id, chunk.providerMetadata);

    return;
  }

  if (chunk.type === 'tool-call' && chunk.providerMetadata !== undefined) {
    input.onToolCallMetadata?.(chunk.toolCallId, chunk.providerMetadata);
  }

  if (chunk.type === 'tool-call' && !('invalid' in chunk && chunk.invalid)) {
    input.onToolCall?.({
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
      input: chunk.input,
    });
  }
}
