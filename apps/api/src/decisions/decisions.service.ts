import { Inject, Injectable } from '@nestjs/common';

import {
  cutStringAtCodePointBoundary,
  normalizeProtectedValues,
  redactProtectedString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { loadPackagedTemplate } from '../prompts/template-engine';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { createDecisionClient, type DecisionClient } from './decision-client';
import {
  type DecisionAnswer,
  type DecisionFailureReason,
  type DecisionOutcome,
  type DecisionRequest,
  type DecisionUsage,
} from './decision-protocol';
import { decisionLogger, type DecisionLogger } from './decision-logger';

/** One request carries at most this many cards with their questions. */
export const DECISION_MAX_CARDS_PER_REQUEST = 256;

const NO_VALUES: Record<string, never> = {};

/**
 * The decision lane's one question: is this candidate worth reading? A `noul`
 * per card, never a `choice` over candidates — Jev documents option-order
 * bias, and a choice would also cap candidates at the wire's 255 options.
 * Packaged as `prompts/relevance-yes.md` and `prompts/relevance-no.md`, rendered
 * at import so a missing template fails at startup.
 */
export const RELEVANCE_YES = loadPackagedTemplate<Record<string, never>>(
  __dirname,
  'relevance-yes',
)(NO_VALUES);
export const RELEVANCE_NO = loadPackagedTemplate<Record<string, never>>(
  __dirname,
  'relevance-no',
)(NO_VALUES);

/**
 * The state is untrusted data. Web pages and file contents reach it verbatim,
 * so the instruction says so explicitly and the rubric stays a fixed packaged
 * template (`prompts/untrusted-state.md`) — never text taken from a card.
 */
export const UNTRUSTED_STATE_INSTRUCTION = loadPackagedTemplate<
  Record<string, never>
>(
  __dirname,
  'untrusted-state',
)(NO_VALUES);

/** The per-card question, packaged as `prompts/card-question.md`. */
const renderCardQuestion = loadPackagedTemplate<{
  key: string;
  field: string;
  rubric: string;
}>(__dirname, 'card-question');

/**
 * One candidate card: the caller's key and the card's FULL source text. The
 * lane, not the caller, cuts it to `cardBound`, so replacement of the provider
 * key always runs before any excerpt limit can split an occurrence.
 */
export type JudgeCandidate = {
  readonly key: string;
  readonly text: string;
};

export type JudgeCandidatesInput = {
  /**
   * A `decisionModels[].id`: the catalogue entry whose client judges this
   * call. The tool reads it from its own `rerank` block.
   */
  readonly model: string;
  /** For the structured log line only; this lane records no RunEvent. */
  readonly runId: string;
  readonly chatId: string;
  /** The tool that asked, e.g. `web_search` or `grep`. */
  readonly tool: string;
  readonly objective?: string;
  readonly query: string;
  /**
   * Cards in canonical order. The wire key of a card is `p<index>` from its
   * position; `JudgeCandidate.key` is only the caller's handle for the result.
   */
  readonly cards: ReadonlyArray<JudgeCandidate>;
  /**
   * Maximum UTF-16 code units of one card's text on the wire, applied after
   * key replacement at a code-point boundary.
   */
  readonly cardBound: number;
  /**
   * The tool's own relevance question, e.g. "Does this result help answer the
   * objective?". Fixed strings in the caller, never card text.
   */
  readonly rubric: string;
  /** The enclosing tool call's deadline and cancellation. */
  readonly abortSignal?: AbortSignal;
};

export type JudgementFailureReason =
  | DecisionFailureReason
  | 'no_candidates'
  | 'unknown_model';

export type CandidateJudgement = {
  readonly status: 'answered' | 'unavailable';
  /** Judged caller key → P(relevant). Absent cards keep the caller's order. */
  readonly probabilities: ReadonlyMap<string, number> | undefined;
  /** Caller keys no accepted response answered, in card order. */
  readonly unanswered: ReadonlyArray<string>;
  /** Why an `unavailable` result is unavailable. */
  readonly reason?: JudgementFailureReason;
  /** Accepted responses only. */
  readonly usage: DecisionUsage;
  /** The first accepted response's served id in request order, else null. */
  readonly model: string | null;
  readonly latencyMs: number;
};

/**
 * The capability tools receive as `ToolContext.decisions`. Absent means no
 * decision model is configured, and a tool keeps its canonical order. A tool
 * that ranks names its own catalogue id on every call; an id with no client
 * fails closed like an absent lane.
 */
export type DecisionJudge = {
  judgeCandidates(input: JudgeCandidatesInput): Promise<CandidateJudgement>;
  /**
   * Replace every complete occurrence of the named model's provider key with
   * the protected-value marker. Tools apply it to source text and locators
   * before excerpts, inline cuts, artifacts, and replay. An unknown model id
   * returns the text unchanged. This is exact-key replacement only.
   */
  protectText(model: string, text: string): string;
};

/** The wire key of the card at `index`, zero-padded to the last index's width. */
function cardKey(index: number, width: number): string {
  return `p${String(index).padStart(width, '0')}`;
}

/** A card as the wire sees it: positional key plus protected, final text. */
type WireCard = { readonly key: string; readonly text: string };

/**
 * The state and questions of ONE decision request: its cards are keyed by wire
 * key in one shared state and each gets its own `noul` question. The caller
 * sends one such request per group of at most 256 cards, so a request never
 * carries another group's cards.
 */
export function buildJudgeRequest(input: {
  readonly objective?: string;
  readonly query: string;
  readonly cards: ReadonlyArray<WireCard>;
  readonly rubric: string;
}) {
  // The objective, when present, is the criterion: it is why the model wants
  // the candidates, while the query is only how it searched.
  const field = input.objective !== undefined ? 'objective' : 'query';
  const state = {
    query: input.query,
    ...(input.objective !== undefined && { objective: input.objective }),
    cards: Object.fromEntries(input.cards.map((card) => [card.key, card.text])),
    criteria: { yes: RELEVANCE_YES, no: RELEVANCE_NO },
    task: UNTRUSTED_STATE_INSTRUCTION,
  };
  const questions = Object.fromEntries(
    input.cards.map((card) => [
      card.key,
      {
        type: 'noul' as const,
        // Every question shares one state, so each one must name its card:
        // an identical instruction on every key gives the judge nothing to
        // tell the cards apart, and every answer converges on one value.
        instructions: renderCardQuestion({
          key: card.key,
          field,
          rubric: input.rubric,
        }),
        criteria: { true: RELEVANCE_YES, false: RELEVANCE_NO },
      },
    ]),
  );
  return { state, questions };
}

const NO_USAGE: DecisionUsage = {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: null,
};

/** The fail-closed answer: nothing was asked or nothing answered. */
function unavailableJudgement(
  input: JudgeCandidatesInput,
  reason: JudgementFailureReason,
  latencyMs = 0,
): CandidateJudgement {
  return {
    status: 'unavailable',
    probabilities: undefined,
    unanswered: input.cards.map((card) => card.key),
    reason,
    usage: NO_USAGE,
    model: null,
    latencyMs,
  };
}

/** Everything the lane needs from one catalogue entry beyond its client. */
export type JudgeOptions = {
  readonly logger?: DecisionLogger;
  /**
   * The provider's resolved key, already through `normalizeProtectedValues`;
   * complete occurrences are replaced.
   */
  readonly protectedValues?: ReadonlyArray<string>;
};

/**
 * Judge a batch of candidates through one decision client, merge the answers,
 * and emit one structured log line. An ordinary provider failure never throws:
 * it leaves that request's cards unjudged and the caller keeps its canonical
 * order for them. An abort of `abortSignal` is not a provider failure: it
 * rejects with the signal's reason so the tool runner reports its own timeout
 * or cancellation.
 *
 * Cards travel with their questions: the batch is split into groups of at most
 * 256 cards, one request per group carries only that group's cards, and every
 * group is in flight at once. A failed group leaves only its own cards
 * unjudged; the call is unavailable only when every group failed.
 */
export async function judgeCandidatesWith(
  client: DecisionClient,
  input: JudgeCandidatesInput,
  options: JudgeOptions = {},
): Promise<CandidateJudgement> {
  input.abortSignal?.throwIfAborted();
  if (input.cards.length === 0) {
    return logged(
      input,
      0,
      unavailableJudgement(input, 'no_candidates'),
      options.logger,
    );
  }

  const { wireCards, requests } = buildRequests(
    input,
    options.protectedValues ?? [],
  );
  const outcomes = await Promise.all(
    requests.map((request) => decideSafely(client, request)),
  );
  const judgement = logged(
    input,
    requests.length,
    mergeOutcomes(input, wireCards, outcomes),
    options.logger,
  );
  input.abortSignal?.throwIfAborted();
  return judgement;
}

/** Emit the call's one log line and return the judgement unchanged. */
function logged(
  input: JudgeCandidatesInput,
  requests: number,
  judgement: CandidateJudgement,
  logger: DecisionLogger = decisionLogger,
): CandidateJudgement {
  try {
    logger.info(logPayload(input, requests, judgement));
  } catch {
    // A logging failure never fails a tool call.
  }
  return judgement;
}

/**
 * Key and protect the cards, then group them into requests of at most 256.
 * Exact-key replacement runs on the query, objective, and FULL card text, and
 * only then is each card cut to the bound, so no cut can split an occurrence
 * of the key and leak a prefix of it.
 */
function buildRequests(
  input: JudgeCandidatesInput,
  protectedValues: ReadonlyArray<string>,
) {
  const protect = (text: string) =>
    redactProtectedString(text, protectedValues);
  const width = String(input.cards.length - 1).length;
  const wireCards = input.cards.map((card, index) => ({
    key: cardKey(index, width),
    text: cutStringAtCodePointBoundary(protect(card.text), input.cardBound),
  }));
  const shared = {
    query: protect(input.query),
    ...(input.objective !== undefined && {
      objective: protect(input.objective),
    }),
    rubric: input.rubric,
  };
  const requests: Array<DecisionRequest> = [];
  for (
    let start = 0;
    start < wireCards.length;
    start += DECISION_MAX_CARDS_PER_REQUEST
  ) {
    requests.push({
      ...buildJudgeRequest({
        ...shared,
        cards: wireCards.slice(start, start + DECISION_MAX_CARDS_PER_REQUEST),
      }),
      ...(input.abortSignal !== undefined && { signal: input.abortSignal }),
    });
  }
  return { wireCards, requests };
}

/**
 * Ask the client, tolerating one that throws: the client's own contract is
 * never-throw for provider problems, and this keeps a broken double from
 * failing the tool call. An abort lands here too, as `unavailable`: the caller
 * logs the call's one line first and then rethrows the signal's reason.
 */
async function decideSafely(
  client: DecisionClient,
  request: DecisionRequest,
): Promise<DecisionOutcome> {
  try {
    return await client.decide(request);
  } catch {
    return { status: 'unavailable', reason: 'upstream_error', latencyMs: 0 };
  }
}

/** One `answered` request of a batch's outcomes. */
type AnsweredOutcome = Extract<DecisionOutcome, { status: 'answered' }>;

/** Accepted usage only; cost is null if any accepted cost is unknown. */
function sumAccepted(answered: ReadonlyArray<AnsweredOutcome>): DecisionUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | null = 0;
  for (const { usage } of answered) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    costUsd =
      costUsd === null || usage.costUsd === null
        ? null
        : costUsd + usage.costUsd;
  }
  return { inputTokens, outputTokens, costUsd };
}

/**
 * Merge the request outcomes, in request order. An answered request
 * contributes its answers and usage; a failed one leaves only its own cards
 * unjudged. Latency is the slowest request's, because they run together.
 */
function mergeOutcomes(
  input: JudgeCandidatesInput,
  wireCards: ReadonlyArray<WireCard>,
  outcomes: ReadonlyArray<DecisionOutcome>,
): CandidateJudgement {
  const latencyMs = Math.max(
    0,
    ...outcomes.map((outcome) => outcome.latencyMs),
  );
  const answered = outcomes.flatMap((outcome) =>
    outcome.status === 'answered' ? [outcome] : [],
  );
  const first = answered[0];
  if (first === undefined) {
    return unavailableJudgement(input, firstFailureReason(outcomes), latencyMs);
  }

  const answers: Record<string, DecisionAnswer> = {};
  for (const outcome of answered) Object.assign(answers, outcome.answers);
  const probabilities = new Map<string, number>();
  const unanswered: Array<string> = [];
  input.cards.forEach((card, index) => {
    const wireKey = wireCards[index]?.key;
    const answer = wireKey === undefined ? undefined : answers[wireKey];
    if (answer === undefined) unanswered.push(card.key);
    else probabilities.set(card.key, answer.noul);
  });
  return {
    status: 'answered',
    probabilities,
    unanswered,
    usage: sumAccepted(answered),
    model: first.model,
    latencyMs,
  };
}

function firstFailureReason(
  outcomes: ReadonlyArray<DecisionOutcome>,
): DecisionFailureReason {
  for (const outcome of outcomes) {
    if (outcome.status === 'unavailable') return outcome.reason;
  }
  return 'upstream_error';
}

function logPayload(
  input: JudgeCandidatesInput,
  requests: number,
  judgement: CandidateJudgement,
): UnknownRecord {
  return {
    event: 'decision.completed',
    runId: input.runId,
    chatId: input.chatId,
    tool: input.tool,
    status: judgement.status,
    model: judgement.model,
    cards: input.cards.length,
    requests,
    judged: judgement.probabilities?.size ?? 0,
    inputTokens: judgement.usage.inputTokens,
    outputTokens: judgement.usage.outputTokens,
    costUsd: judgement.usage.costUsd,
    latencyMs: judgement.latencyMs,
    ...(judgement.reason !== undefined && { reason: judgement.reason }),
  };
}

type CatalogueEntry = {
  readonly client: DecisionClient;
  readonly protectedValues: ReadonlyArray<string>;
};

/**
 * The configured decision models. One client per catalogue id is built once at
 * boot; an absent or empty `decisionModels[]` means every call fails closed
 * with `unavailable`. The boot loader has already proved each entry's provider
 * exists, is `system-one`, and that ids are unique, so a missing entry here can
 * only mean a caller named an id outside the catalogue, which also fails
 * closed. No chat model ever answers in place of a decision model.
 */
@Injectable()
export class DecisionsService implements DecisionJudge {
  private readonly entries: ReadonlyMap<string, CatalogueEntry>;

  constructor(
    @Inject(InstanceConfigService)
    instanceConfig: Pick<InstanceConfigService, 'config'>,
  ) {
    const entries = new Map<string, CatalogueEntry>();
    for (const entry of instanceConfig.config.decisionModels ?? []) {
      const provider = instanceConfig.config.providers.find(
        (candidate) => candidate.id === entry.provider,
      );
      if (provider?.type !== 'system-one') continue;
      entries.set(entry.id, {
        client: createDecisionClient(provider, entry.model),
        protectedValues: normalizeProtectedValues([provider.key]),
      });
    }
    this.entries = entries;
  }

  async judgeCandidates(
    input: JudgeCandidatesInput,
  ): Promise<CandidateJudgement> {
    const entry = this.entries.get(input.model);
    if (entry === undefined) {
      input.abortSignal?.throwIfAborted();
      return logged(input, 0, unavailableJudgement(input, 'unknown_model'));
    }
    return judgeCandidatesWith(entry.client, input, {
      protectedValues: entry.protectedValues,
    });
  }

  protectText(model: string, text: string): string {
    const entry = this.entries.get(model);
    if (entry === undefined) return text;
    return redactProtectedString(text, entry.protectedValues);
  }
}
