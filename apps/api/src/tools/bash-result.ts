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

/** A failure the executor already classified; a timeout keeps its streams. */
function typedFailureResult(
  result: BashTimedOutResult | BashUnknownResult | BashUnavailableResult,
): ToolResult {
  if (result.type !== 'timed_out')
    return { status: 'error', type: result.type, message: result.message };
  return {
    status: 'error',
    type: 'timed_out',
    // The type tells the renderer this command was stopped, not exited, so the
    // header names the measured elapsed time and no exit code.
    message: renderBashText(result),
  };
}

/** A command that ended non-zero: the same shape, with its own exit code. */
function commandFailedResult(result: BashKnownResult): ToolResult {
  return {
    status: 'error',
    type: 'command_failed',
    message: renderBashText(result),
  };
}

/** The observation the model reads, with the exit code and streams it holds. */
export function toToolResult(result: BashResult): ToolResult {
  if (result.status === 'success') {
    return {
      status: 'success',
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      // The executor's own cut, under a name the global result cap does not
      // overwrite: the cap writes `truncated` and a notice when it shortens a
      // rendering, so the model text marks only this flag
      // (tool-result-rendering "A bash result renders a status header and its
      // streams").
      ...(result.truncated && { cut: true }),
      ...(result.wallTimeMs !== undefined && { wallTimeMs: result.wallTimeMs }),
    };
  }
  if ('type' in result) return typedFailureResult(result);
  return commandFailedResult(result);
}
