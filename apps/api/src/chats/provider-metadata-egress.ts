/**
 * The single strip that keeps a text part's or a tool call's opaque provider
 * metadata on the server (design A7). A stored text part keeps the item id the
 * Responses wire handed it, and a stored tool part keeps its call's metadata,
 * because a later request for the same Chat replays them. The owner's chat
 * history response and run event stream apply these strips; exports, public
 * shares, search, logs, and telemetry read only text or typed fields and never
 * reach the metadata.
 *
 * A reasoning part's metadata is not touched: it stays on the owner history
 * response and the owner event stream, as it did before text and tool-call
 * metadata existed.
 *
 * Both functions are pure: an object (or array) is copied only when it
 * actually carries the metadata, and an untouched value comes back by
 * identity.
 */

import { isString, type UnknownRecord } from '@workspace/runtime-safety';

import { mapStoredParts, withoutPayloadParts } from './retained-media-egress';
import { TOOL_PART_PREFIX } from './tool-observation-part';

/** The part type whose metadata text parts carry. */
const TEXT_PART = 'text';

/** The opaque provider metadata field this strip removes. */
const METADATA_KEY = 'providerMetadata';

/** The adapter part id a `model.delta` carries for the server's rebuild. */
const PART_ID_KEY = 'partId';

/**
 * The stored parts without a text part's or a tool call's opaque provider
 * metadata. Everything else — the reasoning parts' own metadata, the text, the
 * result, the order — is untouched.
 *
 * @param parts - Stored message parts, as read from `messages.parts`
 * @returns The same array when no part carries the metadata
 */
export function withoutProviderMetadata(parts: Array<unknown>): Array<unknown> {
  return mapStoredParts(parts, stripPartMetadata);
}

/**
 * A stored run event's payload without the metadata this strip removes: the
 * payload's own field on a `model.delta` or `tool.requested` (and the adapter
 * part id on a `model.delta`, which names the Responses item the metadata
 * came from), and — for `run.continued`, which carries kept parts verbatim —
 * the metadata of those parts.
 *
 * @param eventType - The stored event's type
 * @param payload - The stored payload, as read from `run_events.payload`
 * @returns The same payload when it carries none of that metadata
 */
export function withoutProviderMetadataPayload(
  eventType: string,
  payload: UnknownRecord,
): UnknownRecord {
  return withoutPayloadParts(
    eventType,
    payload,
    (value) => stripPayloadMetadata(eventType, value),
    stripPartMetadata,
  );
}

/** The owner's view of a `model.delta` or `tool.requested` payload. */
function stripPayloadMetadata(
  eventType: string,
  payload: UnknownRecord,
): UnknownRecord {
  const stripsPartId = eventType === 'model.delta';
  const stripsMetadata = stripsPartId || eventType === 'tool.requested';
  if (
    !stripsMetadata ||
    (!Object.hasOwn(payload, METADATA_KEY) &&
      !(stripsPartId && Object.hasOwn(payload, PART_ID_KEY)))
  ) {
    return payload;
  }

  const stripped = { ...payload };
  delete stripped[METADATA_KEY];
  if (stripsPartId) delete stripped[PART_ID_KEY];
  return stripped;
}

/**
 * One part without the metadata this strip removes. Returns the part itself
 * when it is not a text or tool part, or carries no metadata.
 */
function stripPartMetadata(part: UnknownRecord): UnknownRecord {
  const type = part['type'];
  if (
    !Object.hasOwn(part, METADATA_KEY) ||
    !isString(type) ||
    (type !== TEXT_PART && !type.startsWith(TOOL_PART_PREFIX))
  ) {
    return part;
  }

  const stripped = { ...part };
  delete stripped[METADATA_KEY];
  return stripped;
}
