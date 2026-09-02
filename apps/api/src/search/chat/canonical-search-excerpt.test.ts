import {
  buildCanonicalSearchExcerpt,
  CANONICAL_SEARCH_MAX_EXCERPT_CODE_POINTS,
} from './canonical-search-excerpt';

const timestamp = new Date('2026-08-27T12:00:00.000Z');

function passage(
  source: string,
  anchor: {
    startOffset: number;
    endOffsetExclusive: number;
    kind: 'exact' | 'fallback';
  },
  lines = [
    {
      line: 0,
      text: source,
      delimiter: '',
      startOffset: 0,
      endOffsetExclusive: source.length,
    },
  ],
) {
  return {
    message: { messageSeq: 7, role: 'user' as const, timestamp },
    offset: 0,
    limit: lines.length,
    lines,
    anchor: { line: 0, ...anchor },
  };
}

describe('buildCanonicalSearchExcerpt', () => {
  it('returns an empty excerpt when the selected passage has no lines', () => {
    expect(
      buildCanonicalSearchExcerpt(
        passage(
          'ignored',
          {
            startOffset: 0,
            endOffsetExclusive: 1,
            kind: 'exact',
          },
          [],
        ),
      ),
    ).toBe('');
  });

  it('preserves every selected line and delimiter under the cap', () => {
    const lines = [
      {
        line: 0,
        text: 'first',
        delimiter: '\r\n',
        startOffset: 0,
        endOffsetExclusive: 5,
      },
      {
        line: 1,
        text: 'second',
        delimiter: '',
        startOffset: 7,
        endOffsetExclusive: 13,
      },
    ];
    expect(
      buildCanonicalSearchExcerpt(
        passage(
          'first\r\nsecond',
          {
            startOffset: 8,
            endOffsetExclusive: 10,
            kind: 'exact',
          },
          lines,
        ),
      ),
    ).toBe('first\r\nsecond');
  });

  it('crops a fallback anchor from the anchor to the end without a suffix when it fits', () => {
    const source = `${'a'.repeat(100)}😀needle${'b'.repeat(480)}`;
    const start = source.indexOf('😀');
    const result = buildCanonicalSearchExcerpt(
      passage(source, {
        startOffset: start,
        endOffsetExclusive: start + 2,
        kind: 'fallback',
      }),
    );

    expect(result.startsWith('😀needle')).toBe(true);
    expect(result.endsWith('…')).toBe(false);
    expect(Array.from(result).length).toBe(Array.from(source).length - start);
  });

  it('crops a fallback anchor in a long passage with a bounded suffix', () => {
    const source = `${'a'.repeat(100)}needle${'b'.repeat(800)}`;
    const start = source.indexOf('needle');
    const result = buildCanonicalSearchExcerpt(
      passage(source, {
        startOffset: start,
        endOffsetExclusive: start + 6,
        kind: 'fallback',
      }),
    );

    expect(result.startsWith('needle')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
    expect(Array.from(result).length).toBe(
      CANONICAL_SEARCH_MAX_EXCERPT_CODE_POINTS,
    );
  });

  it('repositions an exact-anchor window when its end would be clipped', () => {
    const source = `${'a'.repeat(900)}needle${'b'.repeat(500)}`;
    const start = source.indexOf('needle');
    const result = buildCanonicalSearchExcerpt(
      passage(source, {
        startOffset: start,
        endOffsetExclusive: start + 6,
        kind: 'exact',
      }),
    );

    expect(result).toContain('needle');
    expect(result.startsWith('…')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
    expect(Array.from(result).length).toBe(
      CANONICAL_SEARCH_MAX_EXCERPT_CODE_POINTS,
    );
  });

  it('clamps out-of-range exact coordinates and never emits a broken surrogate', () => {
    const source = `${'a'.repeat(700)}😀${'b'.repeat(100)}`;
    const result = buildCanonicalSearchExcerpt(
      passage(source, {
        startOffset: -100,
        endOffsetExclusive: source.length + 100,
        kind: 'exact',
      }),
    );

    expect(Array.from(result).length).toBeLessThanOrEqual(
      CANONICAL_SEARCH_MAX_EXCERPT_CODE_POINTS,
    );
    expect(result).not.toContain('\uFFFD');
  });
});
