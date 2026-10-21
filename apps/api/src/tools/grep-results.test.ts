import { describe, expect, it } from 'vitest';

import {
  executorUnavailableResult,
  invalidCursorResult,
  invalidInputResult,
  invalidPathResult,
  invalidPatternResult,
  isGrepToolError,
  machineUnsupportedResult,
  notFoundResult,
  unsupportedGlobResult,
} from './grep-results';

describe('grep results', () => {
  it('narrows only the error half of a tool result', () => {
    expect(isGrepToolError(invalidInputResult('x'))).toBe(true);
    expect(
      isGrepToolError({ status: 'success', results: [], complete: true }),
    ).toBe(false);
  });

  it('spells each refusal the model is told to act on', () => {
    expect(invalidCursorResult()).toEqual({
      status: 'error',
      type: 'invalid_input',
      message:
        'The grep cursor is invalid for these inputs; repeat the call without it.',
    });
    expect(invalidPatternResult(2, 'bad')).toEqual({
      status: 'error',
      type: 'invalid_pattern',
      message: 'Pattern 2: bad',
    });
    expect(invalidPathResult('x')).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'x',
    });
    expect(unsupportedGlobResult('{')).toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'The glob operator `{` is not supported; write `*`, `**`, and `?` instead.',
    });
    expect(notFoundResult()).toEqual({
      status: 'error',
      type: 'not_found',
      message: 'File not found.',
    });
  });

  it('names the missing backend its own layer owns', () => {
    expect(executorUnavailableResult()).toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    });
    expect(machineUnsupportedResult()).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'Machine locators cannot be searched on this process yet.',
    });
  });
});
