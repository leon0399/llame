import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

const rankingCaseSchema = z.object({
  tool: z.enum(['grep', 'web_search']),
  query: z.string(),
  objective: z.string().optional(),
  cards: z.array(
    z.object({ key: z.string(), text: z.string(), relevant: z.boolean() }),
  ),
});

const recordedAnswerSchema = z.object({
  model: z.string(),
  status: z.enum(['ranked', 'partial', 'unavailable']),
  scores: z.record(z.string(), z.number()),
  latencyMs: z.number(),
  costUsd: z.number().nullable(),
});

/** The fixed card bound each tool passes the judge, in UTF-16 code units. */
export const CARD_BOUND = { grep: 384, web_search: 400 } as const;

export type RankingCase = z.infer<typeof rankingCaseSchema> & {
  readonly name: string;
};

/** One recorded live judgement of one case by one catalogue model. */
export type RecordedAnswer = z.infer<typeof recordedAnswerSchema>;

export const RANKING_FIXTURES_DIR = path.resolve(
  __dirname,
  '../../fixtures/ranking',
);
export const RANKING_ANSWERS_DIR = path.join(RANKING_FIXTURES_DIR, 'answers');

function readJson<T>(file: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function loadRankingCases(): Array<RankingCase> {
  return fs
    .readdirSync(RANKING_FIXTURES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({
      name: file.slice(0, -'.json'.length),
      ...readJson(path.join(RANKING_FIXTURES_DIR, file), rankingCaseSchema),
    }));
}

/** Recorded answers as `<case>.<model>.json`; the model id may contain dots. */
export function loadRecordedAnswers(
  caseName: string,
  dir: string = RANKING_ANSWERS_DIR,
  listDir: (dir: string) => ReadonlyArray<string> = (target) =>
    fs.readdirSync(target),
): Array<RecordedAnswer> {
  if (!fs.existsSync(dir)) return [];
  return listDir(dir)
    .filter((file) => file.startsWith(`${caseName}.`) && file.endsWith('.json'))
    .sort()
    .map((file) => readJson(path.join(dir, file), recordedAnswerSchema));
}
