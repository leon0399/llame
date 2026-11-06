import { describe, expect, it } from 'vitest';

import { evaluateCase, formatTable } from './eval-report';
import { type RankingCase } from './fixtures';
import { ndcgAtK, reciprocalRank } from './metrics';

const rankingCase: RankingCase = {
  name: 'demo',
  tool: 'grep',
  query: 'q',
  cards: [
    { key: 'a', text: 'a', relevant: false },
    { key: 'b', text: 'b', relevant: false },
    { key: 'c', text: 'c', relevant: true },
  ],
};

describe('metrics', () => {
  const relevant = new Set(['c']);
  it('nDCG@k is 1 for an ideal order and discounts by position', () => {
    expect(ndcgAtK(['c', 'a', 'b'], relevant, 5)).toBe(1);
    expect(ndcgAtK(['a', 'b', 'c'], relevant, 5)).toBeCloseTo(0.5, 5);
    expect(ndcgAtK(['a', 'b', 'c'], relevant, 2)).toBe(0);
    expect(ndcgAtK(['a'], new Set(), 5)).toBe(0);
  });
  it('MRR is the reciprocal first relevant rank, 0 when absent', () => {
    expect(reciprocalRank(['a', 'b', 'c'], relevant)).toBeCloseTo(1 / 3, 5);
    expect(reciprocalRank(['a'], relevant)).toBe(0);
  });
});

describe('evaluateCase', () => {
  it('prints the canonical baseline alone without recorded answers', () => {
    const rows = evaluateCase(rankingCase, []);
    expect(rows).toEqual([
      {
        caseName: 'demo',
        ranker: 'canonical',
        ndcg5: 0.5,
        mrr: 1 / 3,
        latencyMs: null,
        costUsd: null,
      },
    ]);
  });

  it('scores a recorded answer against the baseline', () => {
    const rows = evaluateCase(rankingCase, [
      {
        model: 'jev',
        status: 'ranked',
        scores: { a: 0.1, b: 0.2, c: 0.9 },
        latencyMs: 40,
        costUsd: 0.001,
      },
    ]);
    expect(rows[1]).toMatchObject({
      ranker: 'jev',
      ndcg5: 1,
      mrr: 1,
      latencyMs: 40,
      costUsd: 0.001,
    });
    expect(formatTable(rows)).toContain('jev');
    expect(formatTable(rows)).toContain('0.00100');
  });
});
