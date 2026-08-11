import { describe, expect, it } from 'vitest';

import {
  PROTECTED_VALUE_REDACTION_MARKER,
  containsProtectedValueJson,
  normalizeProtectedValues,
  sanitizeProtectedValueJson,
} from './protected-values';

describe('protected values', () => {
  const protectedValues = normalizeProtectedValues([
    '',
    'AUTH-SENTINEL',
    'AUTH',
    'SESSION-SENTINEL',
    'AUTH-SENTINEL',
  ]);

  it('drops empty duplicates and orders values for deterministic longest replacement', () => {
    expect(protectedValues).toEqual([
      'SESSION-SENTINEL',
      'AUTH-SENTINEL',
      'AUTH',
    ]);
  });

  it('does not treat an empty raw protected value as a match for every argument', () => {
    expect(containsProtectedValueJson('safe', ['', 'AUTH'])).toBe(false);
  });

  it('normalizes raw protected values before redacting them', () => {
    expect(sanitizeProtectedValueJson('safe AUTH', ['', 'AUTH'])).toEqual({
      success: true,
      value: `safe ${PROTECTED_VALUE_REDACTION_MARKER}`,
    });
  });

  it('redacts every protected occurrence in string leaves from earliest to longest', () => {
    expect(
      sanitizeProtectedValueJson(
        'prefix AUTH-SENTINEL then AUTH then SESSION-SENTINEL',
        protectedValues,
      ),
    ).toEqual({
      success: true,
      value:
        `prefix ${PROTECTED_VALUE_REDACTION_MARKER} then ` +
        `${PROTECTED_VALUE_REDACTION_MARKER} then ${PROTECTED_VALUE_REDACTION_MARKER}`,
    });
  });

  it('replaces an exact canonical scalar protected value as a whole leaf', () => {
    expect(
      sanitizeProtectedValueJson(410, normalizeProtectedValues(['410'])),
    ).toEqual({
      success: true,
      value: PROTECTED_VALUE_REDACTION_MARKER,
    });
    expect(
      sanitizeProtectedValueJson(false, normalizeProtectedValues(['false'])),
    ).toEqual({
      success: true,
      value: PROTECTED_VALUE_REDACTION_MARKER,
    });
    expect(
      sanitizeProtectedValueJson(null, normalizeProtectedValues(['null'])),
    ).toEqual({
      success: true,
      value: PROTECTED_VALUE_REDACTION_MARKER,
    });
  });

  it('recursively sanitizes arrays and objects while preserving safe structure', () => {
    expect(
      sanitizeProtectedValueJson(
        {
          safe: ['AUTH-SENTINEL', { nested: 'before SESSION-SENTINEL after' }],
          enabled: true,
        },
        protectedValues,
      ),
    ).toEqual({
      success: true,
      value: {
        safe: [
          PROTECTED_VALUE_REDACTION_MARKER,
          { nested: `before ${PROTECTED_VALUE_REDACTION_MARKER} after` },
        ],
        enabled: true,
      },
    });
  });

  it('fails closed for an object key containing a protected value without retaining payload', () => {
    const result = sanitizeProtectedValueJson(
      { 'AUTH-SENTINEL-key': { deeply: 'AUTH-SENTINEL' } },
      protectedValues,
    );

    expect(result).toEqual({ success: false, reason: 'protected_value_key' });
    expect(JSON.stringify(result)).not.toContain('AUTH-SENTINEL');
  });

  it('detects direct protected values in call arguments without exposing them', () => {
    expect(
      containsProtectedValueJson(
        { query: 'safe', options: ['SESSION-SENTINEL'] },
        protectedValues,
      ),
    ).toBe(true);
    expect(
      containsProtectedValueJson(
        { query: 'safe', options: [410] },
        protectedValues,
      ),
    ).toBe(false);
    expect(
      containsProtectedValueJson(
        { 'AUTH-SENTINEL-key': 'safe' },
        protectedValues,
      ),
    ).toBe(true);
  });
});
