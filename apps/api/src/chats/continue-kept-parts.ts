/**
 * The Continue boundary of a failed turn's reply (turn-actions D4).
 *
 * A settled tool part is a tool part with a result. The kept parts are the
 * reply's parts through its LAST settled tool part, plus the `data-context`
 * parts directly after it — the in-Run items of the step that tool result
 * closed, which a live loop sends right after its results. Every part after
 * them belongs to the unfinished step: the Continue Run drops it from the
 * reply and adds new parts from there.
 *
 * A part without a result can only be the step that did not finish, because
 * every terminal writer settles open calls first. A reply with no settled tool
 * part keeps nothing: there is no completed step to continue from.
 */

import { isRecord, isString } from '@workspace/runtime-safety';

import { isContextItemPart } from './context-item';
import { TOOL_PART_PREFIX } from './tool-observation-part';

/** A stored tool part that holds its result, success or error. */
export type SettledToolPart = {
  readonly type: `tool-${string}`;
  readonly state: 'output-available' | 'output-error';
};

export function isSettledToolPart(part: unknown): part is SettledToolPart {
  return (
    isRecord(part) &&
    isString(part['type']) &&
    part['type'].startsWith(TOOL_PART_PREFIX) &&
    (part['state'] === 'output-available' || part['state'] === 'output-error')
  );
}

/**
 * The parts a Continue Run keeps from its source reply, in stored order. The
 * reply's own `unknown[]` JSONB parts are the input: nothing here narrows
 * them, because the worker projects them with the same stored shape.
 */
export function continueKeptParts(
  parts: ReadonlyArray<unknown>,
): Array<unknown> {
  const lastSettled = parts.findLastIndex(isSettledToolPart);
  if (lastSettled === -1) return [];

  let end = lastSettled + 1;
  while (end < parts.length && isContextItemPart(parts[end])) end += 1;

  return parts.slice(0, end);
}
