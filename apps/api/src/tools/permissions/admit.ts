import { type ToolContext } from '../types';
import { evaluatePermission } from './evaluator';
import {
  DEFAULT_PERMISSION_MODE,
  type PermissionMode,
} from './permission-mode';
import {
  type CompiledPolicy,
  type EvaluatePermissionOptions,
  type PermissionDecision,
} from './types';

/**
 * The mode an owner HTTP route decides under. It has no Run and no permission
 * mode, so it gets `default` semantics: the policy is always evaluated.
 */
export const OWNER_ROUTE = 'owner_route';

export type AdmissionMode = PermissionMode | typeof OWNER_ROUTE;

/** Evaluates one call against the policy the entry point was given. */
export type EvaluateCall = (
  options: EvaluatePermissionOptions,
) => PermissionDecision;

/**
 * The only permission entry point: every mode's semantics live here. `decide`
 * composes the call's evaluations and runs only when the mode consults the
 * policy; `bypass` answers a synthetic allow without it.
 */
export function decidePermission(
  policy: CompiledPolicy,
  mode: AdmissionMode,
  decide: (evaluate: EvaluateCall) => PermissionDecision,
): PermissionDecision {
  switch (mode) {
    case 'bypass': {
      return {
        policyId: policy.id,
        decision: 'allow',
        reason: 'permission_mode_bypass',
        reference: null,
      };
    }
    case 'default':
    case OWNER_ROUTE: {
      return decide((options) => evaluatePermission(policy, options));
    }
  }
}

/**
 * {@link decidePermission} for a tool call. `undefined` means the context
 * carries no compiled policy, a code error each caller fails closed on.
 */
export function admitPermission(
  context: ToolContext,
  decide: (evaluate: EvaluateCall) => PermissionDecision,
): PermissionDecision | undefined {
  const policy = context.permissionPolicy;
  if (policy === undefined) return undefined;
  return decidePermission(
    policy,
    context.permissionMode ?? DEFAULT_PERMISSION_MODE,
    decide,
  );
}

/**
 * Submitted-call precedence for a value judged as written and as projected: a
 * reject of the submitted text other than `no_allow` stands, so a spelling
 * cannot be arranged to miss a reject clause; otherwise the projected text
 * decides.
 */
export function evaluateSubmittedThenProjected(
  evaluate: EvaluateCall,
  submitted: EvaluatePermissionOptions,
  projected: EvaluatePermissionOptions,
): PermissionDecision {
  const decision = evaluate(submitted);
  if (decision.decision === 'reject' && decision.reason !== 'no_allow') {
    return decision;
  }
  return evaluate(projected);
}
