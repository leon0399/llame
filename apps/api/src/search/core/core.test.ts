import { chunkByCharBudget, cutTextAtBoundary } from './chunking';
import { recallAtK, reciprocalRank, summarizeEval } from './eval';
import { assertScopePredicate, RRF_DEFAULT_K, rrfScore } from './fusion';
import { chunkContentHash, normalizeForSearch } from './text';
import { sql } from 'drizzle-orm';

describe('normalizeForSearch', () => {
  it('lowercases while preserving accents (no diacritic stripping)', () => {
    expect(normalizeForSearch('Café RÉSUMÉ')).toBe('café résumé');
  });

  it('lowercases Cyrillic (case-insensitive non-ASCII, #171)', () => {
    expect(normalizeForSearch('ПРИВЕТ Мир')).toBe('привет мир');
  });

  it('collapses all whitespace/newlines to single spaces and trims', () => {
    expect(normalizeForSearch('  a\n\n b\t c  ')).toBe('a b c');
  });

  it('applies NFKC (compatibility normalization)', () => {
    // Full-width "ＡＢ" → "ab"
    expect(normalizeForSearch('ＡＢ')).toBe('ab');
  });

  it('preserves code/identifiers/URLs (only cased/whitespace-folded)', () => {
    expect(normalizeForSearch('See https://EXAMPLE.com/Path?x=1')).toBe(
      'see https://example.com/path?x=1',
    );
  });
});

describe('chunkContentHash', () => {
  const base = {
    chunkerVersion: 1,
    content: 'Hello World',
    normalizedContent: 'hello world',
    firstMessageId: 'a',
    lastMessageId: 'b',
  };
  it('is deterministic', () => {
    expect(chunkContentHash(base)).toBe(chunkContentHash({ ...base }));
  });
  it('changes with version, content, normalized content, or range', () => {
    expect(chunkContentHash({ ...base, chunkerVersion: 2 })).not.toBe(
      chunkContentHash(base),
    );
    // Casing-only content change: normalizedContent is unchanged, but the hash
    // must still differ so the stored snippet source refreshes.
    expect(chunkContentHash({ ...base, content: 'HELLO WORLD' })).not.toBe(
      chunkContentHash(base),
    );
    expect(chunkContentHash({ ...base, normalizedContent: 'x' })).not.toBe(
      chunkContentHash(base),
    );
    expect(chunkContentHash({ ...base, lastMessageId: 'c' })).not.toBe(
      chunkContentHash(base),
    );
  });
});

describe('chunkByCharBudget', () => {
  const size = (s: string) => s.length;

  it('groups whole items under the budget with trailing overlap', () => {
    const items = ['aa', 'bb', 'cc', 'dd']; // 2 chars each
    const groups = chunkByCharBudget(items, size, {
      maxChars: 5,
      overlapItems: 1,
    });
    // 'aa'+'bb'=4 (<=5), +'cc'=6 >5 → close. Next seeds with 'bb' (overlap): 'bb'+'cc'=4, +'dd'=6>5 → close. Next 'cc'+'dd'.
    expect(groups).toEqual([
      ['aa', 'bb'],
      ['bb', 'cc'],
      ['cc', 'dd'],
    ]);
  });

  it('passes an oversized single item through as its own chunk', () => {
    const items = ['x', 'HUGEHUGEHUGE', 'y'];
    const groups = chunkByCharBudget(items, size, {
      maxChars: 4,
      overlapItems: 0,
    });
    expect(groups).toEqual([['x'], ['HUGEHUGEHUGE'], ['y']]);
  });

  it('does not drag a truly oversized item forward as overlap', () => {
    const items = ['HUGEHUGE', 'bb', 'cc']; // 'HUGEHUGE'=8 > maxChars 4
    const groups = chunkByCharBudget(items, size, {
      maxChars: 4,
      overlapItems: 1,
    });
    expect(groups).toEqual([['HUGEHUGE'], ['bb', 'cc']]);
  });

  it('does not drag an exactly-budget-filling item forward as overlap', () => {
    const items = ['aaaa', 'bb', 'cc']; // 'aaaa'=4 == maxChars 4 (already a full chunk)
    const groups = chunkByCharBudget(items, size, {
      maxChars: 4,
      overlapItems: 1,
    });
    // 'aaaa' is its own chunk and is NOT carried into the next (would bloat it).
    expect(groups).toEqual([['aaaa'], ['bb', 'cc']]);
  });

  it('returns empty for empty input', () => {
    expect(
      chunkByCharBudget([], size, { maxChars: 5, overlapItems: 1 }),
    ).toEqual([]);
  });
});

describe('cutTextAtBoundary', () => {
  it('returns text.length unchanged when the tail from `from` already fits', () => {
    expect(cutTextAtBoundary('hello world', 0, 20)).toBe(11);
    expect(cutTextAtBoundary('hello world', 6, 5)).toBe(11);
  });

  it('prefers a blank line over any other boundary within the budget', () => {
    const text = 'first paragraph.\n\nsecond paragraph continues onward';
    const cut = cutTextAtBoundary(text, 0, 30);
    expect(text.slice(0, cut)).toBe('first paragraph.\n\n');
  });

  it('falls back to a sentence end when no blank line is in budget', () => {
    const text = 'One sentence. Another one that runs long after it';
    const cut = cutTextAtBoundary(text, 0, 20);
    expect(text.slice(0, cut)).toBe('One sentence. ');
  });

  it('falls back to plain whitespace when no sentence end is in budget', () => {
    const text = 'aaaaaaaaaa bbbbbbbbbb cccccccccc';
    const cut = cutTextAtBoundary(text, 0, 15);
    expect(text.slice(0, cut)).toBe('aaaaaaaaaa ');
  });

  it('hard-cuts at maxLen when no boundary exists at all', () => {
    const text = 'x'.repeat(50);
    expect(cutTextAtBoundary(text, 0, 20)).toBe(20);
  });

  it('never splits a surrogate pair on the hard-cut path', () => {
    const grin = '\u{1F600}'; // two UTF-16 code units
    const text = `${'x'.repeat(19)}${grin}${'x'.repeat(10)}`;
    // The pair spans indices 19-20; a cut at 20 would split it.
    expect(cutTextAtBoundary(text, 0, 20)).toBe(19);
  });

  it('bounds its lookahead to `from + maxLen`, not the whole string', () => {
    // A boundary exists far past the budget but must never be chosen — proves
    // the window is `[from, from + maxLen)`, the property the linear-time
    // chunking loop depends on (search/chat/conversation-chunker.ts, #517).
    const text = `${'x'.repeat(30)}\n\n${'y'.repeat(30)}`;
    expect(cutTextAtBoundary(text, 0, 10)).toBe(10);
  });

  it('respects a nonzero `from` cursor: the window starts there, not at 0', () => {
    const text = 'AAAA. BBBB. CCCC.';
    // Starting after "AAAA. ", the next boundary within budget is "BBBB. ".
    const cut = cutTextAtBoundary(text, 6, 8);
    expect(text.slice(6, cut)).toBe('BBBB. ');
  });
});

describe('rrfScore', () => {
  it('sums weight/(k+rank) per present leg; absent legs contribute 0', () => {
    const score = rrfScore(
      [
        { weight: 1, rank: 1 },
        { weight: 0.35, rank: undefined },
      ],
      RRF_DEFAULT_K,
    );
    expect(score).toBeCloseTo(1 / 61, 10);
  });

  it('ranks a doc found in two legs above one found in a single leg', () => {
    const both = rrfScore([
      { weight: 1, rank: 3 },
      { weight: 1, rank: 3 },
    ]);
    const one = rrfScore([
      { weight: 1, rank: 1 },
      { weight: 1, rank: undefined },
    ]);
    expect(both).toBeGreaterThan(one);
  });
});

describe('assertScopePredicate', () => {
  it('throws when scope is undefined (fail-closed)', () => {
    expect(() => assertScopePredicate(undefined)).toThrow(/scope predicate/i);
  });
  it('passes for a real predicate', () => {
    expect(() => assertScopePredicate(sql`owner_user_id = 'x'`)).not.toThrow();
  });
});

describe('eval metrics', () => {
  it('recallAtK finds a relevant id within the cutoff', () => {
    expect(recallAtK(['a', 'b', 'c'], new Set(['c']), 3)).toBe(1);
    expect(recallAtK(['a', 'b', 'c'], new Set(['c']), 2)).toBe(0);
  });

  it('reciprocalRank uses the first relevant position', () => {
    expect(reciprocalRank(['a', 'b', 'c'], new Set(['b']))).toBeCloseTo(1 / 2);
    expect(reciprocalRank(['a'], new Set(['z']))).toBe(0);
  });

  it('summarizes overall and per-category, counting zero-result queries', () => {
    const s = summarizeEval(
      [
        { category: 'exact', rankedIds: ['x'], relevant: new Set(['x']) },
        { category: 'typo', rankedIds: [], relevant: new Set(['y']) },
      ],
      10,
    );
    expect(s.count).toBe(2);
    expect(s.recallAtK).toBeCloseTo(0.5);
    expect(s.zeroResultRate).toBeCloseTo(0.5);
    expect(s.byCategory.exact.recallAtK).toBe(1);
    expect(s.byCategory.typo.zeroResultRate).toBe(1);
  });
});
