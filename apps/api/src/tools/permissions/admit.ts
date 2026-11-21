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
import { type NativePathProjection } from './locator-projection';

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

/** One call's evaluations: the canonical locator, and the texts a reject may
 *  also match (the submitted spelling and the projected Machine path). */
export type CanonicalEvaluation = {
  /** The one text an allow is decided on. */
  readonly canonical: EvaluatePermissionOptions;
  /** Texts whose matching reject also refuses, in evaluation order. */
  readonly rejectTexts: ReadonlyArray<EvaluatePermissionOptions>;
};

/**
 * Canonical-locator precedence (design D7): an allow is decided on the
 * canonical locator alone, while any reject that matches the submitted text,
 * the projected path, or the canonical locator refuses the call. A decision
 * reached on a non-canonical text can therefore never admit — only its reject
 * is kept — so a rule written for one Machine's path cannot widen, and a
 * bare-path reject in another spelling keeps its effect on every Machine. The
 * returned decision carries the evaluator's own provenance.
 */
export function evaluateCanonicalWithRejectTexts(
  evaluate: EvaluateCall,
  input: CanonicalEvaluation,
): PermissionDecision {
  const canonical = evaluate(input.canonical);

  if (canonical.decision === 'reject' && canonical.reason !== 'no_allow')
    return canonical;

  for (const options of input.rejectTexts) {
    const decision = evaluate(options);

    if (decision.decision === 'reject' && decision.reason !== 'no_allow')
      return decision;
  }

  return canonical;
}

/**
 * One `path`-arg call's evaluation: the projection's canonical locator allows,
 * and the submitted spelling plus the projected Machine path are the texts a
 * reject also matches. A duplicate text is evaluated once.
 */
export function canonicalPathEvaluation(
  toolId: string,
  submitted: string,
  projection: NativePathProjection,
): CanonicalEvaluation {
  const call = (value: string): EvaluatePermissionOptions => ({
    toolId,
    args: { path: value },
  });

  const texts = new Set(
    [submitted, projection.projectedPath].filter(
      (value): value is string =>
        value !== undefined && value !== projection.canonical,
    ),
  );

  return {
    canonical: call(projection.canonical),
    rejectTexts: [...texts].map(call),
  };
}
