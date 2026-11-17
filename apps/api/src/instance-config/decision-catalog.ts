/**
 * Types of the `decisionModels[]` catalogue and its limits: what one System
 * One request to a model may hold. The lane derives its request sizes from
 * the limits.
 */

import type { ModelWire } from './provider-routing';

/**
 * Token ceilings of one decision model, named after TypeSafe's
 * `per_question_context` (state plus one question) and `per_request_context`
 * (state plus every question). `maxQuestionsPerRequest` is null when the
 * model declares no question cap. `maxConcurrentRequests` bounds attempts in
 * flight for this catalog entry in one process.
 */
export type DecisionModelLimits = {
  readonly perQuestionContextTokens: number;
  readonly perRequestContextTokens: number;
  readonly maxQuestionsPerRequest: number | null;
  readonly maxConcurrentRequests: number;
};

/** Limits of an entry that declares none (decision-models spec). */
export const DEFAULT_DECISION_LIMITS: DecisionModelLimits = {
  perQuestionContextTokens: 8192,
  perRequestContextTokens: 32_768,
  maxQuestionsPerRequest: null,
  // OMP's process-wide judgment slots: four full 256-card calls before a wait.
  maxConcurrentRequests: 32,
};

/** Each field: a positive integer or a whole-value interpolation token. */
export type RawDecisionModelLimits = {
  perQuestionContextTokens?: number | string;
  perRequestContextTokens?: number | string;
  maxQuestionsPerRequest?: number | string;
  maxConcurrentRequests?: number | string;
};

/**
 * One entry of the decision-model catalogue: the model a tool's rerank block
 * names. `provider` must be a `providers[]` entry that resolves a decision
 * wire and `providerModelId` is sent verbatim as the wire `model`; both
 * references are checked at boot,
 * because the published JSON Schema cannot express them.
 */
export type DecisionModelConfig = {
  /** Unique catalogue id, referenced by a tool's `rerank.model`. */
  readonly id: string;
  /** A `providers[]` entry that resolves a decision wire (checked at boot). */
  readonly provider: string;
  /** Provider model id, sent verbatim as the wire `model`. */
  readonly providerModelId: string;
  readonly wire?: ModelWire;
  /** What one request may hold, with the defaults applied. */
  readonly limits: DecisionModelLimits;
};

/** The still-uninterpolated `decisionModels[]` entry once schema-validated. */
export type RawDecisionModelEntry = {
  id: string;
  provider: string;
  providerModelId: string;
  wire?: ModelWire;
  limits?: RawDecisionModelLimits;
};
