/**
 * The local managed `bash` bounds (design D6 of the bash-execution capability).
 * Local execution and an `ssh://` command share them, so a remote call is held
 * to the same output, input, time, and process limits as a local one.
 *
 * The output bound is `tools.artifacts.maxBytes` counted in UTF-8 bytes, so a
 * stream never exceeds the one byte bound on a stored artifact part
 * (tool-result-artifacts D4). A Machine keeps the protocol constant instead.
 */

import { type BashExecutorContext } from '@workspace/bash-executor';

import { artifactMaxBytes } from './artifacts/spill';
import { bashWorkingDirectory } from './env';
import { type ToolContext } from './types';

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
    maxProcesses: 1,
  };
}
