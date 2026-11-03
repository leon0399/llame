/**
 * The single strip that keeps a text part's or a tool call's opaque provider
 * metadata on the server (design A7). A stored text part keeps the item id the
 * Responses wire handed it, and a stored tool part keeps its call's metadata,
 * because a later request for the same Chat replays them. Every path that
 * writes stored data to an owner-facing sink — the history response, the run
 * event stream, and the Continue/Regenerate job payload — applies one of these
 * two functions first.
 *
 * A reasoning part's metadata is deliberately NOT stripped: it is on the
 * history response today, and the UI reads it from the stored part, so this
 * module keeps exactly that behavior and removes only what this change adds.
 *
 * Both functions are pure: an object (or array) is copied only when it
 * actually carries the metadata, and an untouched value comes back by
 * identity.
 */

import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

/** The part type whose metadata this change added. */
const TEXT_PART = 'text';

/** Tool parts are stored as `tool-<name>` (AI SDK vocabulary). */
const TOOL_PART_PREFIX = 'tool-';

/** The opaque provider metadata field this change added to text and tool parts. */
const METADATA_KEY = 'providerMetadata';

/** Run event type whose payload holds the kept parts verbatim. */
const RUN_CONTINUED_EVENT = 'run.continued';

/**
 * Run event types that carry the metadata this change added at the payload
 * level. `reasoning.delta` has carried its own field since before this change
 * and keeps it.
 */
const METADATA_EVENT_TYPES = {
  'model.delta': true,
  'tool.requested': true,
};

/**
 * The stored parts without a text part's or a tool call's opaque provider
 * metadata. Everything else — the reasoning parts' own metadata, the text, the
 * result, the order — is untouched.
 *
 * @param parts - Stored message parts, as read from `messages.parts`
 * @returns The same array when no part carries the metadata
 */
export function withoutProviderMetadata(parts: Array<unknown>): Array<unknown> {
  let stripped: Array<unknown> | undefined;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const next = isRecord(part) ? stripPartMetadata(part) : part;
    if (next === part) {
      continue;
    }
    stripped ??= parts.slice();
    stripped[index] = next;
  }

  return stripped ?? parts;
}

/**
 * A stored run event's payload without the metadata this change added: the
 * payload's own field on a `model.delta` or `tool.requested`, and — for
 * `run.continued`, which carries kept parts verbatim — the metadata of those
 * parts.
 *
 * @param eventType - The stored event's type
 * @param payload - The stored payload, as read from `run_events.payload`
 * @returns The same payload when it carries none of that metadata
 */
export function withoutProviderMetadataPayload(
  eventType: string,
  payload: UnknownRecord,
): UnknownRecord {
  const keptParts =
    eventType === RUN_CONTINUED_EVENT ? payload['parts'] : undefined;
  const strippedParts = Array.isArray(keptParts)
    ? withoutProviderMetadata(keptParts)
    : undefined;
  const partsChanged =
    strippedParts !== undefined && strippedParts !== keptParts;
  const fieldChanged =
    Object.hasOwn(METADATA_EVENT_TYPES, eventType) &&
    Object.hasOwn(payload, METADATA_KEY);
  if (!partsChanged && !fieldChanged) {
    return payload;
  }

  const stripped = { ...payload };
  if (fieldChanged) {
    delete stripped[METADATA_KEY];
  }
  if (partsChanged) {
    stripped['parts'] = strippedParts;
  }

  return stripped;
}

/**
 * One part without the metadata this change added. Returns the part itself
 * when it is not a text or tool part, or carries no metadata.
 */
function stripPartMetadata(part: UnknownRecord): UnknownRecord {
  if (!Object.hasOwn(part, METADATA_KEY)) {
    return part;
  }
  const type = part['type'];
  if (!isString(type)) {
    return part;
  }
  if (type !== TEXT_PART && !type.startsWith(TOOL_PART_PREFIX)) {
    return part;
  }

  const stripped = { ...part };
  delete stripped[METADATA_KEY];
  return stripped;
}
