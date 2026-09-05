import { describe, expect, it } from 'vitest';

import {
  PROTECTED_VALUE_REDACTION_MARKER,
  containsProtectedValueJson,
  normalizeProtectedValues,
  redactProtectedString,
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

  it('uses the stable public redaction marker', () => {
    expect(PROTECTED_VALUE_REDACTION_MARKER).toBe('[REDACTED]');
  });

  it('orders overlapping values longest first and equal lengths lexically', () => {
    const expected = ['alpha', 'bravo', 'delta'];
    const permutations = [
      ['alpha', 'bravo', 'delta'],
      ['alpha', 'delta', 'bravo'],
      ['bravo', 'alpha', 'delta'],
      ['bravo', 'delta', 'alpha'],
      ['delta', 'alpha', 'bravo'],
      ['delta', 'bravo', 'alpha'],
    ];

    for (const values of permutations) {
      expect(normalizeProtectedValues(values)).toEqual(expected);
    }

    expect(normalizeProtectedValues(['AUTH', 'AUTH-SENTINEL'])).toEqual([
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

  it('prefers the longest same-position match in the exported string redactor', () => {
    expect(
      redactProtectedString('AUTH-SENTINEL', ['AUTH', 'AUTH-SENTINEL']),
    ).toBe(PROTECTED_VALUE_REDACTION_MARKER);
  });

  it('redacts an earlier shorter match before a later longer match', () => {
    expect(
      redactProtectedString('AUTH then AUTH-SENTINEL', [
        'AUTH',
        'AUTH-SENTINEL',
      ]),
    ).toBe(
      `${PROTECTED_VALUE_REDACTION_MARKER} then ${PROTECTED_VALUE_REDACTION_MARKER}`,
    );
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

  it('detects protected canonical scalars directly', () => {
    expect(containsProtectedValueJson(410, ['410'])).toBe(true);
    expect(containsProtectedValueJson(false, ['false'])).toBe(true);
    expect(containsProtectedValueJson(null, ['null'])).toBe(true);
    expect(containsProtectedValueJson(411, ['410'])).toBe(false);
  });

  it('detects a protected item when another array item is safe', () => {
    expect(containsProtectedValueJson(['safe', 'AUTH'], ['AUTH'])).toBe(true);
  });

  it('propagates a protected-key failure from an object nested in an array', () => {
    expect(
      sanitizeProtectedValueJson(
        ['safe', { nested: { 'AUTH-key': 'payload' } }],
        ['AUTH'],
      ),
    ).toEqual({ success: false, reason: 'protected_value_key' });
  });

  it('propagates a protected-key failure from a nested object', () => {
    expect(
      sanitizeProtectedValueJson(
        { safe: { nested: { 'AUTH-key': 'payload' } } },
        ['AUTH'],
      ),
    ).toEqual({ success: false, reason: 'protected_value_key' });
  });
});
