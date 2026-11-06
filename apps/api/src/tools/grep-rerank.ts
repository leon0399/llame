/**
 * Ranked `grep` file runs through the decision lane.
 *
 * `grep` reports files, not pages: the walk's order is the order the walk met
 * the files in, which says nothing about which file answers the caller's
 * `objective`. When the whole result does not fit inline, this module turns
 * the artifact's file runs into one card each, asks the decision model about
 * every card, and permutes whole runs — never passages — so the inline head,
 * the stored artifact text, its findings, and the remainder map read one order.
 *
 * It runs in `finishGrepCall`, after the walk: the walk's stop, counts,
 * warnings, and admissions are already settled. Exact-key protection of the
 * decision credential runs first, so cards, inline text, and artifact agree.
 */

import {
  grepFileLocator,
  oneLine,
  type GrepPassage,
} from '@workspace/native-file-tools';

import { type DecisionJudge } from '../decisions/decisions.service';
import { rankCards, type RankCardsResult } from '../ranking/rank-cards';
import {
  replaceArtifactPassages,
  type GrepArtifact,
  type GrepRerankRecord,
} from './grep-page';
import { type ToolContext } from './types';

/**
 * The one question a file run answers. A fixed string in code, never text
 * taken from a file: a file may carry its own instructions.
 */
export const GREP_RERANK_RUBRIC =
  'Is this file likely to contain what the objective (or query) is looking for: a substantive implementation or explanation, not a mere mention?';

/** One card holds the file path and up to three matching lines. */
export const GREP_RERANK_CARD_UNITS = 384;
export const GREP_RERANK_MAX_LINES = 3;

/** One run of consecutive passages of one file in the artifact text. */
export type GrepFileRun = {
  /** The card key: `p<index>` in canonical order, padded to the last width. */
  readonly key: string;
  readonly path: string;
  /** Passage indices of `artifact.results`, in artifact order. */
  readonly indices: ReadonlyArray<number>;
};

/** The outcome of one rank attempt. */
export type GrepRanking =
  | {
      readonly status: 'ranked';
      readonly runs: ReadonlyArray<GrepFileRun>;
      readonly record: GrepRerankRecord;
    }
  | { readonly status: 'unavailable' };

/** The runs of the artifact text, by its explicit run boundaries. */
export function grepFileRuns(artifact: GrepArtifact): Array<GrepFileRun> {
  const groups: Array<Array<number>> = [];
  for (const [index, block] of artifact.blocks.entries()) {
    if (block.newRun || groups.length === 0) groups.push([]);
    // `groups.at(-1)` exists: the loop appended one when it was empty.
    groups.at(-1)?.push(index);
  }
  const width = String(Math.max(groups.length - 1, 0)).length;
  return groups.map((indices, position) => ({
    key: `p${String(position).padStart(width, '0')}`,
    path: grepFileLocator(artifact.results[indices[0]]?.locator ?? ''),
    indices,
  }));
}

/** The card of one file run: its path, then up to three matching lines. */
export function grepRunCard(artifact: GrepArtifact, run: GrepFileRun): string {
  const card = [cutUnits(oneLine(run.path), GREP_RERANK_CARD_UNITS)];
  let used = card[0].length;
  for (const line of matchingLines(artifact, run).slice(
    0,
    GREP_RERANK_MAX_LINES,
  )) {
    // The newline that joins the line takes one unit of the card.
    const room = GREP_RERANK_CARD_UNITS - used - 1;
    if (room <= 0) break;
    const excerpt = cutUnits(oneLine(line), room);
    card.push(excerpt);
    used += excerpt.length + 1;
  }
  return card.join('\n');
}

/**
 * Replace the decision credential in every passage's locator and content, and
 * rebuild the artifact blocks. Run boundaries stay those of the original
 * canonical identity, never re-derived from the replaced locators.
 */
export function protectArtifact(
  artifact: GrepArtifact,
  protect: (text: string) => string,
): void {
  const opens = artifact.blocks.map((block) => block.newRun);
  const results = artifact.results.map((passage): GrepPassage => {
    const locator = protect(passage.locator);
    const content = protect(passage.content);
    return locator === passage.locator && content === passage.content
      ? passage
      : { ...passage, locator, content };
  });
  replaceArtifactPassages(artifact, results, opens);
}

/**
 * Rank the artifact's runs with the configured decision model. Returns
 * `undefined` when no model or judge is configured, in which case the walk
 * order stands without a note. Ordinary failure returns `unavailable`; an
 * abort of the enclosing call propagates so the runner reports its own
 * timeout or cancellation.
 */
export async function rankGrepRuns(
  context: ToolContext,
  artifact: GrepArtifact,
  request: GrepRankRequest,
): Promise<GrepRanking | undefined> {
  const model = context.grepBounds?.rerank?.model;
  const judge = context.decisions;
  if (model === undefined || judge === undefined) return undefined;
  const runs = grepFileRuns(artifact);
  if (runs.length === 0) return undefined;

  const ranked = await rankSafely(context, judge, {
    model,
    request,
    cards: runs.map((run) => ({
      key: run.key,
      text: grepRunCard(artifact, run),
    })),
  });
  if (ranked === undefined || ranked.status === 'unavailable')
    return { status: 'unavailable' };

  const byKey = new Map(runs.map((run) => [run.key, run]));
  const ordered = ranked.order.flatMap((key) => byKey.get(key) ?? []);
  return {
    status: 'ranked',
    runs: ordered,
    record: {
      model: ranked.model,
      order: ranked.order,
      scores: ranked.scores,
      latencyMs: ranked.latencyMs,
      costUsd: ranked.costUsd,
      runLengths: ordered.map((run) => run.indices.length),
    },
  };
}

/** What the rank is asked with: the call's patterns and optional objective. */
export type GrepRankRequest = {
  readonly patterns: ReadonlyArray<string>;
  readonly objective?: string;
};

async function rankSafely(
  context: ToolContext,
  judge: DecisionJudge,
  input: {
    readonly model: string;
    readonly request: GrepRankRequest;
    readonly cards: ReadonlyArray<{
      readonly key: string;
      readonly text: string;
    }>;
  },
): Promise<RankCardsResult | undefined> {
  try {
    return await rankCards({
      judge,
      model: input.model,
      runId: context.runId ?? '',
      chatId: context.chatId,
      tool: 'grep',
      ...(input.request.objective !== undefined && {
        objective: input.request.objective,
      }),
      query: input.request.patterns.join(' | '),
      cards: input.cards,
      cardBound: GREP_RERANK_CARD_UNITS,
      rubric: GREP_RERANK_RUBRIC,
      ...(context.abortSignal !== undefined && {
        abortSignal: context.abortSignal,
      }),
    });
  } catch (error) {
    // An enclosing timeout or cancellation belongs to the runner; any other
    // throw from a judge is a failed call, never a negative judgment.
    if (context.abortSignal?.aborted === true) throw error;
    return undefined;
  }
}

/**
 * Reorder the artifact's passages by whole run, each run contiguous and
 * opening exactly one `## <path>` line, and rebuild the blocks from explicit
 * run boundaries.
 */
export function applyGrepRanking(
  artifact: GrepArtifact,
  runs: ReadonlyArray<GrepFileRun>,
): void {
  const results = runs.flatMap((run) =>
    run.indices.map((index) => artifact.results[index]),
  );
  const opens = runs.flatMap((run) =>
    run.indices.map((_index, position) => position === 0),
  );
  replaceArtifactPassages(artifact, results, opens);
}

/** The first `units` UTF-16 code units, never splitting a surrogate pair. */
function cutUnits(text: string, units: number): string {
  if (text.length <= units) return text;
  const end = /[\uD800-\uDBFF]/u.test(text[units - 1] ?? '')
    ? units - 1
    : units;
  return text.slice(0, end);
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
