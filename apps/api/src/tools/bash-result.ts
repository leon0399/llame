/**
 * The `bash` result mapping local, Machine, and `ssh://` execution share: a
 * managed result becomes the structured observation the model reads, and a
 * timeout keeps its partial output.
 */

import { type BashResult } from '@workspace/bash-executor';

import { type ToolResult } from './types';

export function toToolResult(result: BashResult): ToolResult {
  if (result.status === 'success') {
    return {
      status: 'success',
      operation: result.operation,
      executor: result.executor,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated,
    };
  }
  if ('type' in result) {
    if (result.type === 'timed_out') {
      return {
        status: 'error',
        type: 'timed_out',
        message: `Command exceeded its deadline of ${result.durationMs} ms.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}${result.truncated ? '\nOutput was truncated.' : ''}`,
      };
    }
    return {
      status: 'error',
      type: result.type,
      message: result.message,
    };
  }
  return {
    status: 'error',
    type: 'command_failed',
    message: `Command exited with code ${result.exitCode}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  };
}
