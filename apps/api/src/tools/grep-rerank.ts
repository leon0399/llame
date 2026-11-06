/**
 * Ranked `grep` file runs through the experimental decision lane.
 *
 * `grep` reports files, not pages: the walk's order is the order the walk met
 * the files in, which says nothing about which file answers the caller's
 * `objective`. This module turns the artifact's file runs into one card each,
 * asks the decision model one relevance question per card, and permutes whole
 * runs — never passages — so every result downstream (the inline head, the
 * stored artifact text, its findings, and the remainder map) reads one order.
 *
 * It runs in `finishGrepCall`, after the walk: the walk's stop, its counts, and
 * its warnings are already settled, and every run of the walk is asked about;
 * the lane chunks the questions. A run nobody judged keeps its canonical
 * relative order after the judged ones; an unavailable call changes nothing.
 */

import {
  grepFileLocator,
  grepPassageBlockLines,
  grepPassageContinues,
  type GrepPassage,
} from '@workspace/native-file-tools';

import { decisionLogger } from '../decisions/decision-logger';
import {
  type CandidateJudgement,
  type DecisionJudge,
} from '../decisions/decisions.service';
import {
  type ToolRerankConfig,
  type ToolRerankMode,
} from '../instance-config/tool-rerank-config';
import { artifactLinePieceCount } from './artifacts/lines';
import { type GrepArtifact } from './grep-page';

/**
 * The one question a file run answers. A fixed string in code, never text
 * taken from a file: a file may carry its own instructions.
 */
export const GREP_RERANK_RUBRIC =
  'Is this file likely to contain what the objective (or query) is looking for: a substantive implementation or explanation, not a mere mention?';

/** One card holds the file path and up to three matching lines. */
export const GREP_RERANK_CARD_UNITS = 384;
export const GREP_RERANK_MAX_LINES = 3;

/** Fewer file runs than this and an order over them says nothing. */
export const GREP_RERANK_MIN_RUNS = 3;

/** One run of consecutive passages of one file in the artifact text. */
export type GrepFileRun = {
  /** The card key: `p00`, `p01`, … in canonical order. */
  readonly key: string;
  readonly path: string;
  /** Passage indices of `artifact.results`, in artifact order. */
  readonly indices: ReadonlyArray<number>;
};

/** What the tool supplies the lane: the patterns it searched and the objective. */
export type GrepRerankRequest = {
  readonly patterns: ReadonlyArray<string>;
  readonly objective?: string;
};

/**
 * The display-only record of one rerank, stored under `display.rerank`: the
 * model never sees it, and the owner's UI can compare the two orders.
 */
export type GrepRerankRecord = {
  readonly mode: ToolRerankMode;
  readonly model: string | null;
  /** The run keys in the order the lane ranked them. */
  readonly order: ReadonlyArray<string>;
  /**
   * Judged run key → relevance score as the ranking model answered it (a
   * decision model's is P(relevant)); an absent key was never judged.
   */
  readonly scores: Readonly<Record<string, number>>;
  readonly latencyMs: number;
  readonly costUsd: number | null;
  /** Runs a failed chunk left in canonical order. */
  readonly unjudged: number;
};

/** A computed rerank: what to show, and the permutation `on` applies. */
export type GrepRerankPlan = {
  readonly mode: ToolRerankMode;
  readonly record: GrepRerankRecord;
  /** Run positions of `runs`, in the order the result applies. */
  readonly order: ReadonlyArray<number>;
  readonly runs: ReadonlyArray<GrepFileRun>;
};

/** The runs of the artifact text: `newRun` marks the first passage of one. */
export function grepFileRuns(artifact: GrepArtifact): Array<GrepFileRun> {
  const runs: Array<Array<number>> = [];
  for (const [index, block] of artifact.blocks.entries()) {
    if (block.newRun || runs.length === 0) runs.push([]);
    // `runs.at(-1)` exists: the loop appended one when it was empty.
    runs.at(-1)?.push(index);
  }
  return runs.map((indices, position) => ({
    key: `p${String(position).padStart(2, '0')}`,
    path: grepFileLocator(artifact.results[indices[0]]?.locator ?? ''),
    indices,
  }));
}

/** The card of one file run: its path, then up to three matching lines. */
export function grepRunCard(artifact: GrepArtifact, run: GrepFileRun): string {
  const path = run.path.replaceAll('\n', ' ');
  const card = [path.slice(0, GREP_RERANK_CARD_UNITS)];
  let used = card[0]?.length ?? 0;
  for (const line of matchingLines(artifact, run).slice(
    0,
    GREP_RERANK_MAX_LINES,
  )) {
    const width = line.length + 1;
    if (used + width > GREP_RERANK_CARD_UNITS) break;
    card.push(line);
    used += width;
  }
  return card.join('\n');
}

/**
 * Ask the lane about every run, or return nothing when the tool has
 * no `tools.grep.rerank` block, the lane is absent, or the artifact holds too
 * few runs to rank.
 */
export async function planGrepRerank(input: {
  readonly artifact: GrepArtifact;
  readonly decisions: Partial<DecisionJudge> | undefined;
  /** The tool's own `tools.grep.rerank` block; absent means off. */
  readonly rerank: ToolRerankConfig | undefined;
  readonly runId: string | undefined;
  readonly chatId: string;
  readonly request: GrepRerankRequest;
}): Promise<GrepRerankPlan | undefined> {
  const judge = input.decisions;
  const rerank = input.rerank;
  if (rerank === undefined || judge?.judgeCandidates === undefined)
    return undefined;
  const runs = grepFileRuns(input.artifact);
  if (runs.length < GREP_RERANK_MIN_RUNS) return undefined;

  const judgement = await judgeGrepRuns(judge, { ...input, rerank }, runs);
  const probabilities = judgement.probabilities;
  // Unavailable is not a negative judgment: nothing is reordered and no order
  // is recorded, exactly as if the lane had never been asked.
  if (probabilities === undefined || probabilities.size === 0) return undefined;

  const order = permutationOf(runs, probabilities);
  const record: GrepRerankRecord = {
    mode: rerank.mode,
    model: judgement.model,
    order: order.map((position) => runs[position].key),
    scores: Object.fromEntries(probabilities),
    latencyMs: judgement.latencyMs,
    costUsd: judgement.usage.costUsd,
    unjudged: runs.length - probabilities.size,
  };
  logRerank(record, runs.length);
  return { mode: rerank.mode, record, order, runs };
}

/** One request: every candidate card under one state, one question each. */
async function judgeGrepRuns(
  judge: Partial<DecisionJudge>,
  input: {
    readonly artifact: GrepArtifact;
    readonly rerank: ToolRerankConfig;
    readonly runId: string | undefined;
    readonly chatId: string;
    readonly request: GrepRerankRequest;
  },
  candidates: ReadonlyArray<GrepFileRun>,
): Promise<CandidateJudgement> {
  if (judge.judgeCandidates === undefined) {
    // The caller proved it exists; a double that omits it answers for nothing.
    return {
      status: 'unavailable',
      probabilities: undefined,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
      model: null,
      latencyMs: 0,
    };
  }
  return await judge.judgeCandidates({
    model: input.rerank.model,
    ...(input.runId !== undefined && { runId: input.runId }),
    chatId: input.chatId,
    tool: 'grep',
    ...(input.request.objective !== undefined && {
      objective: input.request.objective,
    }),
    query: input.request.patterns.join(' | '),
    cards: candidates.map((run) => ({
      key: run.key,
      text: grepRunCard(input.artifact, run),
    })),
    rubric: GREP_RERANK_RUBRIC,
  });
}

/**
 * Reorder the artifact's passages by run, keeping every run contiguous, and
 * recompute the blocks from scratch: the heading moves with the run's first
 * passage, so one run still opens exactly one `## <path>` line.
 */
export function applyGrepRerank(
  artifact: GrepArtifact,
  runs: ReadonlyArray<GrepFileRun>,
  order: ReadonlyArray<number>,
): void {
  const results = order.flatMap((position) =>
    runs[position].indices.map((index) => artifact.results[index]),
  );
  const blocks = blocksOf(results);
  artifact.results.splice(0, artifact.results.length, ...results);
  artifact.blocks.splice(0, artifact.blocks.length, ...blocks);
  // A run keeps the same heading it already held, so the sum is unchanged;
  // setting it keeps the artifact's byte count true for a future bound check.
  artifact.lineBytes = blocks.reduce((total, block) => total + block.bytes, 0);
}

/**
 * The run permutation: judged runs by probability, strongest first, then the
 * unjudged ones in canonical order. A stable tie keeps canonical order.
 */
function permutationOf(
  runs: ReadonlyArray<GrepFileRun>,
  probabilities: ReadonlyMap<string, number>,
): Array<number> {
  const positions = runs.map((_run, position) => position);
  const judged = positions.filter((position) =>
    probabilities.has(runs[position].key),
  );
  judged.sort(
    (left, right) =>
      (probabilities.get(runs[right].key) ?? 0) -
        (probabilities.get(runs[left].key) ?? 0) || left - right,
  );
  const unjudged = positions.filter(
    (position) => !probabilities.has(runs[position].key),
  );
  return [...judged, ...unjudged];
}

/** The blocks of a reordered result list, by the same render the walk used. */
function blocksOf(
  results: ReadonlyArray<GrepPassage>,
): Array<{ bytes: number; pieces: number; newRun: boolean }> {
  const blocks: Array<{ bytes: number; pieces: number; newRun: boolean }> = [];
  let previous: GrepPassage | undefined;
  for (const passage of results) {
    const lines = grepPassageBlockLines(previous, passage, false);
    blocks.push({
      bytes: lines.reduce(
        (total, line) => total + Buffer.byteLength(line, 'utf8') + 1,
        0,
      ),
      pieces: lines.reduce(
        (total, line) => total + artifactLinePieceCount(line),
        0,
      ),
      newRun: !grepPassageContinues(previous, passage),
    });
    previous = passage;
  }
  return blocks;
}

/** Every match line of one run, whole and in line order, each counted once. */
function matchingLines(
  artifact: GrepArtifact,
  run: GrepFileRun,
): Array<string> {
  const seen = new Set<number>();
  const lines: Array<string> = [];
  for (const index of run.indices) {
    const passage = artifact.results[index];
    const matched = new Set(passage.matches);
    for (const content of passage.content.split('\n')) {
      const numbered = /^(\d+): /u.exec(content);
      if (numbered === null) continue;
      const line = Number(numbered[1]);
      if (!matched.has(line) || seen.has(line)) continue;
      seen.add(line);
      lines.push(content);
    }
  }
  return lines;
}

/** One structured line beside the lane's own `decision.completed`. */
function logRerank(record: GrepRerankRecord, runs: number): void {
  try {
    decisionLogger.info({
      event: 'decision.rerank',
      tool: 'grep',
      mode: record.mode,
      model: record.model,
      runs,
      judged: Object.keys(record.scores).length,
      order: record.order,
      latencyMs: record.latencyMs,
      costUsd: record.costUsd,
    });
  } catch {
    // A logging failure never fails the tool call that asked.
  }
}
