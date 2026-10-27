/**
 * The `regenerate` context-item producer (turn-actions D9): the notice that
 * tells the model an earlier attempt at this turn was discarded after it ran
 * tools whose effects stay, and the decision that decides whether a Regenerate
 * owes the notice at all.
 *
 * The notice is an accepted-turn item: it lives on the triggering user message,
 * so every later Run of the turn and every later turn carries it, and a
 * tool-less Regenerate receives it in its initial request.
 */

import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { TOOL_REGISTRY } from '../tools/registry';
import { loadPackagedTemplate } from '../prompts/template-engine';
import { isSettledToolPart } from './continue-kept-parts';
import { TOOL_PART_PREFIX } from './tool-observation-part';
import { type AuthoredContextItemPart } from './context-item';
import {
  createRenderedContextItem,
  isExactRecord,
} from './context-item-shared';

/** The closed reasons a `regenerate` notice can state. */
export const REGENERATE_NOTICE_REASONS = ['non_read_only_calls'] as const;

export type RegenerateNoticeReason = (typeof REGENERATE_NOTICE_REASONS)[number];

export interface RegenerateNoticePayload extends Record<string, unknown> {
  readonly reason: RegenerateNoticeReason;
}

export function isRegenerateNoticePayload(
  value: unknown,
): value is RegenerateNoticePayload {
  return (
    isExactRecord(value, ['reason']) &&
    REGENERATE_NOTICE_REASONS.some((reason) => reason === value['reason'])
  );
}

const renderRegenerateNotice = loadPackagedTemplate<Record<string, never>>(
  __dirname,
  'regenerate-notice',
);

export function createRegenerateNoticeItem(input: {
  readonly runId: string;
}): AuthoredContextItemPart {
  const payload: RegenerateNoticePayload = { reason: 'non_read_only_calls' };
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the declared type cannot express the closed-reason invariant this guard enforces, so it is an assertion about the value, not a redundant re-parse of a type we already trust.
  if (!isRegenerateNoticePayload(payload)) {
    throw new TypeError('Invalid server-authored regenerate notice metadata');
  }
  return createRenderedContextItem({
    producer: 'regenerate',
    form: 'notice',
    runId: input.runId,
    payload,
    body: renderRegenerateNotice({}),
  });
}

/** The tool name a stored tool part names, or undefined for any other part. */
function storedToolName(part: UnknownRecord): string | undefined {
  const type = part['type'];
  if (!isString(type) || !type.startsWith(TOOL_PART_PREFIX)) return undefined;
  return type.slice(TOOL_PART_PREFIX.length);
}

/**
 * Whether a stored tool part is a call whose effects outlive the reply.
 *
 * A recorded classification decides it, and `null` — a call the availability
 * gate or the permission policy rejected — never counts, because nothing ran. A
 * legacy part written before the field existed falls back to the tool catalog:
 * an `mcp__` id is `unverified`, a name the catalog does not know counts, and
 * only a `read_only` tool is trusted without evidence.
 */
export function discardsNonReadOnlyCall(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- one stored jsonb part; `isSettledToolPart` and `isRecord` parse it before any field is read.
  part: unknown,
): boolean {
  const record = isRecord(part) ? part : undefined;
  if (!isSettledToolPart(part) || record === undefined) return false;
  const classification = record['classification'];
  // A rejected call never ran, so it discarded nothing.
  if (classification === null) return false;
  if (classification !== undefined) return classification !== 'read_only';
  const toolName = storedToolName(record);
  if (toolName === undefined) return false;
  if (toolName.startsWith('mcp__')) return true;
  return TOOL_REGISTRY.get(toolName)?.classification !== 'read_only';
}

/**
 * Whether a replaced reply holds a call the new attempt cannot see the effects
 * of.
 */
export function replyDiscardsNonReadOnlyCalls(
  parts: ReadonlyArray<unknown>,
): boolean {
  return parts.some((part) => discardsNonReadOnlyCall(part));
}
