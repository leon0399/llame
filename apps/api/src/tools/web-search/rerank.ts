/**
 * `web_search` objective ranking through the decision lane. A `results`
 * outcome whose whole set does not fit inline becomes one card per result —
 * `[k] title — host — snippet`, `k` being the zero-padded engine position — and
 * the shared ranking kernel judges each card against the objective, or against
 * the query without one. The ranked order is applied before every inline cut and
 * before the artifact is stored, so the inline head, the artifact text, its
 * findings, and the continuation line share one order.
 *
 * Before any of that, the call's received results are deduplicated by the
 * aggregate's grouping key, and, when a rank model is configured, the decision
 * key is replaced in every source-derived presentation field. Both steps run
 * even when the guard then skips ranking.
 */

import { oneLine } from '@workspace/native-file-tools';

import { type DecisionJudge } from '../../decisions/decisions.service';
import { rankCards, type RankCardsResult } from '../../ranking/rank-cards';
import { type ToolContext } from '../types';
import { groupingKey } from './aggregate';
import {
  type RawAnswer,
  type RawCitation,
  type RawResult,
  type SearchChainSuccess,
} from './chain';
import { canonicalUrl } from './output';

/** One card's wire text stays under this many UTF-16 code units. */
export const WEB_SEARCH_RERANK_CARD_BOUND = 400;

/**
 * The one fixed question every card gets. Code, never card text: a result can
 * carry prompt-injection instructions, and the decision service marks the state
 * untrusted itself.
 */
export const WEB_SEARCH_RERANK_RUBRIC =
  'Does this result help answer the objective (or, without one, the query)?';

/** What a ranked call stores under `display` beside its closed output shape. */
export type WebSearchRerankRecord = {
  /** The served model id, never the catalogue id. */
  readonly model: string;
  /** Every card key in the applied order. */
  readonly order: ReadonlyArray<string>;
  /** Judged key → score as the ranking model answered it. */
  readonly scores: Readonly<Record<string, number>>;
  readonly latencyMs: number;
  readonly costUsd: number | null;
};

type ResultsSource = Extract<SearchChainSuccess, { kind: 'results' }>;

/** The outcome of one rank attempt on a results source. */
export type WebSearchRanking =
  | {
      readonly status: 'ranked';
      readonly source: ResultsSource;
      readonly record: WebSearchRerankRecord;
    }
  | { readonly status: 'unavailable'; readonly source: ResultsSource };

/** The source with the call's results deduplicated and the key replaced. */
export function prepareSource(
  context: ToolContext,
  source: SearchChainSuccess,
): SearchChainSuccess {
  const protect = keyProtector(context);
  if (source.kind === 'answer') {
    return {
      ...source,
      answer: protect(source.answer),
      citations: protectCitations(source.citations, protect),
    };
  }
  return {
    ...source,
    results: deduplicate(
      source.results.map((result) => protectResult(result, protect)),
    ),
    ...(source.answers !== undefined && {
      answers: source.answers.map((answer): RawAnswer => ({
        ...answer,
        answer: protect(answer.answer),
        citations: protectCitations(answer.citations, protect),
      })),
    }),
  };
}

/** Exact-key replacement for the configured model; identity without one. */
function keyProtector(context: ToolContext): (text: string) => string {
  const model = context.webSearch?.rerank?.model;
  const decisions = context.decisions;
  if (model === undefined || decisions === undefined) return (text) => text;
  return (text) => decisions.protectText(model, text);
}

function protectResult(
  result: RawResult,
  protect: (text: string) => string,
): RawResult {
  return {
    ...result,
    title: protect(result.title),
    url: protect(result.url),
    ...(result.snippet !== undefined && { snippet: protect(result.snippet) }),
  };
}

function protectCitations(
  citations: ReadonlyArray<RawCitation>,
  protect: (text: string) => string,
): Array<RawCitation> {
  return citations.map((citation) => ({
    ...citation,
    url: protect(citation.url),
    ...(citation.title !== undefined && { title: protect(citation.title) }),
  }));
}

/**
 * The results with a result whose URL the output cannot keep removed and the
 * first spelling of each grouping key kept.
 */
function deduplicate(results: ReadonlyArray<RawResult>): Array<RawResult> {
  const seen = new Set<string>();
  const unique: Array<RawResult> = [];
  for (const result of results) {
    const url = canonicalUrl(result.url);
    if (url === undefined) continue;
    const key = groupingKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...result, url });
  }
  return unique;
}

/**
 * Rank the results of one call. Ordinary failure returns `unavailable` with the
 * source untouched; an abort of the enclosing call propagates so the runner
 * reports its own timeout or cancellation. Returns `undefined` when no judge is
 * available, in which case the call keeps its engine order without a note.
 */
export async function rankWebSearchResults(
  context: ToolContext,
  source: ResultsSource,
  objective: string | undefined,
): Promise<WebSearchRanking | undefined> {
  const model = context.webSearch?.rerank?.model;
  const judge = context.decisions;
  if (model === undefined || judge === undefined) return undefined;

  const width = String(source.results.length - 1).length;
  const cards = source.results.map((result, index) => {
    const key = `p${String(index).padStart(width, '0')}`;
    return { key, text: cardText(key, result) };
  });
  const ranked = await rankSafely(context, judge, {
    model,
    objective,
    query: source.query,
    cards,
  });
  if (ranked === undefined || ranked.status === 'unavailable')
    return { status: 'unavailable', source };

  const indexByKey = new Map(cards.map((card, index) => [card.key, index]));
  return {
    status: 'ranked',
    source: {
      ...source,
      results: ranked.order.map((key) => source.results[indexByKey.get(key)!]),
    },
    record: {
      model: ranked.model,
      order: ranked.order,
      scores: ranked.scores,
      latencyMs: ranked.latencyMs,
      costUsd: ranked.costUsd,
    },
  };
}

async function rankSafely(
  context: ToolContext,
  judge: DecisionJudge,
  request: {
    readonly model: string;
    readonly objective: string | undefined;
    readonly query: string;
    readonly cards: ReadonlyArray<{
      readonly key: string;
      readonly text: string;
    }>;
  },
): Promise<RankCardsResult | undefined> {
  try {
    return await rankCards({
      judge,
      model: request.model,
      runId: context.runId ?? '',
      chatId: context.chatId,
      tool: 'web_search',
      ...(request.objective !== undefined && { objective: request.objective }),
      query: request.query,
      cards: request.cards,
      cardBound: WEB_SEARCH_RERANK_CARD_BOUND,
      rubric: WEB_SEARCH_RERANK_RUBRIC,
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

/** `[k] title — host — snippet`, each part on one line; the lane bounds it. */
function cardText(key: string, result: RawResult): string {
  const title = oneLine(result.title).trim() || oneLine(result.url);
  return [
    `[${key}] ${title}`,
    URL.parse(result.url)?.host,
    result.snippet === undefined ? undefined : oneLine(result.snippet),
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' — ');
}
