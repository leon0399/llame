import { evaluatePermission } from '../permissions/evaluator';
import { nativeFileProjection } from '../permissions/locator-projection';
import { type PermissionDecision } from '../permissions/types';
import { type ToolContext } from '../types';

/**
 * The four locators a web read derives rather than receives: a redirect hop,
 * an announced Markdown alternate, a `.md` suffix candidate, and an `llms.txt`
 * candidate. Each is chosen by a server, never by the model, so each is
 * admitted on its own before its request (design D3).
 */
export type DerivedLocatorKind = 'hop' | 'alternate' | 'suffix' | 'llms-txt';

/** One derived locator's admission, handed to the trusted run loop beside the
 *  call decision; never model-visible. */
export type DerivedDecision = {
  readonly kind: DerivedLocatorKind;
  readonly url: string;
  readonly decision: PermissionDecision;
};

/** Evaluates the `read` group against a derived locator exactly as a submitted one. */
export type AdmitDerivedLocator = (
  kind: DerivedLocatorKind,
  url: string,
) => PermissionDecision;

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
