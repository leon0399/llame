import { describe, expect, it } from 'vitest';

import { evaluateCase } from './eval-report';
import { type RankingCase } from './fixtures';

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
  });
});
