import { admitPermission } from '../permissions/admit';
import { evaluatePermission } from '../permissions/evaluator';
import { projectNativeFilePath } from '../permissions/locator-projection';
import { type PermissionDecision } from '../permissions/types';
import { type ToolContext } from '../types';

/**
 * redirect hops, announced alternates, `.md` suffixes, `llms.txt` candidates,
 * adapter targets, resolved addresses, and canonical Workspace entry paths.
 * Server-chosen locators are admitted independently before their request
 * (design D3).
 */
export type DerivedLocatorKind =
  | 'hop'
  | 'alternate'
  | 'suffix'
  | 'llms-txt'
  | 'adapter'
  | 'address'
  | 'canonical';

/** One derived locator's admission, handed to the trusted run loop beside the
 *  call decision; never model-visible. */
export type DerivedDecision = {
  readonly kind: DerivedLocatorKind;
  readonly url: string;
  readonly decision: PermissionDecision;
};

/**
 * A {@link DerivedDecision} as run execution records it beside the call
 * decision: the decision plus the kind of locator it judged, so stored
 * provenance tells a refused hop from a refused `llms.txt` candidate or
 * canonical Workspace path. The locator itself is never recorded — a hop,
 * address, or canonical path is server- or host-derived text.
 */
export type DerivedDecisionRecord = PermissionDecision & {
  readonly kind: DerivedLocatorKind;
};

/** Every kind, exhaustive by construction so the guard below and the type
 * above cannot drift apart. */
const KIND_NAMES: Readonly<Record<DerivedLocatorKind, true>> = {
  hop: true,
  alternate: true,
  suffix: true,
  'llms-txt': true,
  adapter: true,
  address: true,
  canonical: true,
};

/** Whether a stored provenance record names a kind this build knows: stored
 *  jsonb is untrusted on the way back in. */
export function isDerivedLocatorKind(
  value: unknown,
): value is DerivedLocatorKind {
  return typeof value === 'string' && Object.hasOwn(KIND_NAMES, value);
}

/**
 * Evaluates the read policy against a raw locator before applying its
 * `read` projection.
 */
export type AdmitDerivedLocator = (
  kind: DerivedLocatorKind,
  url: string,
) => PermissionDecision;

/** Judges a canonical address against the full address locator for its request. */
export type AdmitAddress = (address: string, locator: string) => boolean;

/** Projects a derived locator exactly as the request will use it. */
const PROJECT_DERIVED_LOCATOR = (_field: string, value: string): string =>
  projectNativeFilePath(value);

/**
 * Builds one call's reject-only address admission check. A raw-text rejection
 * gets the same precedence as for a submitted call, then the read projection
 * is evaluated. Allows are not evaluated as address permissions: a domain
 * allowlist names the requested host, not the public addresses it resolves to
 * (design D3). A missing compiled policy cannot attribute an address decision
 * and therefore fails closed without reporting one.
 */
export function createAddressAdmission(context: ToolContext): AdmitAddress {
  const report = context.onDerivedDecision;
  const reportedRefusals = new Set<string>();

  return (address, locator) => {
    const decision = admitPermission(context, (policy) =>
      evaluateLocatorPermission(policy, locator, PROJECT_DERIVED_LOCATOR),
    );
    if (decision === undefined) return false;

    const refused =
      decision.decision === 'reject' &&
      (decision.reason === 'explicit_reject' ||
        decision.reason === 'input_limit');
    if (!refused) return true;

    const key = JSON.stringify([address, decision.reason, decision.reference]);
    if (!reportedRefusals.has(key)) {
      reportedRefusals.add(key);
      report?.({ kind: 'address', url: locator, decision });
    }

    return false;
  };
}

/**
 * Mirrors submitted-call precedence: a raw reject other than `no_allow`
 * stands; otherwise the projected locator determines the result.
 */
function evaluateLocatorPermission(
  policy: NonNullable<ToolContext['permissionPolicy']>,
  locator: string,
  projectFieldValue: (field: string, value: string) => string,
): PermissionDecision {
  const options = { toolId: 'read', args: { path: locator } };
  const submitted = evaluatePermission(policy, options);
  if (submitted.decision === 'reject' && submitted.reason !== 'no_allow') {
    return submitted;
  }
  return evaluatePermission(policy, { ...options, projectFieldValue });
}

/**
 * The fail-closed decision for a context with no compiled policy — a code
 * error, not a caller choice. No derived locator is admitted, and there is no
 * policy instance to attribute the refusal to, so the id is empty rather than
 * invented.
 */
const NO_POLICY: PermissionDecision = {
  policyId: '',
  decision: 'reject',
  reason: 'no_allow',
  reference: null,
};

/**
 * Builds one call's admission check for its derived locators. Each locator
 * first gets the same as-written rejection check as a submitted call, then the
 * derived-locator projection decides whenever that check is allow or
 * `no_allow`. Nothing is cached and no decision carries to the next locator: a
 * page that is admitted at one URL cannot launder another through it.
 */
export function createDerivedAdmission(
  context: ToolContext,
): AdmitDerivedLocator {
  const report = context.onDerivedDecision;
  return (kind, url) => {
    const decision =
      admitPermission(context, (policy) =>
        evaluateLocatorPermission(policy, url, PROJECT_DERIVED_LOCATOR),
      ) ?? NO_POLICY;
    report?.({ kind, url, decision });
    return decision;
  };
}
