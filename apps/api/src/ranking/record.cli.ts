/**
 * `pnpm --filter api ranking:record [model-id ...]` — judge every labeled case
 * in `fixtures/ranking` with live decision models from the operator config and
 * write `fixtures/ranking/answers/<case>.<model>.json`. With no argument it
 * records every `decisionModels[].id`. Needs the provider keys the config
 * names; `ranking:eval` then replays the answers offline.
 */
import fs from 'node:fs';
import path from 'node:path';

import { config } from 'dotenv';

import { DecisionsService } from '../decisions/decisions.service';
import { loadInstanceConfig } from '../instance-config/config-loader';
import {
  loadRankingCases,
  RANKING_ANSWERS_DIR,
  type RankingCase,
  type RecordedAnswer,
} from './fixtures';
import { rankCards } from './rank-cards';

config({ path: '.env.local' });

const RUBRICS = {
  grep: 'Is this file likely to contain what the objective (or query) is looking for: a substantive implementation or explanation, not a mere mention?',
  web_search:
    'Does this card help answer the objective (or, without one, the query)?',
} as const;

async function recordCase(
  judge: DecisionsService,
  rankingCase: RankingCase,
  model: string,
): Promise<void> {
  const result = await rankCards({
    judge,
    model,
    tool: rankingCase.tool,
    runId: 'ranking-record',
    chatId: 'ranking-record',
    query: rankingCase.query,
    cards: rankingCase.cards,
    rubric: RUBRICS[rankingCase.tool],
    ...(rankingCase.objective !== undefined && {
      objective: rankingCase.objective,
    }),
  });
  const answer: RecordedAnswer = {
    model,
    status: result.status,
    scores: result.scores,
    latencyMs: result.latencyMs,
    costUsd: result.costUsd,
  };
  fs.writeFileSync(
    path.join(RANKING_ANSWERS_DIR, `${rankingCase.name}.${model}.json`),
    `${JSON.stringify(answer, null, 2)}\n`,
  );
  process.stdout.write(`${rankingCase.name} ${model}: ${result.status}\n`);
}

async function main(): Promise<void> {
  const instanceConfig = { config: loadInstanceConfig() };
  const catalogue = (instanceConfig.config.decisionModels ?? []).map(
    (entry) => entry.id,
  );
  const requested = process.argv.slice(2);
  const models = requested.length > 0 ? requested : catalogue;
  if (models.length === 0) {
    throw new Error('No decisionModels[] in the operator config to record.');
  }
  const judge = new DecisionsService(instanceConfig);
  fs.mkdirSync(RANKING_ANSWERS_DIR, { recursive: true });
  for (const rankingCase of loadRankingCases()) {
    for (const model of models) await recordCase(judge, rankingCase, model);
  }
}

// oxlint-disable-next-line unicorn/prefer-top-level-await -- CommonJS entrypoint; tsx rejects top-level await here.
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('❌ ranking:record failed');
    console.error(error);
    process.exit(1);
  });
