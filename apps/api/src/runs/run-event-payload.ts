/**
 * Field readers for a stored `run_events.payload` (jsonb, untrusted on the way
 * back in). Every rebuild path reads through these, so a malformed or legacy
 * payload contributes nothing instead of breaking the transcript. Each reader
 * validates its own input; the rule cannot see through the ternary shape the
 * guard call needs, hence the per-declaration exemption.
 */
import { isRecord, isString } from '@workspace/runtime-safety';
import type { ProviderMetadata } from 'ai';

import type { PermissionDecisionReason } from '../tools/permissions/types';

// eslint-disable-next-line anti-slop/no-unknown-parameters -- the whole point of this reader is to decode an unparsed `run_events.payload`, and the `isRecord` ternary below is its validation.
function eventPayloadField(payload: unknown, key: string) {
  return isRecord(payload) ? payload[key] : undefined;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- delegates directly to `eventPayloadField`, whose `isRecord` guard is the validation point.
function eventPayloadString(payload: unknown, key: string): string | undefined {
  const value = eventPayloadField(payload, key);
  return isString(value) ? value : undefined;
}

/**
 * The opaque provider metadata a `model.delta`, `reasoning.delta`, or
 * `tool.requested` event carries (design A7/D15). Only a record is accepted;
 * llame never reads inside it.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- decodes the same unparsed `run_events.payload`; the `isRecord` guard below is its validation.
function eventProviderMetadata(payload: unknown): ProviderMetadata | undefined {
  const value = eventPayloadField(payload, 'providerMetadata');
  if (!isRecord(value)) return undefined;
  // SAFETY: the value is the adapter's own provider-metadata object as
  // Postgres jsonb stored and returned it; the check above only rules out a
  // malformed or legacy payload shape, and nothing reads inside it.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const metadata = value as ProviderMetadata;
  return metadata;
}

/**
 * The permission reasons a stored decision may record. Only the rejection ones
 * extend the part's owner-visible error text, so the two sets are named apart.
 */
const PERMISSION_REASONS: ReadonlySet<string> = new Set([
  'explicit_reject',
  'no_allow',
  'invalid_field',
  'input_limit',
  'matched_allow',
  'permission_mode_bypass',
  'permission_mode_read_only',
]);

function isPermissionReason(value: unknown): value is PermissionDecisionReason {
  return isString(value) && PERMISSION_REASONS.has(value);
}

/** Whether a stored decision's reason is a rejection (not a matching mode). */
export function isPermissionRejectionReason(
  value: unknown,
): value is Exclude<
  PermissionDecisionReason,
  'matched_allow' | 'permission_mode_bypass'
> {
  return (
    isPermissionReason(value) &&
    value !== 'matched_allow' &&
    value !== 'permission_mode_bypass'
  );
}

export { eventPayloadField, eventPayloadString, eventProviderMetadata };
