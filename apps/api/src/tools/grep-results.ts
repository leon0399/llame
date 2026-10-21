/**
 * The closed results and the internal failure type every `grep` scope
 * resolution shares. Kept apart from the tool so the Knowledge and skill
 * backends can refuse without importing the tool that registered them.
 */

import { GrepPortError } from '@workspace/native-file-tools';

import { type ToolResult } from './types';

/** The error half of a tool result, which a scope refusal always is. */
export type GrepToolError = Extract<ToolResult, { status: 'error' }>;

/** Narrow a result to the error half, so a refusal keeps its message. */
export function isGrepToolError(result: ToolResult): result is GrepToolError {
  return result.status === 'error';
}

/**
 * A scope that failed while the engine walked it. The walk itself has no
 * result vocabulary, so the port carries the closed result the call returns.
 */
export class GrepScopeFailure extends GrepPortError {
  constructor(readonly result: GrepToolError) {
    super(result.message);
  }
}

export function invalidInputResult(message: string): GrepToolError {
  return { status: 'error', type: 'invalid_input', message };
}

export function invalidCursorResult(): GrepToolError {
  return invalidInputResult(
    'The grep cursor is invalid for these inputs; repeat the call without it.',
  );
}

export function invalidPatternResult(
  index: number,
  message: string,
): GrepToolError {
  return {
    status: 'error',
    type: 'invalid_pattern',
    message: `Pattern ${index}: ${message}`,
  };
}

export function invalidPathResult(message: string): GrepToolError {
  return { status: 'error', type: 'invalid_path', message };
}

export function unsupportedGlobResult(operator: string): GrepToolError {
  return invalidPathResult(
    `The glob operator \`${operator}\` is not supported; write \`*\`, \`**\`, and \`?\` instead.`,
  );
}

/** The one result a missing path and a `read`-refused path both return. */
export function notFoundResult(): GrepToolError {
  return { status: 'error', type: 'not_found', message: 'File not found.' };
}

/** This layer has no host backend; the host layer replaces this branch. */
export function executorUnavailableResult(): GrepToolError {
  return {
    status: 'error',
    type: 'executor_unavailable',
    message: 'Native host authority is unavailable.',
  };
}

/** This layer has no Machine backend; the Machine layer replaces this branch. */
export function machineUnsupportedResult(): GrepToolError {
  return invalidPathResult(
    'Machine locators cannot be searched on this process yet.',
  );
}
