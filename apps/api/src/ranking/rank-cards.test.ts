import { describe, expect, it, vi } from 'vitest';

import {
  type CandidateJudgement,
  type DecisionJudge,
} from '../decisions/decisions.service';
import { loadRankingCases } from './fixtures';
import { assertPermutation, rankCards } from './rank-cards';

const cards = ['a', 'b', 'c', 'd'].map((key) => ({ key, text: key }));

function judgement(
  scores: Record<string, number> | undefined,
  overrides: Partial<CandidateJudgement> = {},
): CandidateJudgement {
  const map =
    scores === undefined ? undefined : new Map(Object.entries(scores));
  return {
    status: map === undefined ? 'unavailable' : 'answered',
    probabilities: map,
    unanswered: cards.flatMap(({ key }) => (map?.has(key) ? [] : [key])),
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.002 },
    model: 'served-id',
    latencyMs: 12,
    ...overrides,
  };
}

function rank(
  result: CandidateJudgement | Error,
  abortSignal?: AbortSignal,
  input = cards,
) {
  const judge: Pick<DecisionJudge, 'judgeCandidates'> = {
    judgeCandidates: vi.fn(() => {
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    }),
  };
  return rankCards({
    judge,
    model: 'catalog-id',
    tool: 'grep',
    runId: 'r',
    chatId: 'c',
    query: 'q',
    cards: input,
    rubric: 'rubric',
    ...(abortSignal !== undefined && { abortSignal }),
  });
}

describe('rankCards', () => {
  it('sorts by score descending', async () => {
    const result = await rank(judgement({ a: 0.1, b: 0.9, c: 0.5, d: 0.3 }));
    expect(result).toMatchObject({
      status: 'ranked',
      order: ['b', 'c', 'd', 'a'],
      scores: { a: 0.1, b: 0.9, c: 0.5, d: 0.3 },
      model: 'served-id',
      latencyMs: 12,
      costUsd: 0.002,
    });
  });

  it('keeps canonical position on a tie', async () => {
    const result = await rank(judgement({ a: 0.5, b: 0.8, c: 0.5, d: 0.5 }));
    expect(result.order).toEqual(['b', 'a', 'c', 'd']);
  });

  it('puts unjudged cards after judged ones in canonical order', async () => {
    const result = await rank(judgement({ b: 0.01, d: 0.02 }));
    expect(result.status).toBe('partial');
    expect(result.order).toEqual(['d', 'b', 'a', 'c']);
    expect(result.scores).toEqual({ b: 0.01, d: 0.02 });
  });

  it('is unavailable with canonical order when nothing was judged', async () => {
    const result = await rank(judgement(undefined, { model: null }));
    expect(result).toMatchObject({
      status: 'unavailable',
      order: ['a', 'b', 'c', 'd'],
      scores: {},
      model: 'catalog-id',
      costUsd: null,
    });
  });

  it('rethrows an enclosing abort instead of reporting unavailable', async () => {
    const controller = new AbortController();
    controller.abort(new Error('deadline'));
    await expect(rank(judgement({ a: 1 }), controller.signal)).rejects.toThrow(
      'deadline',
    );
  });

  it('rethrows an abort raised while the judge runs', async () => {
    const controller = new AbortController();
    const judge = {
      judgeCandidates: () => {
        controller.abort(new Error('mid-flight'));
        return Promise.reject(new Error('socket closed'));
      },
    };
    await expect(
      rankCards({
        judge,
        model: 'm',
        tool: 'grep',
        runId: 'r',
        chatId: 'c',
        query: 'q',
        cards,
        rubric: 'x',
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow('mid-flight');
  });

  it('throws on duplicate card keys, a non-permutation', async () => {
    const dup = [...cards, { key: 'a', text: 'again' }];
    await expect(rank(judgement({ a: 0.5 }), undefined, dup)).rejects.toThrow(
      'not a permutation',
    );
  });
});

describe('assertPermutation', () => {
  it('accepts a reordering', () => {
    expect(() => assertPermutation(['a', 'b'], ['b', 'a'])).not.toThrow();
  });

  it.each([
    ['missing key', ['a']],
    ['extra key', ['a', 'b', 'c']],
    ['repeated key', ['a', 'a']],
    ['foreign key', ['a', 'z']],
  ])('throws on a %s', (_name, order) => {
    expect(() => assertPermutation(['a', 'b'], order)).toThrow(
      'not a permutation',
    );
  });
});

describe('labeled ranking fixtures', () => {
  const cases = loadRankingCases();

  it('ships the four cases, each hand-labeled and within 40 cards', () => {
    expect(cases.map(({ name }) => name)).toEqual([
      'permission-evaluator',
      'retry-synthetic',
      'rls-security-definer-web',
      'tenant-db',
    ]);
    for (const { cards: fixtureCards } of cases) {
      expect(fixtureCards.length).toBeLessThanOrEqual(40);
      expect(fixtureCards.some((card) => card.relevant)).toBe(true);
      expect(new Set(fixtureCards.map((card) => card.key)).size).toBe(
        fixtureCards.length,
      );
    }
  });

  it('uses the real card formats and bounds', () => {
    for (const { tool, cards: fixtureCards } of cases) {
      for (const card of fixtureCards) {
        if (tool === 'grep') {
          expect(card.text.length).toBeLessThanOrEqual(384);
          expect(card.text.split('\n').length).toBeLessThanOrEqual(4);
        } else {
          expect(card.text.length).toBeLessThanOrEqual(400);
          expect(card.text).toMatch(/^\[\d+\] .+ — .+ — .+/);
        }
      }
    }
  });

  it('ranks the labeled card first when a judge scores relevance', async () => {
    for (const { tool, query, objective, cards: fixtureCards } of cases) {
      const judge = {
        judgeCandidates: () =>
          Promise.resolve(
            judgement(
              Object.fromEntries(
                fixtureCards.map((card) => [
                  card.key,
                  card.relevant ? 0.9 : 0.1,
                ]),
              ),
            ),
          ),
      };
      const result = await rankCards({
        judge,
        model: 'm',
        tool,
        runId: 'r',
        chatId: 'c',
        query,
        ...(objective !== undefined && { objective }),
        cards: fixtureCards,
        rubric: 'x',
      });
      const first = fixtureCards.find((card) => card.key === result.order[0]);
      expect(first?.relevant).toBe(true);
    }
  });
});
