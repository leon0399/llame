import { type UnknownRecord } from '@workspace/runtime-safety';

import { type Tool, type ToolContext } from '../types';
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
 * The only permission entry point: every mode's policy semantics live here.
 * `decide` composes the call's evaluations and runs for `default` and
 * `read-only`; `bypass` answers a synthetic allow without it. The `read-only`
 * ceiling ({@link readOnlyCeiling}) runs before this function, in the runner.
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
    case 'read-only':
    case OWNER_ROUTE: {
      return decide((options) => evaluatePermission(policy, options));
    }
  }
}

/**
 * Whether this context's permission mode consults the policy at all. A
 * `bypass` attempt evaluates nothing, so a caller doing policy work of its own
 * — the artifact finding re-check — skips it without naming the mode.
 */
export function evaluatesPermission(context: ToolContext): boolean {
  return (context.permissionMode ?? DEFAULT_PERMISSION_MODE) !== 'bypass';
}

/**
 * The `read-only` ceiling (openspec/changes/read-only-permission-mode D3/D4):
 * the one place that decides which calls a `read-only` attempt may make. The
 * runner calls it after argument validation and before SSH host resolution,
 * the grep scope refusal, and every permission-group evaluation, so a rejected
 * call resolves nothing and evaluates nothing. A call passes when the tool is
 * classified `read_only`, when it is `exit_workspace`, or when it is
 * `enter_workspace` without a `worktree` argument. `undefined` means the
 * ceiling admits the call; in every other mode it admits everything and the
 * mode's own semantics apply unchanged.
 */
export function readOnlyCeiling(
  context: ToolContext,
  tool: Pick<Tool, 'id' | 'classification'>,
  submittedArgs: UnknownRecord,
): Extract<PermissionDecision, { readonly decision: 'reject' }> | undefined {
  if ((context.permissionMode ?? DEFAULT_PERMISSION_MODE) !== 'read-only') {
    return undefined;
  }
  if (
    tool.classification === 'read_only' ||
    tool.id === 'exit_workspace' ||
    (tool.id === 'enter_workspace' && submittedArgs['worktree'] === undefined)
  ) {
    return undefined;
  }
  // Without a compiled policy there is no policy-instance id to attribute the
  // decision to; the normal path then fails closed with `no_allow`.
  const policy = context.permissionPolicy;
  if (policy === undefined) return undefined;
  return {
    policyId: policy.id,
    decision: 'reject',
    reason: 'permission_mode_read_only',
    reference: null,
  };
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
