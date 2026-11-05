/**
 * `web_search` objective rerank (experimental decision lane). After the chain
 * has produced one merged result list and before any cap or artifact is built,
 * every result becomes one card — `[k] title — host — snippet` — and one fixed
 * yes/no question per card asks whether it helps answer the objective (or, with
 * no objective, the query). The answers are absolute probabilities, so the
 * order is a stable sort by probability, with the probability descending.
 *
 * Only `kind: 'results'` is ranked: an engine's grounded answer is one text,
 * not a candidate set. A result whose URL is not a canonical locator never
 * reaches the output, so it is not judged either; it stays unjudged and the
 * unjudged rule appends it after the judged cards. A call with fewer than three
 * rankable results, no lane, or no `webSearch.rerank` block sends nothing and
 * changes nothing.
 *
 * A failure is never a negative judgment: a card the judge did not answer stays
 * unjudged, keeps its canonical relative order, and follows the judged cards, so
 * a failed chunk degrades to the canonical tail instead of a "0".
 *
 * The two modes differ in one place only. `shadow` records the order it would
 * have applied and returns the canonical one; `on` returns the ranked source,
 * which every downstream step (the inline fit, the stored artifact text, the
 * findings and the continuation line) reads, so they agree by construction.
 * Either way the result carries `rerank: { mode, model, order, probabilities,
 * latencyMs, costUsd }` beside its closed output shape, which the model-facing
 * renderer strips: a reorder never changes counts, and the record is for the
 * owner's UI and for a later comparison, not for the model.
 */

import pino from 'pino';

import { oneLine } from '@workspace/native-file-tools';
import { cutStringAtCodePointBoundary } from '@workspace/runtime-safety';

import {
  type CandidateJudgement,
  type DecisionJudge,
  type JudgeCandidatesInput,
} from '../../decisions/decisions.service';
import { type ToolRerankConfig } from '../../instance-config/tool-rerank-config';
import { type ToolContext } from '../types';
import { type RawResult, type SearchChainSuccess } from './chain';
import { canonicalUrl } from './output';

/**
 * The one fixed question every card gets. Code, never card text: a result can
 * carry prompt-injection instructions, and the state is marked untrusted by the
 * decision service itself.
 */
export const WEB_SEARCH_RERANK_RUBRIC =
  'Does this card help answer the objective (or, without one, the query)?';

/** Below this many rankable results a reorder cannot say anything useful. */
export const WEB_SEARCH_RERANK_MIN_RESULTS = 3;

/** One card stays under this, so a state of 20 cards fits one request. */
export const WEB_SEARCH_RERANK_CARD_MAX_CODE_UNITS = 400;

/** What a ranked call records beside its closed output shape. */
export type WebSearchRerankRecord = {
  readonly mode: 'shadow' | 'on';
  readonly model: string | null;
  /** Every judged result key, in the order the mode applies or would apply. */
  readonly order: ReadonlyArray<string>;
  /** Judged key → P(helps answer), exactly as the judge answered. */
  readonly probabilities: Readonly<Record<string, number>>;
  readonly latencyMs: number;
  readonly costUsd: number | null;
};

export type WebSearchRerank = {
  /** The source the caller must normalize: ranked in `on`, canonical in `shadow`. */
  readonly source: SearchChainSuccess;
  readonly record: WebSearchRerankRecord;
};

/** One rankable result: its card key, its index in the source list, its text. */
type RerankCard = {
  readonly key: string;
  readonly index: number;
  readonly text: string;
};

const logger = pino({
  name: 'web-search-rerank',
  enabled: process.env.NODE_ENV !== 'test',
});

const TOOL = 'web_search';

/**
 * Judge the call's results and return the order to use, or `undefined` when the
 * call is skipped or nothing could be judged — in which case the caller keeps
 * `source` exactly as it is. Never throws.
 */
export async function rerankWebSearchResults(
  context: ToolContext,
  source: SearchChainSuccess,
  objective: string | undefined,
): Promise<WebSearchRerank | undefined> {
  const plan = planRerank(context, source);
  if (plan === undefined) return undefined;

  const judgement = await judgeSafely(
    plan.judge,
    judgeInput(context, plan, objective),
  );
  // An empty answer map is an `unavailable` judgement, not an empty ranking: a
  // call that judged nothing must not record an order it did not have.
  if (judgement === undefined || judgement.status !== 'answered')
    return undefined;
  const probabilities = judgement.probabilities;
  return probabilities === undefined
    ? undefined
    : rankedRerank(context, plan, judgement, probabilities);
}

/** The ranked source, its record, and the one line the ranking logs. */
function rankedRerank(
  context: ToolContext,
  plan: RerankPlan,
  judgement: CandidateJudgement,
  probabilities: ReadonlyMap<string, number>,
): WebSearchRerank {
  const ranked = rankCards(plan.cards, probabilities);
  const record: WebSearchRerankRecord = {
    mode: plan.rerank.mode,
    model: judgement.model,
    order: ranked.map((card) => card.key),
    probabilities: Object.fromEntries(probabilities),
    latencyMs: judgement.latencyMs,
    costUsd: judgement.usage.costUsd,
  };
  logRanking(context, {
    mode: plan.rerank.mode,
    model: judgement.model,
    cards: plan.cards.length,
    judged: probabilities.size,
    latencyMs: judgement.latencyMs,
    costUsd: judgement.usage.costUsd,
    order: record.order,
  });
  return {
    source:
      plan.rerank.mode === 'on'
        ? reorderResults(plan.source, ranked)
        : plan.source,
    record,
  };
}

/**
 * What a call ranks, or `undefined` when the tool's own setting, the lane, or
 * the count says no. The mode and the catalogue id both come from
 * `webSearch.rerank`: the tool, not the lane, decides whether it reranks.
 */
type RerankPlan = {
  readonly judge: Partial<DecisionJudge>;
  readonly rerank: ToolRerankConfig;
  readonly source: Extract<SearchChainSuccess, { kind: 'results' }>;
  readonly cards: ReadonlyArray<RerankCard>;
};

function planRerank(
  context: ToolContext,
  source: SearchChainSuccess,
): RerankPlan | undefined {
  const judge = context.decisions;
  const rerank = context.webSearch?.rerank;
  if (judge === undefined || rerank === undefined) return undefined;
  if (source.kind !== 'results') return undefined;
  const cards = rankableCards(source.results);
  if (cards.length < WEB_SEARCH_RERANK_MIN_RESULTS) return undefined;
  return { judge, rerank, source, cards };
}

/** The one request: the call's goal and query over one card per result. */
function judgeInput(
  context: ToolContext,
  plan: RerankPlan,
  objective: string | undefined,
): JudgeCandidatesInput {
  return {
    model: plan.rerank.model,
    ...(context.runId !== undefined && { runId: context.runId }),
    chatId: context.chatId,
    tool: TOOL,
    ...(objective !== undefined && { objective }),
    query: plan.source.query,
    cards: plan.cards.map(({ key, text }) => ({ key, text })),
    rubric: WEB_SEARCH_RERANK_RUBRIC,
  };
}

async function judgeSafely(
  judge: Partial<DecisionJudge>,
  input: JudgeCandidatesInput,
): Promise<CandidateJudgement | undefined> {
  if (judge.judgeCandidates === undefined) return undefined;
  try {
    return await judge.judgeCandidates(input);
  } catch {
    // A judge double, or a future client, that throws leaves the canonical
    // order in place: a failed call is not a negative judgment.
    return undefined;
  }
}

/**
 * The results a reorder can move: those whose URL is a canonical locator the
 * output keeps. The key is the result's 1-based rank, so a key names the card
 * and no card text is ever a key.
 */
function rankableCards(
  results: ReadonlyArray<RawResult>,
): ReadonlyArray<RerankCard> {
  const cards: Array<RerankCard> = [];
  for (const [index, result] of results.entries()) {
    const url = canonicalUrl(result.url);
    if (url === undefined) continue;
    cards.push({
      key: `p${String(index + 1).padStart(2, '0')}`,
      index,
      text: cardText(index + 1, result, url),
    });
  }
  return cards;
}

/** `[k] title — host — snippet`, each part on one line and the whole bounded. */
function cardText(rank: number, result: RawResult, url: string): string {
  const title = oneLine(result.title).trim() || oneLine(url);
  const parts = [
    `[${rank}] ${title}`,
    URL.parse(url)?.host,
    result.snippet === undefined ? undefined : oneLine(result.snippet),
  ].filter((part): part is string => part !== undefined && part !== '');
  return cutStringAtCodePointBoundary(
    parts.join(' — '),
    WEB_SEARCH_RERANK_CARD_MAX_CODE_UNITS,
  );
}

/**
 * The ranked order: judged cards by probability descending — the sort is
 * stable, so equal probabilities keep their canonical order — then every
 * unjudged card in its canonical order.
 */
function rankCards(
  cards: ReadonlyArray<RerankCard>,
  probabilities: ReadonlyMap<string, number>,
): ReadonlyArray<RerankCard> {
  const judged: Array<{
    readonly card: RerankCard;
    readonly probability: number;
  }> = [];
  const unjudged: Array<RerankCard> = [];
  for (const card of cards) {
    const probability = probabilities.get(card.key);
    if (probability === undefined) unjudged.push(card);
    else judged.push({ card, probability });
  }
  judged.sort((left, right) => right.probability - left.probability);
  return [...judged.map((entry) => entry.card), ...unjudged];
}

/**
 * The source with its results in the ranked order. A result no card covers —
 * one whose URL is not canonical — is invisible downstream, and follows the
 * ranked cards in its canonical order, exactly as an unjudged card does.
 */
function reorderResults(
  source: Extract<SearchChainSuccess, { kind: 'results' }>,
  ranked: ReadonlyArray<RerankCard>,
): SearchChainSuccess {
  const rankedIndexes = new Set(ranked.map((card) => card.index));
  const results = ranked.map((card) => source.results[card.index]);
  for (const [index, result] of source.results.entries()) {
    if (!rankedIndexes.has(index)) results.push(result);
  }
  return { ...source, results };
}

/** One line per ranked call; the service logs the call and its cost itself. */
function logRanking(
  context: ToolContext,
  payload: {
    readonly mode: 'shadow' | 'on';
    readonly model: string | null;
    readonly cards: number;
    readonly judged: number;
    readonly latencyMs: number;
    readonly costUsd: number | null;
    readonly order: ReadonlyArray<string>;
  },
): void {
  try {
    logger.info({
      event: 'web_search.rerank',
      chatId: context.chatId,
      runId: context.runId,
      ...payload,
    });
  } catch {
    // A logging failure never fails a tool call.
  }
}
