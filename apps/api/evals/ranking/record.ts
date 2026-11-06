/**
 * `pnpm --filter api ranking:record [model-id ...]` — judge every labeled case
 * in `fixtures/ranking` with live decision models from the operator config and
 * write `fixtures/ranking/answers/<case>.<model>.json`. With no argument it
 * records every `decisionModels[].id`. Needs the provider keys the config
 * names; `ranking:eval` then replays the answers offline.
 */
import { config } from 'dotenv';

import { DecisionsService } from '../../src/decisions/decisions.service';
import { loadInstanceConfig } from '../../src/instance-config/config-loader';
import {
  loadRankingCases,
  RANKING_ANSWERS_DIR,
} from '../../src/ranking/fixtures';
import { fileSink, recordAll, selectModels } from '../../src/ranking/record';

config({ path: '.env.local' });

async function main(): Promise<void> {
  const instanceConfig = { config: loadInstanceConfig() };
  const catalogue = (instanceConfig.config.decisionModels ?? []).map(
    (entry) => entry.id,
  );
  const models = selectModels(catalogue, process.argv.slice(2));
  await recordAll(
    new DecisionsService(instanceConfig),
    fileSink(RANKING_ANSWERS_DIR),
    loadRankingCases(),
    models,
  );
}

// oxlint-disable-next-line unicorn/prefer-top-level-await -- CommonJS entrypoint; tsx rejects top-level await here.
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('❌ ranking:record failed');
    console.error(error);
    process.exit(1);
  });
