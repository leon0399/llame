import { describe, expect, it } from 'vitest';

import { PROTECTED_VALUE_REDACTION_MARKER } from '@workspace/runtime-safety';

import {
  sanitizeKnownResultAtBound,
  type BashKnownResult,
  type StreamBound,
} from './bash-contract';

const MARKER = PROTECTED_VALUE_REDACTION_MARKER;

function result(stdout: string): BashKnownResult {
  return {
    status: 'success',
    exitCode: 0,
    stdout,
    stderr: '',
    truncated: false,
  };
}

function sanitizeGap(
  stdout: string,
  protectedValues: ReadonlyArray<string>,
  gapAt: number,
): BashKnownResult {
  return sanitizeKnownResultAtBound(
    result(stdout),
    { kind: 'code-units', limit: 64 },
    protectedValues,
    { stdout: { endedByLlame: true, gapAt } },
  );
}

describe('bash result sanitization around transport gaps', () => {
  it('drops both member fragments around a transport gap', () => {
    const members = ['SECRET-KEY'];
    const sanitized = sanitizeGap('xSECRET-KEYy', members, 4);

    expect(sanitized.stdout).toBe('xy');
    expect(sanitized.truncated).toBe(true);
    expect(sanitized.stdout).not.toContain(members[0]);
  });

  it('drops only the tail fragment a transport gap left', () => {
    const members = ['SECRET-KEY-ABCDEF'];
    const sanitized = sanitizeGap('aaaKEY-ABCDEF zzz', members, 3);

    expect(sanitized.stdout).toBe('aaa zzz');
    expect(sanitized.truncated).toBe(true);
    expect(sanitized.stdout).not.toContain(members[0]);
  });

  it('redacts a complete member kept before a transport gap', () => {
    const members = ['ABCDEFGHIJ'];
    const sanitized = sanitizeGap('xxABCDEFGHIJKLMN', members, 12);

    expect(sanitized.stdout).toBe(`xx${MARKER}KLMN`);
    expect(sanitized.truncated).toBe(true);
    expect(sanitized.stdout).not.toContain(members[0]);
  });

  it('redacts a complete member kept after a transport gap', () => {
    const members = ['SECRET-KEY'];
    const sanitized = sanitizeGap('prefix gap SECRET-KEY', members, 10);

    expect(sanitized.stdout).toBe(`prefix gap ${MARKER}`);
    expect(sanitized.truncated).toBe(true);
    expect(sanitized.stdout).not.toContain(members[0]);
  });
});

describe('bash output bounds', () => {
  it('backs off a byte cut inside a multibyte character', () => {
    const bound: StreamBound = { kind: 'bytes', limit: 4 };
    const sanitized = sanitizeKnownResultAtBound(result('a😀b'), bound);

    expect(sanitized.stdout).toBe('a');
    expect(sanitized.truncated).toBe(true);
  });

  it('cuts bytes without splitting a surrogate pair', () => {
    const resultText = '😀abcd';

    expect(
      sanitizeKnownResultAtBound(result(resultText), {
        kind: 'bytes',
        limit: 7,
      }).stdout,
    ).toBe('😀abc');
    expect(
      sanitizeKnownResultAtBound(result(resultText), {
        kind: 'bytes',
        limit: 8,
      }).stdout,
    ).toBe('😀abcd');
  });

  it('cuts code units without splitting a surrogate pair', () => {
    const text = '😀abc';

    expect(
      sanitizeKnownResultAtBound(result(text), {
        kind: 'code-units',
        limit: 1,
      }).stdout,
    ).toBe('');
    expect(
      sanitizeKnownResultAtBound(result(text), {
        kind: 'code-units',
        limit: 2,
      }).stdout,
    ).toBe('😀');
  });
});
