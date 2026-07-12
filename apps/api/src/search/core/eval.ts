/**
 * Corpus-agnostic relevance metrics (search/core), consumed by the opt-in eval
 * harness. Pure functions over ranked result-id lists + the expected-relevant set
 * per query — no DB, no corpus knowledge.
 */

/** Recall@K = fraction of a query's relevant items present in the top K results. */
export function recallAtK(
  rankedIds: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (relevant.size === 0) return 1;
  const top = new Set(rankedIds.slice(0, k));
  let hit = 0;
  for (const id of relevant) if (top.has(id)) hit += 1;
  return hit / relevant.size;
}

/** Reciprocal rank of the first relevant result (0 if none present). */
export function reciprocalRank(
  rankedIds: readonly string[],
  relevant: ReadonlySet<string>,
): number {
  for (let i = 0; i < rankedIds.length; i += 1) {
    if (relevant.has(rankedIds[i])) return 1 / (i + 1);
  }
  return 0;
}

export interface EvalQueryResult {
  /** Query category (exact-title, typo, paraphrase, ru, es, mixed, code, …). */
  category: string;
  rankedIds: readonly string[];
  relevant: ReadonlySet<string>;
}

export interface EvalSummary {
  count: number;
  recallAtK: number;
  mrr: number;
  zeroResultRate: number;
  byCategory: Record<
    string,
    { count: number; recallAtK: number; mrr: number; zeroResultRate: number }
  >;
}

/** Aggregate per-query results into overall + per-category metrics at cutoff K. */
export function summarizeEval(
  results: readonly EvalQueryResult[],
  k: number,
): EvalSummary {
  const mean = (xs: number[]) =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

  const overall = {
    recall: [] as number[],
    rr: [] as number[],
    zero: [] as number[],
  };
  const cats = new Map<
    string,
    { recall: number[]; rr: number[]; zero: number[] }
  >();

  for (const r of results) {
    const recall = recallAtK(r.rankedIds, r.relevant, k);
    const rr = reciprocalRank(r.rankedIds, r.relevant);
    const zero = r.rankedIds.length === 0 ? 1 : 0;
    overall.recall.push(recall);
    overall.rr.push(rr);
    overall.zero.push(zero);
    const c = cats.get(r.category) ?? { recall: [], rr: [], zero: [] };
    c.recall.push(recall);
    c.rr.push(rr);
    c.zero.push(zero);
    cats.set(r.category, c);
  }

  const byCategory: EvalSummary['byCategory'] = {};
  for (const [category, c] of cats) {
    byCategory[category] = {
      count: c.recall.length,
      recallAtK: mean(c.recall),
      mrr: mean(c.rr),
      zeroResultRate: mean(c.zero),
    };
  }

  return {
    count: results.length,
    recallAtK: mean(overall.recall),
    mrr: mean(overall.rr),
    zeroResultRate: mean(overall.zero),
    byCategory,
  };
}
