import { evaluatePermission } from '../permissions/evaluator';
import { nativeFileProjection } from '../permissions/locator-projection';
import { type PermissionDecision } from '../permissions/types';
import { type ToolContext } from '../types';

/**
 * The locator kinds a web read evaluates beyond the submitted locator:
 * redirect hops, announced alternates, `.md` suffixes, `llms.txt` candidates,
 * and resolved addresses. Server-chosen locators are admitted independently
 * before their request (design D3).
 */
export type DerivedLocatorKind =
  | 'hop'
  | 'alternate'
  | 'suffix'
  | 'llms-txt'
  | 'address';

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
 * provenance tells a refused hop from a refused `llms.txt` candidate. The
 * locator itself is never recorded — a hop or address locator is
 * server-chosen text.
 */
export type DerivedDecisionRecord = PermissionDecision & {
  readonly kind: DerivedLocatorKind;
};

/** Every kind, exhaustive by construction so the guard below and the type
 *  above cannot drift apart. */
const KIND_NAMES: Readonly<Record<DerivedLocatorKind, true>> = {
  hop: true,
  alternate: true,
  suffix: true,
  'llms-txt': true,
  address: true,
};

/** Whether a stored provenance record names a kind this build knows: stored
 *  jsonb is untrusted on the way back in. */
export function isDerivedLocatorKind(
  value: unknown,
): value is DerivedLocatorKind {
  return typeof value === 'string' && Object.hasOwn(KIND_NAMES, value);
}

/** Evaluates the `read` group against a derived locator exactly as a submitted one. */
export type AdmitDerivedLocator = (
  kind: DerivedLocatorKind,
  url: string,
) => PermissionDecision;

/** Judges a canonical address against the full address locator for its request. */
export type AdmitAddress = (address: string, locator: string) => boolean;

/**
 * Builds one call's reject-only address admission check. Allows are not
 * evaluated as address permissions: a domain allowlist names the requested
 * host, not the public addresses it resolves to (design D3). A missing
 * compiled policy cannot attribute an address decision and therefore fails
 * closed without reporting one.
 */
export function createAddressAdmission(context: ToolContext): AdmitAddress {
  const policy = context.permissionPolicy;
  const projectFieldValue = nativeFileProjection('read');
  const report = context.onDerivedDecision;
  const reportedRefusals = new Set<string>();

  return (address, locator) => {
    if (policy === undefined) return false;

    const decision = evaluatePermission(policy, {
      toolId: 'read',
      args: { path: locator },
      projectFieldValue,
    });
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
 * Builds one call's admission check for its derived locators. Each locator is
 * evaluated through the same evaluator and the same `read` projection the
 * submitted call used, as if the model had submitted it, so an operator's
 * `path` clauses govern a server-chosen hop exactly as they govern the text
 * the model wrote. Nothing is cached and no decision carries to the next
 * locator: a page that is admitted at one URL cannot launder another through
 * it.
 */
export function createDerivedAdmission(
  context: ToolContext,
): AdmitDerivedLocator {
  const policy = context.permissionPolicy;
  const projectFieldValue = nativeFileProjection('read');
  const report = context.onDerivedDecision;
  return (kind, url) => {
    const decision =
      policy === undefined
        ? NO_POLICY
        : evaluatePermission(policy, {
            toolId: 'read',
            args: { path: url },
            projectFieldValue,
          });
    report?.({ kind, url, decision });
    return decision;
  };
}
