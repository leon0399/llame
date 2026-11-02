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
import { nativeFileProjection } from '../permissions/locator-projection';
import { type ToolContext } from '../types';
import { machineWorkspaceRoot } from '../workspace-path';
import { formatArtifactLocator } from './locator';

/**
 * Whether this Run's artifacts are also files on the llame host (D10). The
 * write layer owns the files; this is only the Run's capability bit.
 */
export function hasHostFiles(context: ToolContext): boolean {
  return context.artifactHostFiles === true;
}

/**
 * Whether this Run can read back an artifact it made. The probe locator stands
 * in for the artifact's own number, which the write allocates: a rule that
 * names one sequence is not predicted here.
 */
export function canReadArtifacts(
  context: ToolContext,
  toolName: string,
): boolean {
  return (
    readAdmitsArtifact(context, toolName) || hostFilesReachArtifact(context)
  );
}

/** `read` is allowlisted and its group admits the artifact's locator. */
function readAdmitsArtifact(context: ToolContext, toolName: string): boolean {
  if (context.artifactReadable !== true) return false;
  const decision = admitPermission(context, (evaluate) =>
    evaluate({
      toolId: 'read',
      args: { path: formatArtifactLocator(toolName, 1) },
      projectFieldValue: nativeFileProjection(
        'read',
        context.workspaceRoot?.current(),
      ),
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
    hasHostFiles(context) &&
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
