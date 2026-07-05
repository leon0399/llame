import {
  type ApprovalLevel,
  type Policy,
  type PolicyEffect,
} from '../db/schema';

/**
 * Pure policy evaluation (#45, SPEC §7.4).
 *
 * Semantics, in order of authority:
 *  1. DEFAULT DENY — no matching allow means denied ("policy before
 *     capability", roadmap principle 3). An empty policy set denies all.
 *  2. DENY OVERRIDES ALLOW — any matching deny wins, regardless of how
 *     specific a matching allow is.
 *  3. Approval is the STRICTEST level demanded by ANY matching allow. A
 *     deeper-scope allow deliberately cannot SOFTEN an ancestor's approval
 *     requirement — letting a user's own auto_allow rule downgrade an org's
 *     always_ask would be a governance leak (the approval analogue of
 *     deny-overrides-allow; reference: Claude Code's strict deny > ask >
 *     allow type precedence). Relaxation is expressed by narrowing or
 *     removing the stricter rule at its own scope, never by shadowing it.
 */

export type PolicyCheckRequest = {
  action: string;
  resourceType?: string;
  resourceId?: string;
  /** Flat context the jsonb conditions equality-match against. */
  context?: Record<string, unknown>;
};

export type MatchedPolicyRef = {
  policyId: string;
  version: number;
  scopeType: Policy['scopeType'];
  scopeId: string;
  effect: PolicyEffect;
};

export type PolicyDecision = {
  effect: PolicyEffect;
  /** Present when effect is 'allow' and the deciding policy demands approval. */
  approval: ApprovalLevel | null;
  /** Human-readable why — matched deny / matched allow / default deny. */
  reason: string;
  /** Every policy that matched the request, allow and deny alike. */
  matched: MatchedPolicyRef[];
};

/** Action matcher: exact, or a `prefix.*` / `*` wildcard on the policy side. */
export function actionMatches(policyAction: string, action: string): boolean {
  if (policyAction === '*' || policyAction === action) {
    return true;
  }
  return (
    policyAction.endsWith('.*') && action.startsWith(policyAction.slice(0, -1))
  );
}

function resourceMatches(policy: Policy, req: PolicyCheckRequest): boolean {
  if (policy.resourceType != null && policy.resourceType !== req.resourceType) {
    return false;
  }
  if (policy.resourceId != null && policy.resourceId !== req.resourceId) {
    return false;
  }
  return true;
}

/**
 * Conditions: every key in the policy's jsonb must strictly equal the
 * request context's value. A condition on an ABSENT context key does not
 * match — for allows that is fail-closed (no accidental grant); for denies
 * the caller must supply honest context, which is the tool gate's job.
 */
function conditionsMatch(policy: Policy, req: PolicyCheckRequest): boolean {
  const conditions = policy.conditions;
  if (conditions == null) {
    return true;
  }
  if (typeof conditions !== 'object' || Array.isArray(conditions)) {
    return false;
  }
  const context = req.context ?? {};
  return Object.entries(conditions as Record<string, unknown>).every(
    ([key, expected]) => key in context && context[key] === expected,
  );
}

/** Strictness rank for approval levels — higher = stricter (asks harder). */
const APPROVAL_RANK: Record<ApprovalLevel, number> = {
  admin_only: 7,
  always_ask: 6,
  ask_once_per_run: 5,
  ask_once_per_chat: 4,
  ask_once_per_project: 3,
  auto_allow_low_risk: 2,
  auto_allow_readonly: 1,
};

function stricter(
  a: ApprovalLevel | null,
  b: ApprovalLevel | null,
): ApprovalLevel | null {
  if (a === null) return b;
  if (b === null) return a;
  return APPROVAL_RANK[a] >= APPROVAL_RANK[b] ? a : b;
}

/**
 * Does an allow's approval level demand HUMAN approval before use? The
 * `auto_allow_*` levels (ranks 1–2) are allows that never ask; `ask_*` /
 * `always_ask` / `admin_only` (rank ≥ ask_once_per_project) pause for a human.
 * Single source of truth for the threshold — consumers without an approval
 * flow (e.g. the tool pre-filter) treat "requires approval" as not-yet-usable.
 */
export function requiresHumanApproval(approval: ApprovalLevel | null): boolean {
  return (
    approval !== null &&
    APPROVAL_RANK[approval] >= APPROVAL_RANK.ask_once_per_project
  );
}

export function evaluatePolicies(
  applicable: Policy[],
  req: PolicyCheckRequest,
): PolicyDecision {
  const matching = applicable.filter(
    (policy) =>
      actionMatches(policy.action, req.action) &&
      resourceMatches(policy, req) &&
      conditionsMatch(policy, req),
  );
  const matched: MatchedPolicyRef[] = matching.map((policy) => ({
    policyId: policy.id,
    version: policy.version,
    scopeType: policy.scopeType,
    scopeId: policy.scopeId,
    effect: policy.effect,
  }));

  const denies = matching.filter((policy) => policy.effect === 'deny');
  if (denies.length > 0) {
    return {
      effect: 'deny',
      approval: null,
      reason: `denied by policy ${denies[0].id} (deny overrides allow)`,
      matched,
    };
  }

  const allows = matching.filter((policy) => policy.effect === 'allow');
  if (allows.length === 0) {
    return {
      effect: 'deny',
      approval: null,
      reason: 'default deny: no policy allows this action',
      matched,
    };
  }

  // Strictest approval across ALL matching allows — a deeper allow cannot
  // soften an ancestor's approval requirement (see module doc).
  const approval = allows.reduce<ApprovalLevel | null>(
    (acc, entry) => stricter(acc, entry.approval),
    null,
  );

  return {
    effect: 'allow',
    approval,
    reason: `allowed by policy ${allows[0].id}`,
    matched,
  };
}
