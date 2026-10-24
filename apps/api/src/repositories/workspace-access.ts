import { type CompiledPolicy } from '../tools/permissions/types';
import { evaluatePermission } from '../tools/permissions/evaluator';
import { projectNativeFilePath } from '../tools/permissions/locator-projection';
import { repositoryFailure } from './failure';

/**
 * The host access policy a route that runs git obeys, before it runs git
 * (openspec `repositories` "Registration and removal obey the host access
 * policy").
 *
 * An owner HTTP route has no Run and no permission mode, so it evaluates the
 * `enter_workspace` group exactly as a `default`-mode call would: no bypass,
 * the same projection, and a refusal whenever nothing allows the path. That
 * keeps one policy surface for "may this owner enter this host directory",
 * whether the model or the owner asks.
 */

// The one tool group these routes are gated by.
export const WORKSPACE_TOOL_ID = 'enter_workspace';

/** `enter_workspace` must be advertised, or no git runs at all. */
export function requireWorkspaceToolAllowed(
  allowed: ReadonlyArray<string>,
): void {
  if (!allowed.includes(WORKSPACE_TOOL_ID)) {
    throw repositoryFailure(
      'forbidden',
      'tool_not_allowed',
      `${WORKSPACE_TOOL_ID} is not in tools.allowed, so this path may not be inspected.`,
    );
  }
}

/**
 * Evaluate one path under the `enter_workspace` group. `path` is the value the
 * policy matches — the canonical path, the inspected main clone, or a Machine
 * locator — never an unprojected form.
 */
export function requireWorkspacePathAllowed(
  policy: CompiledPolicy,
  path: string,
): void {
  const decision = evaluatePermission(policy, {
    toolId: WORKSPACE_TOOL_ID,
    args: { path: projectNativeFilePath(path) },
  });
  if (decision.decision === 'reject') {
    throw repositoryFailure(
      'forbidden',
      'permission_denied',
      'The host access policy does not allow this path.',
    );
  }
}
