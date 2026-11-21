/**
 * The artifact read surface of a Run (tool-result-artifacts "An artifact needs
 * a way to read it" and design D10).
 *
 * A stored artifact is worth its bytes only when the Run reaches it. There are
 * two paths: `read` with an admitted `artifact://` locator, and the host files
 * a `bash` on this process's Machine opens with its own authority. The second
 * path needs the files (`bash` is allowlisted and the process hosts a
 * Machine), a current Machine that is that Machine, and a `bash` group that
 * does not reject the call.
 */

import { locatorContextOf } from '../bash-target';
import { admitPermission } from '../permissions/admit';
import { type ToolContext } from '../types';
import { currentMachine } from '../workspace-path';
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
 * `bash` reaches the host files: they exist, the current Machine is the one
 * this process hosts, and the `bash` group admits a call. A Workspace on
 * another Machine or an `ssh://` `bash` reads no path of that Machine, so the
 * files stay a cache there and `read` is the only way to the artifact.
 */
function hostFilesReachArtifact(context: ToolContext): boolean {
  const local = context.localMachine;

  return (
    context.artifactHostFiles === true &&
    local !== undefined &&
    currentMachine(locatorContextOf(context))?.toLowerCase() ===
      local.toLowerCase() &&
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
