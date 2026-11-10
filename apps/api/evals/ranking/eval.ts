/**
 * `pnpm --filter api ranking:eval` — nDCG@5, MRR, latency, and cost of the
 * canonical order and of each recorded decision-model answer for every labeled
 * case in `fixtures/ranking`. Offline: it reads `fixtures/ranking/answers`
 * and never calls a model. Without recorded answers it prints the canonical
 * baseline only.
 */
import { evaluateCase } from '../../src/ranking/eval-report';
import {
  loadRankingCases,
  loadRecordedAnswers,
} from '../../src/ranking/fixtures';

const rows = loadRankingCases().flatMap((rankingCase) =>
  evaluateCase(rankingCase, loadRecordedAnswers(rankingCase.name)),
);

console.table(rows);
