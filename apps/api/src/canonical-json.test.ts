import {
  canonicalJson,
  canonicalize,
  compareCodePoints,
  hashWithDomain,
} from './canonical-json';

describe('canonical JSON helpers', () => {
  it('orders object keys by Unicode code point and preserves nested values', () => {
    expect(canonicalJson({ z: 1, a: { b: true, a: ['x', null] } })).toBe(
      '{"a":{"a":["x",null],"b":true},"z":1}',
    );
    expect(canonicalize([3, false, null, undefined])).toEqual([
      3,
      false,
      null,
      undefined,
    ]);
  });

  it('compares shared prefixes by length and rejects unsupported values', () => {
    expect(compareCodePoints('same', 'same')).toBe(0);
    expect(compareCodePoints('a', 'aa')).toBeLessThan(0);
    expect(compareCodePoints('aa', 'a')).toBeGreaterThan(0);
    expect(compareCodePoints('😀', '\uE000')).toBeGreaterThan(0);
    expect(() => canonicalize(Symbol('unsupported'))).toThrow(TypeError);
    expect(() => canonicalize(() => undefined)).toThrow(/function/);
  });

  it('separates hash domains even for the same payload', () => {
    const payload = canonicalJson({ value: 'x' });
    expect(hashWithDomain('one', payload)).toMatch(/^[0-9a-f]{64}$/u);
    expect(hashWithDomain('one', payload)).not.toBe(
      hashWithDomain('two', payload),
    );
  });
});
