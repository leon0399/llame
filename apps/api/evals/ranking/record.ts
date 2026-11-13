/**
 * `pnpm --filter api ranking:record [--reversed] [model-id ...]` — judge every
 * labeled case in `fixtures/ranking` with live rank models from the operator
 * config and write `fixtures/ranking/answers/<case>.<model>.json`. With no
 * model it records every `decisionModels[].id` and `rerankModels[].id`.
 * `--reversed` also records each case with its cards in reverse order as
 * `<case>.<model>~reversed.json`. Needs the provider keys the config names;
 * `ranking:eval` then replays the answers offline.
 */
import { config } from 'dotenv';

import { DecisionsService } from '../../src/decisions/decisions.service';
import { loadInstanceConfig } from '../../src/instance-config/config-loader';
import {
  loadRankingCases,
  RANKING_ANSWERS_DIR,
} from '../../src/ranking/fixtures';
import {
  fileSink,
  recordAll,
  reversedVariant,
  selectModels,
} from '../../src/ranking/record';

config({ path: '.env.local' });

async function main(): Promise<void> {
  const instanceConfig = { config: loadInstanceConfig() };

  const catalogue = [
    ...(instanceConfig.config.decisionModels ?? []),
    ...(instanceConfig.config.rerankModels ?? []),
  ].map((entry) => entry.id);

  const args = process.argv.slice(2);
  const reversed = args.includes('--reversed');

  const models = selectModels(
    catalogue,
    args.filter((arg) => arg !== '--reversed'),
  );

  const judge = new DecisionsService(instanceConfig);
  const sink = fileSink(RANKING_ANSWERS_DIR);
  const cases = loadRankingCases();
  await recordAll(judge, sink, cases, models);

  if (reversed) {
    const variant = reversedVariant(cases, sink);
    await recordAll(judge, variant.sink, variant.cases, models);
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
