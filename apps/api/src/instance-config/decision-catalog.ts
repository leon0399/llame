/**
 * Types of the `decisionModels[]` catalogue and its limits: what one System
 * One request to a model may hold. The lane derives its request sizes from
 * the limits.
 */

/**
 * Token ceilings of one decision model, named after TypeSafe's
 * `per_question_context` (state plus one question) and `per_request_context`
 * (state plus every question). `maxQuestionsPerRequest` is null when the
 * model declares no question cap.
 */
export type DecisionModelLimits = {
  readonly perQuestionContextTokens: number;
  readonly perRequestContextTokens: number;
  readonly maxQuestionsPerRequest: number | null;
};

/** Limits of an entry that declares none (decision-models spec). */
export const DEFAULT_DECISION_LIMITS: DecisionModelLimits = {
  perQuestionContextTokens: 8192,
  perRequestContextTokens: 32_768,
  maxQuestionsPerRequest: null,
};

/** Attempts in flight to a `system-one` provider that declares no bound. */
export const DEFAULT_DECISION_CONCURRENT_REQUESTS = 4;

/** Each field: a positive integer or a whole-value interpolation token. */
export type RawDecisionModelLimits = {
  perQuestionContextTokens?: number | string;
  perRequestContextTokens?: number | string;
  maxQuestionsPerRequest?: number | string;
};

/**
 * One entry of the decision-model catalogue: the model a tool's rerank block
 * names. `provider` must be a `providers[]` entry of `type: 'system-one'` and
 * `model` is sent verbatim on the wire; both references are checked at boot,
 * because the published JSON Schema cannot express them.
 */
export type DecisionModelConfig = {
  /** Unique catalogue id, referenced by a tool's `rerank.model`. */
  readonly id: string;
  /** A `providers[]` entry of `type: 'system-one'` (checked at boot). */
  readonly provider: string;
  /** Model id sent verbatim on the wire. */
  readonly model: string;
  /** What one request may hold, with the defaults applied. */
  readonly limits: DecisionModelLimits;
};

/** The still-uninterpolated `decisionModels[]` entry once schema-validated. */
export type RawDecisionModelEntry = {
  id: string;
  provider: string;
  model: string;
  limits?: RawDecisionModelLimits;
};
