import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EVAL_QUERIES } from './dataset';

/**
 * `BASELINE.md` is hand-maintained prose (§ Overall / § By category tables)
 * generated from a run of `search-eval.integration.test.ts` and never
 * re-verified against `dataset.ts` afterwards. This has already drifted once:
 * the checked-in baseline previously recorded 16 queries and omitted an
 * entire floor category while `dataset.ts` had grown to 18 queries across 9
 * categories.
 *
 * This guard asserts COUNTS ONLY — the overall query total and each
 * category's `n` — never scores. Scores legitimately require a live-DB eval
 * run (`RUN_SEARCH_EVAL=1 pnpm exec vitest run --project integration
 * search-eval.integration.test.ts`) and change whenever retrieval changes;
 * counts are pure data derived from `dataset.ts` and must never drift.
 */

const BASELINE_MD = readFileSync(join(__dirname, 'BASELINE.md'), 'utf8');

function extractSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start === -1) {
    throw new Error(`BASELINE.md is missing the "${heading}" section`);
  }
  const nextHeading = markdown.indexOf('\n## ', start + heading.length);
  return markdown.slice(start, nextHeading === -1 ? undefined : nextHeading);
}

const overallSection = extractSection(BASELINE_MD, '## Overall');
const overallQueriesMatch = /\|\s*queries\s*\|\s*(\d+)\s*\|/.exec(
  overallSection,
);
if (!overallQueriesMatch) {
  throw new Error(
    'BASELINE.md: could not find a "queries" row in the Overall table',
  );
}
const recordedOverallQueries = Number(overallQueriesMatch[1]);

const byCategorySection = extractSection(BASELINE_MD, '## By category');
const recordedCategoryCounts = new Map<string, number>();
for (const match of byCategorySection.matchAll(
  /^\|\s*([a-z][a-z-]*)\s*\|\s*(\d+)\s*\|/gm,
)) {
  const [, category, n] = match;
  if (category === undefined || n === undefined || category === 'category') {
    continue;
  }
  recordedCategoryCounts.set(category, Number(n));
}
if (recordedCategoryCounts.size === 0) {
  throw new Error(
    'BASELINE.md: could not parse any rows from the By category table',
  );
}

const actualCategoryCounts = new Map<string, number>();
for (const q of EVAL_QUERIES) {
  actualCategoryCounts.set(
    q.category,
    (actualCategoryCounts.get(q.category) ?? 0) + 1,
  );
}

describe('BASELINE.md matches dataset.ts (counts only, not scores)', () => {
  it('records the same overall query count as EVAL_QUERIES', () => {
    // A mismatch prints as a single "violation" line naming both numbers, so
    // whoever broke it knows to re-run RUN_SEARCH_EVAL=1 and update the
    // "queries" row in BASELINE.md.
    const violations =
      recordedOverallQueries === EVAL_QUERIES.length
        ? []
        : [
            `queries: BASELINE.md says ${recordedOverallQueries}, ` +
              `dataset.ts has ${EVAL_QUERIES.length}`,
          ];
    expect(violations).toEqual([]);
  });

  it('has a By-category row for every category in EVAL_QUERIES, and vice versa', () => {
    const recorded = new Set(recordedCategoryCounts.keys());
    const actual = new Set(actualCategoryCounts.keys());
    const violations = [
      ...[...recorded]
        .filter((c) => !actual.has(c))
        .map((c) => `${c}: in BASELINE.md but not in dataset.ts`),
      ...[...actual]
        .filter((c) => !recorded.has(c))
        .map((c) => `${c}: in dataset.ts but not in BASELINE.md`),
    ];
    expect(violations).toEqual([]);
  });

  it('records the same per-category query count as EVAL_QUERIES', () => {
    const violations: Array<string> = [];
    for (const [category, actualN] of actualCategoryCounts) {
      const recordedN = recordedCategoryCounts.get(category);
      if (recordedN !== actualN) {
        violations.push(
          `${category}: BASELINE.md says n=${recordedN ?? '(missing)'}, ` +
            `dataset.ts has ${actualN}`,
        );
      }
    }
    // Re-run RUN_SEARCH_EVAL=1 and update BASELINE.md's By category table if
    // this fails.
    expect(violations).toEqual([]);
  });
});
