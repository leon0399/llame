/**
 * The `bash` result mapping local, Machine, and `ssh://` execution share: a
 * managed result becomes the structured observation the model reads, and a
 * timeout keeps its partial output.
 *
 * A `command_failed` or `timed_out` message is the bash text shape of
 * `tool-result-rendering` — the status header, the streams, and the markers —
 * so the JSON failure object carries the same body a success renders on its
 * own (bash-execution "Command results are bounded and explicit").
 */

import {
  renderBashText,
  type BashKnownResult,
  type BashResult,
  type BashTimedOutResult,
  type BashUnavailableResult,
  type BashUnknownResult,
} from '@workspace/bash-executor';

import { type ToolResult } from './types';

/** The exit code a stopped command reports; the watcher's own code for it. */
const TIMED_OUT_EXIT_CODE = 1;

/** A failure the executor already classified; a timeout keeps its streams. */
function typedFailureResult(
  result: BashTimedOutResult | BashUnknownResult | BashUnavailableResult,
): ToolResult {
  if (result.type !== 'timed_out')
    return { status: 'error', type: result.type, message: result.message };
  return {
    status: 'error',
    type: 'timed_out',
    message: renderBashText({
      exitCode: TIMED_OUT_EXIT_CODE,
      wallTimeMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated,
    }),
  };
}

/** A command that ended non-zero: the same shape, with its own exit code. */
function commandFailedResult(result: BashKnownResult): ToolResult {
  return {
    status: 'error',
    type: 'command_failed',
    message: renderBashText({
      exitCode: result.exitCode,
      ...(result.wallTimeMs !== undefined && {
        wallTimeMs: result.wallTimeMs,
      }),
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated,
    }),
  };
}

/** The observation the model reads, which carries no constant fields. */
export function toToolResult(result: BashResult): ToolResult {
  if (result.status === 'success') {
    return {
      status: 'success',
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated,
      ...(result.wallTimeMs !== undefined && { wallTimeMs: result.wallTimeMs }),
    };
  }
  if ('type' in result) return typedFailureResult(result);
  return commandFailedResult(result);
}
