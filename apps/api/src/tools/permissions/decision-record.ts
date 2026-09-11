import {
  type PermissionClauseReference,
  type PermissionDecision,
  type PermissionDecisionReason,
} from './types';

/**
 * Safe, owner-scoped decision provenance (openspec/changes/tool-call-permissions
 * D5). It records the opaque policy-instance id, the allow/reject decision, a
 * static reason, and a bounded deterministic clause reference. It never
 * contains policy bodies, matched fragments, resolved config secrets, or host
 * paths, and it is excluded from model replay, public shares, exports, and
 * search.
 */
export interface PermissionDecisionMetadata {
  readonly policyId: string;
  readonly decision: 'allow' | 'reject';
  readonly reason: PermissionDecisionReason;
  readonly clause: PermissionClauseReference | null;
}

export function toDecisionMetadata(
  decision: PermissionDecision,
): PermissionDecisionMetadata {
  return {
    policyId: decision.policyId,
    decision: decision.decision,
    reason: decision.reason,
    clause: decision.reference,
  };
}
