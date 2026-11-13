/**
 * Ranked `grep` file runs through the decision lane.
 *
 * `grep` reports files, not pages: the walk's order is the order the walk met
 * the files in, which says nothing about which file answers the caller's
 * `objective`. When the whole result does not fit inline, this module turns
 * the artifact's file runs into one card each, sends every card to the rank
 * call (a decision model judges the first 256), and permutes whole runs — never
 * passages — so the inline head,
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
import { codePointSafeCutIndex } from '@workspace/runtime-safety';

import { type DecisionJudge } from '../decisions/decisions.service';
import { rankCards, type RankCardsResult } from '../ranking/rank-cards';
import { GREP_RERANK_RUBRIC } from '../ranking/rubrics';
import {
  artifactRunLengths,
  replaceArtifactPassages,
  type GrepArtifact,
  type PageState,
} from './grep-page';
import { type ToolContext } from './types';

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

/** The runs of the artifact text, by its explicit run boundaries. */
export function grepFileRuns(artifact: GrepArtifact): Array<GrepFileRun> {
  const lengths = artifactRunLengths(artifact);
  const width = String(Math.max(lengths.length - 1, 0)).length;
  let start = 0;

  return lengths.map((length, position) => {
    const indices = Array.from({ length }, (_, offset) => start + offset);
    start += length;

    return {
      key: `p${String(position).padStart(width, '0')}`,
      path: grepFileLocator(artifact.results[indices[0]]?.locator ?? ''),
      indices,
    };
  });
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

  const results = artifact.results.map((passage): GrepPassage => ({
    ...passage,
    locator: protect(passage.locator),
    content: protect(passage.content),
  }));

  replaceArtifactPassages(artifact, results, opens);
}

/**
 * Rank the artifact's runs with the configured decision model, reorder the
 * artifact by whole run, and record the outcome on the call's state. Nothing
 * changes when no model or judge is configured: the walk order stands without
 * a note. Ordinary failure sets `state.ranking`; an abort of the enclosing call
 * propagates so the runner reports its own timeout or cancellation.
 */
export async function rankGrepRuns(
  context: ToolContext,
  state: PageState,
  request: GrepRankRequest,
): Promise<void> {
  const model = context.grepBounds?.rerank?.model;
  const judge = context.decisions;

  if (model === undefined || judge === undefined) return;
  const { artifact } = state;
  const runs = grepFileRuns(artifact);

  if (runs.length === 0) return;

  const ranked = await rankSafely(context, judge, {
    model,
    request,
    cards: runs.map((run) => ({
      key: run.key,
      text: grepRunCard(artifact, run),
    })),
  });

  if (ranked === undefined || ranked.status === 'unavailable') {
    state.ranking = 'unavailable';

    return;
  }

  applyRank(state, runs, ranked);
}

/** Reorder the artifact by whole run and record the ranked outcome. */
function applyRank(
  state: PageState,
  runs: ReadonlyArray<GrepFileRun>,
  ranked: RankCardsResult,
): void {
  const { artifact } = state;
  const byKey = new Map(runs.map((run) => [run.key, run]));
  const ordered = ranked.order.flatMap((key) => byKey.get(key) ?? []);
  // Each run stays contiguous and opens exactly one `## <path>` line.
  replaceArtifactPassages(
    artifact,
    ordered.flatMap((run) =>
      run.indices.map((index) => artifact.results[index]),
    ),
    ordered.flatMap((run) => run.indices.map((_index, place) => place === 0)),
  );
  state.rerank = {
    model: ranked.model,
    order: ranked.order,
    scores: ranked.scores,
    latencyMs: ranked.latencyMs,
    costUsd: ranked.costUsd,
    runLengths: ordered.map((run) => run.indices.length),
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

/** The first `units` UTF-16 code units, never splitting a surrogate pair. */
function cutUnits(text: string, units: number): string {
  return text.slice(0, codePointSafeCutIndex(text, units));
}
