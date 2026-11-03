/**
 * Stored `run_events` payloads re-read into domain values: a call's safe
 * permission decision, its derived-locator decisions, its `ToolResult`, and
 * the SDK's own form of a call the repair hook refused. The log is untrusted
 * on the way back in, so every reader validates and drops what it cannot
 * trust, and nothing here touches the collector or a database.
 */
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';

import { isHopRejection } from '../chats/tool-observation-part';
import { type SdkRefusal } from '../models/model-client';
import { isRejectedHopUrl } from '../tools/permissions/messages';
import {
  type PermissionClauseReference,
  type PermissionDecision,
} from '../tools/permissions/types';
import { type ToolResult } from '../tools/types';
import {
  isDerivedLocatorKind,
  type DerivedDecisionRecord,
} from '../tools/web-read/admission';
import {
  eventPayloadField,
  isPermissionRejectionReason,
} from './run-event-payload';

/**
 * The per-call request budget can produce 20 redirect-hop decisions and six
 * probe-candidate decisions (one alternate, one suffix, and four `llms.txt`
 * candidates). The submitted locator is decided at the execution gate, and
 * refused addresses have a separate bound.
 */
export const MAX_DERIVED_DECISIONS = 26;

/**
 * Address refusals are bounded independently so DNS answers cannot crowd out
 * the hop and probe decisions that explain a call's outcome.
 */
export const MAX_ADDRESS_DECISIONS = 16;

function permissionClauseFromPayload(
  value: unknown,
): PermissionClauseReference | null {
  if (!isRecord(value)) return null;
  const groupId = value['groupId'];
  const list = value['list'];
  const clauseIndex = value['clauseIndex'];
  if (!isString(groupId)) return null;
  if (list !== 'allow' && list !== 'reject') return null;
  if (clauseIndex !== null && !isNumber(clauseIndex)) return null;
  return { groupId, list, clauseIndex };
}

/** Re-read one stored decision record's safe metadata: an opaque policy id, a
 *  decision, a static reason, and a bounded clause reference. */
function permissionDecisionFrom(
  value: unknown,
): PermissionDecision | undefined {
  if (!isRecord(value)) return undefined;
  const policyId = value['policyId'];
  const decision = value['decision'];
  const reason = value['reason'];
  if (!isString(policyId)) return undefined;
  const reference = permissionClauseFromPayload(value['reference']);
  if (decision === 'allow') {
    return reason === 'matched_allow' || reason === 'permission_mode_bypass'
      ? { policyId, decision: 'allow', reason, reference }
      : undefined;
  }
  if (decision !== 'reject' || !isPermissionRejectionReason(reason)) {
    return undefined;
  }

  return { policyId, decision: 'reject', reason, reference };
}

/** Re-read the safe decision metadata from a `tool.requested` payload. */
export function permissionFromPayload(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- the raw `run_events.payload` JSONB value; the field read and the guard above parse it before anything is trusted.
  payload: unknown,
): PermissionDecision | undefined {
  return permissionDecisionFrom(eventPayloadField(payload, 'permission'));
}

/** Re-read one stored derived-locator record: the kind of locator judged,
 *  beside the same safe decision metadata a call decision carries. */
function derivedDecisionRecordFrom(
  value: unknown,
): DerivedDecisionRecord | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value['kind'];
  if (!isDerivedLocatorKind(kind)) return undefined;
  const decision = permissionDecisionFrom(value);
  if (decision === undefined) return undefined;
  const count = value['count'];
  return isNumber(count) && Number.isInteger(count) && count >= 0
    ? { ...decision, kind, count }
    : { ...decision, kind };
}

/**
 * Re-read the derived-locator decisions a `tool.completed` payload recorded
 * when the call settled. Stored jsonb is untrusted on the way back in, so
 * malformed entries are dropped and each kind group keeps its own bound in
 * stored order; an empty list is absent, like the metadata every other part
 * omits.
 */
export function derivedDecisionsFromPayload(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- the raw `run_events.payload` JSONB value; `eventPayloadField` and the `Array.isArray` test below parse it before any entry is trusted.
  payload: unknown,
): ReadonlyArray<DerivedDecisionRecord> | undefined {
  const value = eventPayloadField(payload, 'derivedDecisions');
  if (!Array.isArray(value)) return undefined;

  const decisions: Array<DerivedDecisionRecord> = [];
  let addressCount = 0;
  let derivedCount = 0;
  for (const entry of value) {
    const decision = derivedDecisionRecordFrom(entry);
    if (decision === undefined) continue;

    if (decision.kind === 'address') {
      if (addressCount >= MAX_ADDRESS_DECISIONS) continue;
      addressCount += 1;
    } else {
      if (derivedCount >= MAX_DERIVED_DECISIONS) continue;
      derivedCount += 1;
    }
    decisions.push(decision);
  }

  return decisions.length === 0 ? undefined : decisions;
}

/**
 * Re-read one `tool.completed` payload's result: the success record as stored,
 * or the error the completion described. Stored jsonb is untrusted on the way
 * back in, so an unreadable record is dropped and only the exact locator a
 * hop rejection writes is carried into the rebuilt error — and only when the
 * call that completed was the native `read` tool's refused hop.
 */
export function toolResultFromPayload(
  output: unknown,
  toolName: string,
): ToolResult | undefined {
  if (!isRecord(output)) return undefined;
  const status = output['status'];
  if (status === 'success') return { ...output, status };
  const type = output['type'];
  const message = output['message'];
  if (status !== 'error' || !isString(type) || !isString(message)) {
    return undefined;
  }
  const rejectedUrl = output['rejectedUrl'];
  const artifact = output['artifact'];

  return {
    status,
    type,
    message,
    ...(isHopRejection(toolName, type) &&
      isRejectedHopUrl(rejectedUrl) && { rejectedUrl }),
    ...(isString(artifact) && { artifact }),
  };
}

/**
 * Re-read the SDK's own form of a refused call (design D3, proposal A8) from a
 * `tool.completed` payload. Stored jsonb is untrusted on the way back in, so a
 * record without a string error text, or without an input member at all,
 * yields none and the part keeps llame's own error text alone.
 */
export function sdkRefusalFromPayload(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- the raw `run_events.payload` JSONB value; the guards below are its validation.
  payload: unknown,
): SdkRefusal | undefined {
  const value = eventPayloadField(payload, 'sdkRefusal');
  if (!isRecord(value)) return undefined;
  const errorText = value['errorText'];
  if (!isString(errorText) || !Object.hasOwn(value, 'input')) return undefined;
  return { errorText, input: value['input'] };
}
