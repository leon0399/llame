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

/**
 * nDCG@K: normalized discounted cumulative gain at cutoff K. Measures ranking
 * quality — not just recall (did you find it?) but position (did you rank it
 * highly?). Uses binary relevance (relevant = 1, else = 0).
 */
export function ndcgAtK(
  rankedIds: ReadonlyArray<string>,
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (relevant.size === 0) return 1;
  const idealDcg = Array.from(
    { length: Math.min(relevant.size, k) },
    (_, i) => 1 / Math.log2(i + 2),
  ).reduce((a, b) => a + b, 0);
  if (idealDcg === 0) return 0;
  let dcg = 0;
  const top = rankedIds.slice(0, k);
  for (let i = 0; i < top.length; i += 1) {
    const id = top[i];
    if (id !== undefined && relevant.has(id)) dcg += 1 / Math.log2(i + 2);
  }
  return dcg / idealDcg;
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
  ndcgAtK: number;
  zeroResultRate: number;
}

export interface EvalSummary extends MetricSummary {
  byCategory: Record<string, MetricSummary>;
}

const mean = (xs: Array<number>) =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

interface MetricRow {
  recall: number;
  rr: number;
  ndcg: number;
  zero: number;
}

type MetricBucket = Array<MetricRow>;

const emptyBucket = (): MetricBucket => [];

const summarizeBucket = (bucket: MetricBucket): MetricSummary => ({
  count: bucket.length,
  recallAtK: mean(bucket.map((r) => r.recall)),
  mrr: mean(bucket.map((r) => r.rr)),
  ndcgAtK: mean(bucket.map((r) => r.ndcg)),
  zeroResultRate: mean(bucket.map((r) => r.zero)),
});

/** Aggregate per-query results into overall + per-category metrics at cutoff K. */
export function summarizeEval(
  results: ReadonlyArray<EvalQueryResult>,
  k: number,
): EvalSummary {
  const overall = emptyBucket();
  const cats = new Map<string, MetricBucket>();

  for (const r of results) {
    const row: MetricRow = {
      recall: recallAtK(r.rankedIds, r.relevant, k),
      rr: reciprocalRank(r.rankedIds, r.relevant),
      ndcg: ndcgAtK(r.rankedIds, r.relevant, k),
      zero: r.rankedIds.length === 0 ? 1 : 0,
    };
    const c = cats.get(r.category) ?? emptyBucket();
    cats.set(r.category, c);
    overall.push(row);
    c.push(row);
  }

  const byCategory: EvalSummary['byCategory'] = {};
  for (const [category, c] of cats) {
    byCategory[category] = summarizeBucket(c);
  }

  return { ...summarizeBucket(overall), byCategory };
}
