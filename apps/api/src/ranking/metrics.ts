/** Binary-relevance nDCG@k of `order` against the relevant key set. */
export function ndcgAtK(
  order: ReadonlyArray<string>,
  relevant: ReadonlySet<string>,
  k: number,
): number {
  let dcg = 0;
  order.slice(0, k).forEach((key, index) => {
    if (relevant.has(key)) dcg += 1 / Math.log2(index + 2);
  });
  let ideal = 0;
  for (let index = 0; index < Math.min(k, relevant.size); index += 1) {
    ideal += 1 / Math.log2(index + 2);
  }
  return ideal === 0 ? 0 : dcg / ideal;
}

/** Reciprocal rank of the first relevant key; 0 when none is ranked. */
export function reciprocalRank(
  order: ReadonlyArray<string>,
  relevant: ReadonlySet<string>,
): number {
  const index = order.findIndex((key) => relevant.has(key));
  return index < 0 ? 0 : 1 / (index + 1);
}
