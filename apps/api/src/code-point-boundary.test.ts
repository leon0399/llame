import {
  codePointSafeCutIndex,
  cutStringAtCodePointBoundary,
} from './code-point-boundary';

describe('cutStringAtCodePointBoundary', () => {
  const grin = '\u{1F600}'; // one code point, two UTF-16 code units

  /**
   * `String.prototype.isWellFormed` is ES2024, above this package's configured
   * lib. A unicode-mode pattern matches whole code points, so a paired surrogate
   * never enters this range and only an unpaired one does.
   */
  const LONE_SURROGATE_PATTERN = /[\uD800-\uDFFF]/u;
  function isWellFormed(value: string): boolean {
    return !LONE_SURROGATE_PATTERN.test(value);
  }

  it('steps back a unit when the cut splits a surrogate pair', () => {
    const cut = cutStringAtCodePointBoundary(`${grin}${grin}`, 3);
    expect(cut).toBe(grin);
    expect(isWellFormed(cut)).toBe(true);
  });

  it('keeps a pair the cut lands exactly after', () => {
    expect(cutStringAtCodePointBoundary(`${grin}${grin}`, 2)).toBe(grin);
  });

  it('cuts plain text at the limit and leaves short values alone', () => {
    expect(cutStringAtCodePointBoundary('abcdef', 3)).toBe('abc');
    expect(cutStringAtCodePointBoundary('ab', 5)).toBe('ab');
    expect(cutStringAtCodePointBoundary('ab', 0)).toBe('');
  });

  it('does not step back for a BMP character before the cut', () => {
    // `é` is a single code unit, not a surrogate — the guard must not fire.
    expect(cutStringAtCodePointBoundary(`aé${grin}`, 2)).toBe('aé');
  });
});

describe('codePointSafeCutIndex', () => {
  const grin = '\u{1F600}'; // one code point, two UTF-16 code units

  it('steps back one unit when the index splits a surrogate pair', () => {
    expect(codePointSafeCutIndex(grin, 1)).toBe(0);
  });

  it('leaves an index that does not split a pair unchanged', () => {
    expect(codePointSafeCutIndex(`${grin}${grin}`, 2)).toBe(2);
    expect(codePointSafeCutIndex('abc', 2)).toBe(2);
  });

  it('recognizes both inclusive ends of the high and low surrogate ranges', () => {
    expect(codePointSafeCutIndex('\uD800\uDC00', 1)).toBe(0);
    expect(codePointSafeCutIndex('\uD800\uDFFF', 1)).toBe(0);
    expect(codePointSafeCutIndex('\uDBFF\uDC00', 1)).toBe(0);
    expect(codePointSafeCutIndex('\uDBFF\uDFFF', 1)).toBe(0);
  });

  it('requires both halves to be surrogates in their correct positions', () => {
    expect(codePointSafeCutIndex('\uD7FF\uDC00', 1)).toBe(1);
    expect(codePointSafeCutIndex('\uDC00\uDC00', 1)).toBe(1);
    expect(codePointSafeCutIndex('\uD800\uDBFF', 1)).toBe(1);
    expect(codePointSafeCutIndex('\uD800\uE000', 1)).toBe(1);
  });

  it('operates on the index alone: an out-of-range index is not clamped', () => {
    // No production caller passes an index beyond `text.length`; this pins the
    // primitive's actual contract (index-only, no bounds-checking) rather than
    // guessing at defensive behavior nothing exercises.
    expect(codePointSafeCutIndex('ab', 5)).toBe(5);
  });
});
