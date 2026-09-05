import { describe, expect, it } from 'vitest';

import { isRecord } from './unknown-record';

describe('isRecord', () => {
  it('accepts plain and null-prototype records', () => {
    expect(isRecord({ key: 'value' })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it('accepts Error instances as records', () => {
    expect(isRecord(new Error('sentinel'))).toBe(true);
  });

  it.each([null, [], 'value', 42, true, undefined, () => undefined])(
    'rejects %s',
    (value) => {
      expect(isRecord(value)).toBe(false);
    },
  );
});
