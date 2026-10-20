/**
 * The local managed `bash` bounds (design D6 of the bash-execution capability).
 * Local execution and an `ssh://` command share them, so a remote call is held
 * to the same output, input, time, and process limits as a local one.
 */

import { type BashExecutorContext } from '@workspace/bash-executor';

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
    outputBound: Number('32000'),
    inputBound: Number('8000'),
    durationMs: Number('300000'),
    maxProcesses: 1,
  };
}
