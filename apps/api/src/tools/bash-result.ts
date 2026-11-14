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
  type BashToolResult,
  type BashTimedOutResult,
  type BashUnavailableResult,
  type BashUnknownResult,
} from '@workspace/bash-executor';

import { type ToolResult } from './types';

/**
 * The artifact one spilled call stored: its locator and the notice line that
 * ends the text (without brackets, as the cap's own notice is stored).
 */
export type BashSpill = {
  readonly artifact: string;
  readonly notice: string;
};

/** A failure that carries the executor's streams, in the bash text shape. */
function failureResult(
  type: 'timed_out' | 'command_failed',
  result: BashKnownResult | BashTimedOutResult,
  spill: BashSpill | undefined,
): ToolResult {
  return {
    status: 'error',
    type,
    message: renderBashText({
      ...result,
      // A notice also tells the renderer the result was shortened, so the
      // executor's own cut must be explicit or its marker disappears.
      ...(result.truncated && { cut: true }),
      ...(spill !== undefined && { truncationNotice: spill.notice }),
    }),
    ...(spill !== undefined && { artifact: spill.artifact }),
  };
}

/** A failure the executor already classified; a timeout keeps its streams. */
function typedFailureResult(
  result: BashTimedOutResult | BashUnknownResult | BashUnavailableResult,
  spill: BashSpill | undefined,
): ToolResult {
  if (result.type !== 'timed_out')
    return { status: 'error', type: result.type, message: result.message };

  return failureResult('timed_out', result, spill);
}

/** A command that ended non-zero: the same shape, with its own exit code. */
function commandFailedResult(
  result: BashKnownResult,
  spill: BashSpill | undefined,
): ToolResult {
  return failureResult('command_failed', result, spill);
}

/** The observation the model reads, with the exit code and streams it holds. */
export function toToolResult(
  result: BashToolResult,
  spill?: BashSpill,
): ToolResult {
  if ('backgrounded' in result) return { ...result };

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
      ...(spill !== undefined && {
        artifact: spill.artifact,
        truncationNotice: spill.notice,
      }),
    };
  }

  if ('type' in result) return typedFailureResult(result, spill);

  return commandFailedResult(result, spill);
}
