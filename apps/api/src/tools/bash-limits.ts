/**
 * The local managed `bash` bounds (design D6 of the bash-execution capability).
 * Local execution and an `ssh://` command share these output, input, and time bounds.
 *
 * The output bound is `tools.artifacts.maxBytes` counted in UTF-8 bytes, so a
 * stream never exceeds the one byte bound on a stored artifact part
 * (tool-result-artifacts D4). A Machine keeps the protocol constant instead.
 */

import { type BashExecutorContext } from '@workspace/bash-executor';
import { isNumber, isRecord } from '@workspace/runtime-safety';
import { artifactMaxBytes } from './artifacts/spill';
import { bashWorkingDirectory } from './env';
import { type ToolContext } from './types';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';

/**
 * The 750 ms the Bash watcher needs to prove process-group quiescence and the
 * durable `native.result` append a small bounded window, after a Run abort and
 * after the foreground bound. A hung database falls back to the unknown outcome.
 */
export const BASH_SETTLEMENT_GRACE_MS = 750;

type MessageMoveWindow = {
  readonly cause: 'message';
  readonly deadlineAt: number;
};

function isMessageMoveWindow(value: unknown): value is MessageMoveWindow {
  return (
    isRecord(value) &&
    value.cause === 'message' &&
    isNumber(value.deadlineAt) &&
    Number.isFinite(value.deadlineAt)
  );
}

/** A call-local yield deadline shared by the spawn gate and runner backstop. */
export function messageMoveWindow(
  signal: AbortSignal | undefined,
): MessageMoveWindow | undefined {
  const reason: unknown = signal?.reason;

  return isMessageMoveWindow(reason) ? reason : undefined;
}

/** The foreground bound: the lesser of the operator bound and the call timeout. */
export function foregroundBoundMs(
  backgroundAfterSeconds: number | undefined,
  callTimeoutMs: number,
): number {
  const operator =
    (backgroundAfterSeconds ??
      BUILT_IN_DEFAULTS.tools.bash.backgroundAfterSeconds) * 1000;

  return Math.min(operator, callTimeoutMs);
}

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
    // SSH commands do not use the local managed-process limiter.
    maxProcesses: 1,
  };
}
