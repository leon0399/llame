import { describe, expect, it } from 'vitest';

import { permissionDeniedResult, rejectedHopUrl } from './messages';

describe('rejectedHopUrl', () => {
  it('strips control characters and bounds the locator at 2,048 characters', () => {
    expect(rejectedHopUrl('https://docs.example.com/a\u0007b')).toBe(
      'https://docs.example.com/ab',
    );

    const long = rejectedHopUrl(`https://docs.example.com/${'a'.repeat(4096)}`);
    expect(long).toHaveLength(2048);
    expect(long.startsWith('https://docs.example.com/aaa')).toBe(true);
  });

  it('never echoes query or fragment text of an unparsable locator', () => {
    expect(rejectedHopUrl('not a url?token=secret#part')).toBe('not a url');
  });
});

describe('permissionDeniedResult', () => {
  it('carries no locator field for a submitted call', () => {
    for (const reason of [
      'explicit_reject',
      'no_allow',
      'invalid_field',
      'input_limit',
    ] as const) {
      expect(Object.keys(permissionDeniedResult(reason)).sort()).toEqual([
        'message',
        'status',
        'type',
      ]);
    }
  });
});
