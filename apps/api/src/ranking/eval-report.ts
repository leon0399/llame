import { ndcgAtK, reciprocalRank } from './metrics';
import { orderByScores } from './rank-cards';
import { type RankingCase, type RecordedAnswer } from './fixtures';

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

export function formatTable(rows: ReadonlyArray<EvalRow>): string {
  const header = ['case', 'ranker', 'nDCG@5', 'MRR', 'latency ms', 'cost USD'];
  const body = rows.map((r) => [
    r.caseName,
    r.ranker,
    r.ndcg5.toFixed(3),
    r.mrr.toFixed(3),
    r.latencyMs === null ? '-' : String(Math.round(r.latencyMs)),
    r.costUsd === null ? '-' : r.costUsd.toFixed(5),
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...body.map((cells) => cells[column]?.length ?? 0)),
  );
  const line = (cells: ReadonlyArray<string>) =>
    cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ');
  return [line(header), ...body.map(line)].join('\n');
}
