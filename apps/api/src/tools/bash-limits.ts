/**
 * The local managed `bash` bounds (design D6 of the bash-execution capability).
 * Local execution and an `ssh://` command share them, so a remote call is held
 * to the same output, input, time, and process limits as a local one.
 *
 * The output bound is `tools.artifacts.maxBytes` counted in UTF-8 bytes, so a
 * stream never exceeds the one byte bound on a stored artifact part
 * (tool-result-artifacts D4). A Machine keeps the protocol constant instead.
 */

import {
  type BashExecutorContext,
  type ManagedProcessSlot,
} from '@workspace/bash-executor';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';

import { artifactMaxBytes } from './artifacts/spill';
import { bashWorkingDirectory } from './env';
import { type ToolContext, type ToolResult } from './types';

export function managedBashContext(context: ToolContext): BashExecutorContext {
  const workingDirectory =
    context.workspaceRoot?.current() ?? bashWorkingDirectory();

  return {
    workingDirectory,
    // ponytail: alpha host claims; managed Sandbox must prove these for stronger isolation.
    secretBoundary: true,
    processIsolation: true,
    outputBoundBytes: artifactMaxBytes(context),
    inputBound: Number('8000'),
    durationMs: Number('300000'),
    maxProcesses:
      context.bashProcessLimiter?.maxProcesses ??
      BUILT_IN_DEFAULTS.tools.bash.maxProcesses,
  };
}

/**
 * Take a process slot before the executor runs (background-jobs D7). A call
 * past `tools.bash.maxProcesses` gets `limit_reached`, which names the bound
 * and says a later call can succeed; no attempt is recorded and no process
 * starts. A context with no limiter cannot run `bash`.
 */
export function acquireBashSlot(
  context: ToolContext,
): ManagedProcessSlot | ToolResult {
  const limiter = context.bashProcessLimiter;

  if (limiter === undefined)
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    };

  const slot = limiter.tryAcquire();

  if (slot === null)
    return {
      status: 'error',
      type: 'limit_reached',
      message: `This worker already runs ${limiter.maxProcesses} managed commands, the most that tools.bash.maxProcesses allows. The command did not run. A later call can succeed when a running command ends.`,
    };

  return slot;
}
