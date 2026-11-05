/**
 * System One wire shapes (experimental decision lane).
 *
 * One codec serves every hosted route verified on 2026-11-05, because they
 * speak the same JSON: `POST {baseUrl}/systemone` with
 * `{ model, state, questions }` and `{ model, answers, usage }` back.
 * OpenRouter (`https://openrouter.ai/api/v1`) adds `id`, `provider` and
 * `usage.cost`; OpenCode (`https://opencode.ai/zen/v1`) adds `usage.cost` and
 * an `usage.opencode` billing block; the native TypeSafe wire reports tokens
 * only. Extra envelope fields are ignored, so a route adding one never breaks
 * the codec.
 *
 * Answers are probabilities, not generated text: a `noul` answer is P(yes),
 * absolute and comparable across calls, and the caller owns every threshold.
 * A decision model is therefore never replaced by a prompted chat model —
 * those cannot reproduce calibrated probabilities (oh-my-pi's rule).
 */

import { type UnknownRecord } from '@workspace/runtime-safety';
import { z } from 'zod';

/** Per-attempt request timeout (oh-my-pi `DEFAULT_TIMEOUT_MS`). */
export const DECISION_ATTEMPT_TIMEOUT_MS = 10_000;
/** Attempts per chunk, transient failures only. */
export const DECISION_MAX_ATTEMPTS = 3;
/** Questions per request: the state is billed once, so pack them. */
export const DECISION_MAX_QUESTIONS = 48;
/** Requests in flight, so a self-hosted endpoint is never burst. */
export const DECISION_CHUNK_CONCURRENCY = 4;
/** A response body larger than this is a codec mismatch, not an answer. */
export const DECISION_RESPONSE_MAX_CODE_UNITS = 1 << 20;

/** The shared `state`: a string, or any JSON structure. */
export type DecisionState = string | UnknownRecord | ReadonlyArray<unknown>;

export type DecisionNoulQuestion = {
  readonly type: 'noul';
  readonly instructions: string;
  /** Optional guidance for the two outcomes; `noul` answers P(true). */
  readonly criteria?: {
    readonly true?: string;
    readonly false?: string;
  };
};

export type DecisionChoiceQuestion = {
  readonly type: 'choice';
  readonly instructions: string;
  /** Choice name → description; at least two entries. */
  readonly criteria: Readonly<Record<string, string>>;
};

export type DecisionScoreQuestion = {
  readonly type: 'score';
  readonly instructions: string;
  /** Level descriptions, lowest first (2 to 10 entries). */
  readonly criteria: ReadonlyArray<string>;
};

export type DecisionQuestion =
  | DecisionNoulQuestion
  | DecisionChoiceQuestion
  | DecisionScoreQuestion;

/** Question id → question. The id is echoed on the matching answer. */
export type DecisionQuestions = Readonly<Record<string, DecisionQuestion>>;

const ProbabilitySchema = z.number().min(0).max(1);

const NoulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: ProbabilitySchema,
});

const ChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number().optional(),
  probabilities: z.record(z.string(), ProbabilitySchema),
});

const ScoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number(),
  confidence: z.number().optional(),
  legend: z.record(z.string(), z.string()).optional(),
  probabilities: z.record(z.string(), ProbabilitySchema),
});

const DecisionAnswerSchema = z.discriminatedUnion('type', [
  NoulAnswerSchema,
  ChoiceAnswerSchema,
  ScoreAnswerSchema,
]);

const DecisionUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  /** Authoritative USD cost, present only on routes that bill per call. */
  cost: z.number().nonnegative().optional(),
});

export const DecisionResponseSchema = z.object({
  /** The id that answered — a versioned snapshot, never the alias sent. */
  model: z.string().min(1),
  answers: z.record(z.string(), DecisionAnswerSchema),
  usage: DecisionUsageSchema,
});

export type DecisionAnswer = z.infer<typeof DecisionAnswerSchema>;
export type DecisionWireUsage = z.infer<typeof DecisionUsageSchema>;

/** Normalized usage of one decision call. `costUsd` is null when unknown. */
export type DecisionUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null;
};

/** Why a decision call produced no answers (or only some). */
export type DecisionFailureReason =
  | 'aborted'
  | 'timeout'
  | 'rate_limited'
  | 'rejected'
  | 'upstream_error'
  | 'invalid_response';

export type DecisionRequest = {
  readonly state: DecisionState;
  readonly questions: DecisionQuestions;
  readonly signal?: AbortSignal;
};

export type DecisionOutcome =
  | {
      readonly status: 'answered';
      /** The served model id reported by the provider. */
      readonly model: string;
      readonly answers: Readonly<Record<string, DecisionAnswer>>;
      /** Requested question ids no chunk answered, in request order. */
      readonly unanswered: ReadonlyArray<string>;
      readonly usage: DecisionUsage;
      readonly latencyMs: number;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: DecisionFailureReason;
      readonly latencyMs: number;
    };

/**
 * The wire body of one decision request. Pure: no credential, no endpoint, so
 * a test can assert the exact JSON a provider receives.
 */
export function encodeDecisionRequest(
  model: string,
  state: DecisionState,
  questions: DecisionQuestions,
) {
  return {
    model,
    state,
    questions: Object.fromEntries(
      Object.entries(questions).map(([key, question]) => [
        key,
        wireQuestion(question),
      ]),
    ),
  };
}

function wireQuestion(question: DecisionQuestion) {
  switch (question.type) {
    case 'noul':
      return {
        type: question.type,
        instructions: question.instructions,
        ...(question.criteria !== undefined && { criteria: question.criteria }),
      };
    case 'choice':
      return {
        type: question.type,
        instructions: question.instructions,
        criteria: question.criteria,
      };
    case 'score':
      return {
        type: question.type,
        instructions: question.instructions,
        criteria: question.criteria,
      };
  }
}

/** Split questions into requests of at most `maxQuestions`, in request order. */
export function chunkQuestions(
  questions: DecisionQuestions,
  maxQuestions: number,
): Array<DecisionQuestions> {
  const entries = Object.entries(questions);
  const chunks: Array<DecisionQuestions> = [];
  for (let index = 0; index < entries.length; index += maxQuestions) {
    chunks.push(Object.fromEntries(entries.slice(index, index + maxQuestions)));
  }
  return chunks;
}

/**
 * Normalize a wire usage block: a reported `cost` always wins, and a wire that
 * reports none is priced from the configured fallback (or left unknown).
 */
export function toUsage(
  usage: DecisionWireUsage,
  pricingUsdPer1M: { readonly input: number } | undefined,
): DecisionUsage {
  const costUsd =
    usage.cost ??
    (pricingUsdPer1M === undefined
      ? null
      : (usage.input_tokens * pricingUsdPer1M.input) / 1_000_000);
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costUsd,
  };
}

/** Sum chunk usages. Any unknown chunk cost makes the total unknown. */
export function sumUsage(usages: ReadonlyArray<DecisionUsage>): DecisionUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | null = 0;
  for (const usage of usages) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    if (usage.costUsd === null) costUsd = null;
    else if (costUsd !== null) costUsd += usage.costUsd;
  }
  return { inputTokens, outputTokens, costUsd };
}
