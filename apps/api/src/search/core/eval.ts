/**
 * Corpus-agnostic relevance metrics (search/core), consumed by the opt-in eval
 * harness. Pure functions over ranked result-id lists + the expected-relevant set
 * per query — no DB, no corpus knowledge.
 */

/** Recall@K = fraction of a query's relevant items present in the top K results. */
export function recallAtK(
  rankedIds: ReadonlyArray<string>,
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
  rankedIds: ReadonlyArray<string>,
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
  rankedIds: ReadonlyArray<string>;
  relevant: ReadonlySet<string>;
}

interface MetricSummary {
  count: number;
  recallAtK: number;
  mrr: number;
  zeroResultRate: number;
}

export interface EvalSummary extends MetricSummary {
  byCategory: Record<string, MetricSummary>;
}

const mean = (xs: Array<number>) =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

interface MetricBucket {
  recall: Array<number>;
  rr: Array<number>;
  zero: Array<number>;
}

const emptyBucket = (): MetricBucket => ({ recall: [], rr: [], zero: [] });

function pushMetric(
  bucket: MetricBucket,
  recall: number,
  rr: number,
  zero: number,
): void {
  bucket.recall.push(recall);
  bucket.rr.push(rr);
  bucket.zero.push(zero);
}

const summarizeBucket = (bucket: MetricBucket): MetricSummary => ({
  count: bucket.recall.length,
  recallAtK: mean(bucket.recall),
  mrr: mean(bucket.rr),
  zeroResultRate: mean(bucket.zero),
});

/** Aggregate per-query results into overall + per-category metrics at cutoff K. */
export function summarizeEval(
  results: ReadonlyArray<EvalQueryResult>,
  k: number,
): EvalSummary {
  const overall = emptyBucket();
  const cats = new Map<string, MetricBucket>();

  for (const r of results) {
    const recall = recallAtK(r.rankedIds, r.relevant, k);
    const rr = reciprocalRank(r.rankedIds, r.relevant);
    const zero = r.rankedIds.length === 0 ? 1 : 0;
    const c = cats.get(r.category) ?? emptyBucket();
    cats.set(r.category, c);
    pushMetric(overall, recall, rr, zero);
    pushMetric(c, recall, rr, zero);
  }

  const byCategory: EvalSummary['byCategory'] = {};
  for (const [category, c] of cats) {
    byCategory[category] = summarizeBucket(c);
  }

  return { ...summarizeBucket(overall), byCategory };
}
