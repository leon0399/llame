import fs from 'node:fs';
import path from 'node:path';

import { type DecisionJudge } from '../decisions/decisions.service';
import { CARD_BOUND, type RankingCase, type RecordedAnswer } from './fixtures';
import { rankCards } from './rank-cards';
import { GREP_RERANK_RUBRIC, WEB_SEARCH_RERANK_RUBRIC } from './rubrics';

const RUBRICS = {
  grep: GREP_RERANK_RUBRIC,
  web_search: WEB_SEARCH_RERANK_RUBRIC,
} as const;

export type RecordSink = {
  write(caseName: string, model: string, answer: RecordedAnswer): void;
  log(line: string): void;
};

/** Models to record: the requested ids, or the whole catalogue when none. */
export function selectModels(
  catalogue: ReadonlyArray<string>,
  requested: ReadonlyArray<string>,
): Array<string> {
  const unknown = requested.filter((id) => !catalogue.includes(id));

  if (unknown.length > 0) {
    throw new Error(
      `Not in decisionModels[] or rerankModels[]: ${unknown.join(', ')}. Catalogue: ${catalogue.join(', ') || '(empty)'}.`,
    );
  }

  const models = requested.length > 0 ? [...requested] : [...catalogue];

  if (models.length === 0) {
    throw new Error(
      'No decisionModels[] or rerankModels[] in the operator config to record.',
    );
  }

  return models;
}

/** Judges one case with one model; false when the judgement was unavailable. */
export async function recordCase(
  judge: Pick<DecisionJudge, 'judgeCandidates'>,
  sink: RecordSink,
  rankingCase: RankingCase,
  model: string,
): Promise<boolean> {
  const result = await rankCards({
    judge,
    model,
    tool: rankingCase.tool,
    runId: 'ranking-record',
    chatId: 'ranking-record',
    query: rankingCase.query,
    cards: rankingCase.cards,
    cardBound: CARD_BOUND[rankingCase.tool],
    rubric: RUBRICS[rankingCase.tool],
    ...(rankingCase.objective !== undefined && {
      objective: rankingCase.objective,
    }),
  });

  sink.log(`${rankingCase.name} ${model}: ${result.status}`);

  if (result.status === 'unavailable') return false;
  sink.write(rankingCase.name, model, {
    model,
    status: result.status,
    scores: result.scores,
    latencyMs: result.latencyMs,
    costUsd: result.costUsd,
  });

  return true;
}

/** Records every case with every model; throws when any judgement was unavailable. */
export async function recordAll(
  judge: Pick<DecisionJudge, 'judgeCandidates'>,
  sink: RecordSink,
  cases: ReadonlyArray<RankingCase>,
  models: ReadonlyArray<string>,
): Promise<void> {
  let unavailable = 0;

  for (const rankingCase of cases) {
    for (const model of models) {
      if (!(await recordCase(judge, sink, rankingCase, model)))
        unavailable += 1;
    }
  }

  if (unavailable > 0) {
    throw new Error(`${unavailable} judgement(s) unavailable and not written.`);
  }
}

/** The label suffix of an answer recorded with the cards in reverse order. */
const REVERSED_SUFFIX = '~reversed';

/**
 * The same cases with their cards in reverse order, and a sink that records
 * each answer as `<model>~reversed`. Comparing the two answers of a case
 * measures how much card position moves the model's scores.
 */
export function reversedVariant(
  cases: ReadonlyArray<RankingCase>,
  sink: RecordSink,
) {
  const label = (model: string) => `${model}${REVERSED_SUFFIX}`;

  return {
    cases: cases.map((rankingCase) => ({
      ...rankingCase,
      cards: [...rankingCase.cards].reverse(),
    })),
    sink: {
      write: (caseName: string, model: string, answer: RecordedAnswer) =>
        sink.write(caseName, label(model), { ...answer, model: label(model) }),
      log: (line: string) => sink.log(`${line} (reversed)`),
    } satisfies RecordSink,
  };
}

/** A sink that writes `<case>.<model>.json` under `dir` and logs to stdout. */
export function fileSink(dir: string): RecordSink {
  fs.mkdirSync(dir, { recursive: true });

  return {
    write(caseName, model, answer) {
      fs.writeFileSync(
        path.join(dir, `${caseName}.${model}.json`),
        `${JSON.stringify(answer, null, 2)}\n`,
      );
    },
    log(line) {
      process.stdout.write(`${line}\n`);
    },
  };
}
