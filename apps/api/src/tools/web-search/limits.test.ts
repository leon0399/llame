import { ENGINE_LIMITS, acceptsQuery } from './limits';

const words = (count: number): string =>
  Array.from({ length: count }, () => 'word').join(' ');

describe('acceptsQuery', () => {
  it('accepts a query at the brave code-point limit and rejects one above it', () => {
    expect(acceptsQuery(ENGINE_LIMITS.brave, 'x'.repeat(600))).toBe(true);
    expect(acceptsQuery(ENGINE_LIMITS.brave, 'x'.repeat(601))).toBe(false);
  });

  it('counts code points, so a surrogate pair counts once', () => {
    // 600 code points in 1,200 UTF-16 units: within the brave limit.
    expect(acceptsQuery(ENGINE_LIMITS.brave, '😀'.repeat(600))).toBe(true);
    expect(acceptsQuery(ENGINE_LIMITS.brave, '😀'.repeat(601))).toBe(false);
  });

  it('counts words as runs of non-space characters', () => {
    expect(acceptsQuery(ENGINE_LIMITS.brave, words(75))).toBe(true);
    expect(acceptsQuery(ENGINE_LIMITS.brave, words(76))).toBe(false);
  });

  it('accepts every query for an engine type with no query limit', () => {
    expect(acceptsQuery(ENGINE_LIMITS.exa, 'x'.repeat(1000))).toBe(true);
    expect(acceptsQuery(ENGINE_LIMITS.aggregate, 'x'.repeat(1000))).toBe(true);
  });

  it('rejects a yandex query over its word limit even under its code-point limit', () => {
    // The spec's scenario: a query of 45 words and 300 characters. Its 300
    // code points pass the vendor's 400, and its 45 words do not pass 40.
    expect(acceptsQuery(ENGINE_LIMITS.yandex, words(45))).toBe(false);
    expect(acceptsQuery(ENGINE_LIMITS.yandex, words(40))).toBe(true);
    expect(acceptsQuery(ENGINE_LIMITS.yandex, 'x'.repeat(400))).toBe(true);
    expect(acceptsQuery(ENGINE_LIMITS.yandex, 'x'.repeat(401))).toBe(false);
  });
});
