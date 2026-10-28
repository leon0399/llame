/**
 * The single strip that keeps retained read bytes on the server. A stored
 * part keeps `retainedMedia` beside its result (retain-read-media D3), so every
 * path that writes stored data to a client — the history response, the run
 * event stream, and the Continue/Regenerate job payload — applies one of these
 * two functions first.
 *
 * Both are pure: an object (or array) is copied only when it actually carries
 * retained bytes, and an untouched value comes back by identity.
 */

import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';

/** The stored field that carries the bytes; it never leaves the server. */
const RETAINED_MEDIA_KEY = 'retainedMedia';

/** The part that holds a prompt-imports item. */
const DATA_CONTEXT_PART = 'data-context';

/** The context-item producer whose entries keep their own bytes. */
const PROMPT_IMPORTS_PRODUCER = 'prompt-imports';

/** Run event type whose payload holds the kept parts verbatim. */
const RUN_CONTINUED_EVENT = 'run.continued';

/**
 * The stored parts without their retained bytes: the top-level
 * `retainedMedia` of every part, and the `retainedMedia` of each entry in a
 * `prompt-imports` `data-context` part's `data.payload.imports`. Everything
 * else — the result, the thumbnail, the dimensions, the order — is untouched.
 *
 * @param parts - Stored message parts, as read from `messages.parts`
 * @returns The same array when no part carries retained bytes
 */
export function withoutRetainedMedia(parts: Array<unknown>): Array<unknown> {
  let stripped: Array<unknown> | undefined;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const next = stripRetainedMedia(part);
    if (next === part) {
      continue;
    }
    stripped ??= parts.slice();
    stripped[index] = next;
  }

  return stripped ?? parts;
}

/**
 * A stored run event's payload without its retained bytes: the payload's own
 * `retainedMedia` field, and — for `run.continued`, which carries kept parts
 * verbatim — the bytes of those parts.
 *
 * @param eventType - The stored event's type
 * @param payload - The stored payload, as read from `run_events.payload`
 * @returns The same payload when it carries no retained bytes
 */
export function withoutRetainedMediaPayload(
  eventType: string,
  payload: UnknownRecord,
): UnknownRecord {
  const keptParts =
    eventType === RUN_CONTINUED_EVENT ? payload['parts'] : undefined;
  const strippedParts = Array.isArray(keptParts)
    ? withoutRetainedMedia(keptParts)
    : undefined;
  const partsChanged =
    strippedParts !== undefined && strippedParts !== keptParts;
  if (!partsChanged && !Object.hasOwn(payload, RETAINED_MEDIA_KEY)) {
    return payload;
  }

  const stripped = { ...payload };
  delete stripped[RETAINED_MEDIA_KEY];
  if (partsChanged) {
    stripped['parts'] = strippedParts;
  }

  return stripped;
}

/**
 * One part without retained bytes: its own top-level field, and the field of
 * each prompt-import entry inside it. Returns the part itself when it carries
 * neither.
 */
function stripRetainedMedia(part: unknown) {
  if (!isRecord(part)) {
    return part;
  }

  const data =
    part['type'] === DATA_CONTEXT_PART
      ? stripPromptImportData(part['data'])
      : undefined;
  if (data === undefined && !Object.hasOwn(part, RETAINED_MEDIA_KEY)) {
    return part;
  }

  const stripped = { ...part };
  delete stripped[RETAINED_MEDIA_KEY];
  if (data !== undefined) {
    stripped['data'] = data;
  }

  return stripped;
}

/**
 * The `data` of a `prompt-imports` `data-context` part without its entries'
 * retained bytes, or `undefined` when the part is not one or its entries carry
 * none.
 */
function stripPromptImportData(data: unknown): UnknownRecord | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  if (data['producer'] !== PROMPT_IMPORTS_PRODUCER) {
    return undefined;
  }

  const payload = data['payload'];
  if (!isRecord(payload)) {
    return undefined;
  }

  const storedImports: unknown = payload['imports'];
  if (!Array.isArray(storedImports)) {
    return undefined;
  }

  const imports: Array<unknown> = storedImports;
  const strippedImports: Array<unknown> = [];
  let strippedAny = false;
  for (const entry of imports) {
    if (isRecord(entry) && Object.hasOwn(entry, RETAINED_MEDIA_KEY)) {
      const entryWithoutBytes = { ...entry };
      delete entryWithoutBytes[RETAINED_MEDIA_KEY];
      strippedImports.push(entryWithoutBytes);
      strippedAny = true;
      continue;
    }
    strippedImports.push(entry);
  }

  if (!strippedAny) {
    return undefined;
  }

  return { ...data, payload: { ...payload, imports: strippedImports } };
}
