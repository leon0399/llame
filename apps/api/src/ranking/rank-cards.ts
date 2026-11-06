import {
  type CandidateJudgement,
  type DecisionJudge,
  type JudgeCandidate,
} from '../decisions/decisions.service';

export type RankCardsInput = {
  readonly judge: Pick<DecisionJudge, 'judgeCandidates'>;
  /** A `decisionModels[].id`. */
  readonly model: string;
  /** For the decision log line only. */
  readonly tool: string;
  readonly runId: string;
  readonly chatId: string;
  readonly objective?: string;
  readonly query: string;
  /** Cards in canonical order; keys must be unique. */
  readonly cards: ReadonlyArray<JudgeCandidate>;
  /** The tool's fixed relevance question. */
  readonly rubric: string;
  /** The enclosing call's deadline and cancellation; an abort is rethrown. */
  readonly abortSignal?: AbortSignal;
};

export type RankCardsResult = {
  /**
   * `ranked`: every card judged. `partial`: some cards were not judged and
   * follow the judged ones. `unavailable`: no card was judged; `order` is
   * canonical.
   */
  readonly status: 'ranked' | 'partial' | 'unavailable';
  /** A complete permutation of the input keys. */
  readonly order: ReadonlyArray<string>;
  /** Judged key → score as the model answered it; absent key = not judged. */
  readonly scores: Readonly<Record<string, number>>;
  /** The served model id, else the requested catalogue id. */
  readonly model: string;
  readonly latencyMs: number;
  /** Null when any accepted response reported no cost. */
  readonly costUsd: number | null;
};

/**
 * Judged keys by score descending, ties in canonical position; unjudged keys
 * after them in canonical order.
 */
export function orderByScores(
  keys: ReadonlyArray<string>,
  scores: ReadonlyMap<string, number>,
): Array<string> {
  const judged: Array<{ key: string; score: number; position: number }> = [];
  const unjudged: Array<string> = [];
  keys.forEach((key, position) => {
    const score = scores.get(key);
    if (score === undefined) unjudged.push(key);
    else judged.push({ key, score, position });
  });
  judged.sort((a, b) => b.score - a.score || a.position - b.position);
  return [...judged.map(({ key }) => key), ...unjudged];
}

/** Throws unless `order` holds every canonical key exactly once. */
export function assertPermutation(
  canonical: ReadonlyArray<string>,
  order: ReadonlyArray<string>,
): void {
  const expected = new Set(canonical);
  const valid =
    expected.size === canonical.length &&
    order.length === canonical.length &&
    new Set(order).size === order.length &&
    order.every((key) => expected.has(key));
  if (!valid) {
    throw new Error('rankCards produced an order that is not a permutation');
  }
}

/** The judge call; an enclosing abort propagates, never becomes unavailable. */
async function judge(input: RankCardsInput): Promise<CandidateJudgement> {
  input.abortSignal?.throwIfAborted();
  try {
    const judgement = await input.judge.judgeCandidates({
      model: input.model,
      tool: input.tool,
      runId: input.runId,
      chatId: input.chatId,
      query: input.query,
      cards: input.cards,
      rubric: input.rubric,
      ...(input.objective !== undefined && { objective: input.objective }),
      ...(input.abortSignal !== undefined && {
        abortSignal: input.abortSignal,
      }),
    });
    input.abortSignal?.throwIfAborted();
    return judgement;
  } catch (error) {
    input.abortSignal?.throwIfAborted();
    throw error;
  }
}

/**
 * Rank cards by a decision model's relevance score. Ordinary judge failure
 * leaves the canonical order (`unavailable`) or ranks the judged cards first
 * (`partial`); an enclosing abort always propagates.
 */
export async function rankCards(
  input: RankCardsInput,
): Promise<RankCardsResult> {
  const canonical = input.cards.map(({ key }) => key);
  const judgement = await judge(input);
  const judged =
    judgement.status === 'answered' && judgement.probabilities !== undefined
      ? judgement.probabilities
      : new Map<string, number>();
  const order = orderByScores(canonical, judged);
  assertPermutation(canonical, order);
  let status: RankCardsResult['status'] = 'partial';
  if (judged.size === 0) status = 'unavailable';
  else if (judged.size === canonical.length) status = 'ranked';
  return {
    status,
    order,
    scores: Object.fromEntries(judged),
    model: judgement.model ?? input.model,
    latencyMs: judgement.latencyMs,
    costUsd: judged.size === 0 ? null : judgement.usage.costUsd,
  };
}
