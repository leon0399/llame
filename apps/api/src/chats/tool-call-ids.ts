/**
 * Tool-call id normalization for one request (design D13 of `model-roles`).
 *
 * A Chat can replay replies of several models in one request — a model switch
 * keeps the settled tool activity of the reply it closed — and not every wire
 * accepts every id it may receive, nor the same id twice. This module maps the
 * stored ids to the ids one request sends while every stored id stays as it
 * was written: `tool_artifacts`, the `chat_jobs` rows, and the transcript keep
 * the provider's original.
 *
 * The map lives for exactly one request. `buildContext` creates one and
 * threads it through the reply projection, so a call and its result always
 * carry the same wire id, and two occurrences of one stored id get different
 * ones.
 */

import { createHash } from 'node:crypto';
import type { ModelMessage } from 'ai';

/** The shape every replayed tool-call id has to match (D13). */
export const WIRE_TOOL_CALL_ID = /^[a-zA-Z0-9_-]{1,40}$/;

/**
 * The reported limit of OpenAI Chat Completions, below Anthropic's pattern and
 * the 64 of OpenAI Responses (D13).
 */
const MAX_ID_LENGTH = 40;

/** Room for the separator, the 8-character hash, and a `_NN` counter (D13). */
const MAX_PREFIX_LENGTH = 28;

const HASH_LENGTH = 8;

/** One request's map from stored tool-call ids to the ids its wire reads. */
export interface ToolCallIdMap {
  /**
   * The wire id of one stored call, to be used for its result too.
   * `ownModel` says the reply that produced the call records this request's
   * model in its stored `usage.modelId` — the same input the projection's
   * private-parts rule reads.
   */
  resolve(storedId: string, ownModel: boolean): string;
}

class RequestToolCallIds implements ToolCallIdMap {
  /** Every id this request already sends: kept as-is or mapped. */
  private readonly emitted = new Set<string>();

  resolve(storedId: string, ownModel: boolean): string {
    // An id the request's own model produced is portable as it is — unless an
    // earlier part already used it (D13). An id that already matches the
    // pattern on a foreign model needs no rewrite either; only its repeats do.
    if (
      !this.emitted.has(storedId) &&
      (ownModel || WIRE_TOOL_CALL_ID.test(storedId))
    ) {
      this.emitted.add(storedId);

      return storedId;
    }

    const mapped = this.unique(this.mappedId(storedId));

    this.emitted.add(mapped);

    return mapped;
  }

  /**
   * The provider-safe form of an id: every character outside the class becomes
   * `_`, the first 28 characters stay, then the original's hash follows, so
   * two ids that sanitize alike stay distinct (D13).
   */
  private mappedId(storedId: string): string {
    const prefix = storedId
      .replaceAll(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, MAX_PREFIX_LENGTH);

    // The hash keeps two ids that sanitize alike distinct, and is stable
    // across processes, so the same request renders the same ids.
    const hash = createHash('sha256')
      .update(storedId)
      .digest('hex')
      .slice(0, HASH_LENGTH);

    return `${prefix}_${hash}`;
  }

  /** `base`, or `base` with a counter when an earlier id already used it. */
  private unique(base: string): string {
    let candidate = base;

    for (let counter = 1; this.emitted.has(candidate); counter += 1) {
      // The counter stays inside the 40-character bound: a two-digit suffix
      // leaves 37, exactly the length of a full base.
      const suffix = `_${String(counter).padStart(2, '0')}`;

      candidate = `${base.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`;
    }

    return candidate;
  }
}

/** One request's empty tool-call id map. */
export function createToolCallIdMap(): ToolCallIdMap {
  return new RequestToolCallIds();
}

/** `part` with its wire id, unchanged when the map kept the stored one. */
function withWireId<T extends { toolCallId: string }>(
  part: T,
  wire: string,
): T {
  return wire === part.toolCallId ? part : { ...part, toolCallId: wire };
}

/**
 * One live step's wire ids (D13): a call resolves on its own occurrence, so a
 * step that numbers ids per response keeps its repeats distinct, and its
 * result then takes the wire id of the earliest still-unpaired call with the
 * same stored id.
 */
function stepWireIds(
  toolCallIds: ToolCallIdMap,
): (part: { type: string; toolCallId: string }) => string {
  const unpaired: Array<{ storedId: string; wire: string }> = [];

  return (part) => {
    if (part.type !== 'tool-call') {
      const index = unpaired.findIndex(
        (call) => call.storedId === part.toolCallId,
      );

      if (index !== -1) return unpaired.splice(index, 1)[0].wire;
    }

    const wire = toolCallIds.resolve(part.toolCallId, true);

    if (part.type === 'tool-call') {
      unpaired.push({ storedId: part.toolCallId, wire });
    }

    return wire;
  };
}

/**
 * One live step's SDK messages through the request's map (D13). The step's
 * own calls keep their ids unless an earlier part of the request already used
 * them, and every call and its result share one wire id. The input is never
 * mutated: a step the map leaves alone is returned as it was.
 */
export function normalizeStepToolCallIds(
  messages: ReadonlyArray<ModelMessage>,
  toolCallIds: ToolCallIdMap,
): Array<ModelMessage> {
  const resolve = stepWireIds(toolCallIds);

  return messages.map((message): ModelMessage => {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === 'tool-call' || part.type === 'tool-result'
            ? withWireId(part, resolve(part))
            : part,
        ),
      };
    }

    if (message.role === 'tool') {
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === 'tool-result' ? withWireId(part, resolve(part)) : part,
        ),
      };
    }

    return message;
  });
}
