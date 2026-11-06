import { ndcgAtK, reciprocalRank } from '../search/core/eval';
import { type RankingCase, type RecordedAnswer } from './fixtures';
import { orderByScores } from './rank-cards';

export type EvalRow = {
  readonly caseName: string;
  /** `canonical` or a catalogue model id. */
  readonly ranker: string;
  readonly ndcg5: number;
  readonly mrr: number;
  readonly latencyMs: number | null;
  readonly costUsd: number | null;
};

function row(
  rankingCase: RankingCase,
  ranker: string,
  order: ReadonlyArray<string>,
  usage: { latencyMs: number | null; costUsd: number | null },
): EvalRow {
  const relevant = new Set(
    rankingCase.cards.filter((card) => card.relevant).map((card) => card.key),
  );
  return {
    caseName: rankingCase.name,
    ranker,
    ndcg5: ndcgAtK(order, relevant, 5),
    mrr: reciprocalRank(order, relevant),
    ...usage,
  };
}

/** The canonical-order baseline row, then one row per recorded answer. */
export function evaluateCase(
  rankingCase: RankingCase,
  answers: ReadonlyArray<RecordedAnswer>,
): Array<EvalRow> {
  const keys = rankingCase.cards.map((card) => card.key);
  return [
    row(rankingCase, 'canonical', keys, { latencyMs: null, costUsd: null }),
    ...answers.map((answer) =>
      row(
        rankingCase,
        answer.model,
        orderByScores(keys, new Map(Object.entries(answer.scores))),
        { latencyMs: answer.latencyMs, costUsd: answer.costUsd },
      ),
    ),
  ];
}
