/**
 * The artifact read surface of a Run (tool-result-artifacts "An artifact needs
 * a way to read it" and design D10).
 *
 * A stored artifact is worth its bytes only when the Run reaches it. There are
 * two paths: `read` with an admitted `artifact://` locator, and the host files
 * a `bash` on the llame host opens with its own authority. The second path
 * needs the files (the process has a native executor and `bash` is
 * allowlisted), a Workspace bound to the llame host rather than a Machine, and
 * a `bash` group that does not reject the call.
 */

import { admitPermission } from '../permissions/admit';
import { type ToolContext } from '../types';
import { machineWorkspaceRoot } from '../workspace-path';
import { formatArtifactLocator } from './locator';

/**
 * Whether this Run can read back an artifact it made: either path. `seq`
 * defaults to the probe value; a writer judges the allocated locator with it.
 */
export function canReadArtifacts(
  context: ToolContext,
  toolName: string,
  seq = 1,
): boolean {
  return (
    readAdmitsArtifact(context, toolName, seq) ||
    hostFilesReachArtifact(context)
  );
}

/**
 * `read` is allowlisted and its group admits the artifact's locator. `seq`
 * defaults to 1, the probe value before a write allocates the real counter
 * value; a sequence-specific rule is judged again with the allocated one.
 */
export function readAdmitsArtifact(
  context: ToolContext,
  toolName: string,
  seq = 1,
): boolean {
  if (context.artifactReadable !== true) return false;

  // An `artifact://` path is already its own canonical projection, so the
  // `read` group matches the locator exactly as the reader submits it.
  const decision = admitPermission(context, (evaluate) =>
    evaluate({
      toolId: 'read',
      args: { path: formatArtifactLocator(toolName, seq) },
    }),
  );

  return decision?.decision === 'allow';
}

/**
 * `bash` reaches the host files: they exist, the Workspace is not bound to a
 * Machine, and the `bash` group admits a call. A Machine Workspace or an
 * `ssh://` `bash` reads no llame host path, so the files stay a cache there
 * and `read` is the only way to the artifact.
 */
function hostFilesReachArtifact(context: ToolContext): boolean {
  return (
    context.artifactHostFiles === true &&
    machineWorkspaceRoot(context.workspaceRoot?.current()) === undefined &&
    bashGroupAdmits(context)
  );
}

/**
 * Whether the Run's `bash` group admits a call at all. The probe carries an
 * empty command, so a field clause on `command` matches only a rule that
 * rejects every command; a group whose allow names concrete commands rejects
 * the probe, and the Run then cannot rely on `bash` to open the files.
 */
function bashGroupAdmits(context: ToolContext): boolean {
  const decision = admitPermission(context, (evaluate) =>
    evaluate({ toolId: 'bash', args: { command: '' } }),
  );

  return decision?.decision === 'allow';
}
