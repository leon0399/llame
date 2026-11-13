/**
 * System One wire shapes for the decision lane.
 *
 * `POST {baseUrl}/systemone` carries `{ model, state, questions }` and returns
 * `{ model, answers, usage }`. Hosted routes add envelope fields of their own
 * (`id`, `provider`, `usage.opencode`); the codec ignores what it does not
 * model, so a route adding one never breaks it.
 *
 * A `noul` answer is P(yes): absolute and comparable across calls. The caller
 * owns every threshold, and a decision model is never replaced by a prompted
 * chat model, which cannot reproduce calibrated probabilities.
 */

import { type UnknownRecord } from '@workspace/runtime-safety';
import { z } from 'zod';

/** Per-attempt request timeout. */
export const DECISION_ATTEMPT_TIMEOUT_MS = 10_000;

/** Attempts per request, transient failures only. */
export const DECISION_MAX_ATTEMPTS = 3;

/** A response body larger than this many bytes is a codec mismatch. */
export const DECISION_RESPONSE_MAX_BYTES = 1_048_576;

/** The shared `state`: a string, or any JSON structure. */
export type DecisionState = string | UnknownRecord | ReadonlyArray<unknown>;

export type DecisionQuestion = {
  readonly type: 'noul';
  readonly instructions: string;
  readonly criteria: {
    readonly true: string;
    readonly false: string;
  };
};

/** Question id → question. The id is echoed on the matching answer. */
export type DecisionQuestions = Readonly<Record<string, DecisionQuestion>>;

export const DecisionAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1),
});

const DecisionUsageSchema = z
  .object({
    input_tokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    output_tokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    /** Authoritative USD cost. Absent means unknown, never zero. */
    cost: z.number().nonnegative().optional(),
    /**
     * Truncation reports of a server that cuts an oversized state instead of
     * refusing it (Laya). A cut state means every question read less
     * evidence, so a report fails the request closed, and so does a report
     * of the wrong type. Jev and Liquid send neither field.
     */
    truncated: z.boolean().optional(),
    state_tokens_dropped: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .refine(
    (usage) =>
      usage.truncated !== true && (usage.state_tokens_dropped ?? 0) === 0,
  )
  .transform((usage): DecisionUsage => ({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    // A reported wire cost is authoritative; no reported cost is unknown.
    costUsd: usage.cost ?? null,
  }));

export const DecisionResponseSchema = z.object({
  /** The id that answered, never the alias sent; printable ASCII only. */
  model: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[\x21-\x7E]+$/u),
  answers: z.record(z.string(), z.unknown()),
  usage: DecisionUsageSchema,
});

export type DecisionAnswer = z.infer<typeof DecisionAnswerSchema>;

/**
 * Normalized usage of one rank request. `costUsd` is null when unknown, and
 * `inputTokens` is null when a rerank response reports no count.
 */
export type DecisionUsage = {
  readonly inputTokens: number | null;
  readonly outputTokens: number;
  readonly costUsd: number | null;
};

/** Why a decision request produced no answers. */
export type DecisionFailureReason =
  | 'timeout'
  | 'rate_limited'
  | 'rejected'
  | 'upstream_error'
  | 'invalid_response';

export type DecisionRequest = {
  readonly state: DecisionState;
  readonly questions: DecisionQuestions;
  /** The enclosing call's cancellation and deadline. */
  readonly signal?: AbortSignal;
};

export type DecisionOutcome =
  | {
      readonly status: 'answered';
      /** The served model id reported by the provider. */
      readonly model: string;
      /** One answer for every requested question id. */
      readonly answers: Readonly<Record<string, DecisionAnswer>>;
      readonly usage: DecisionUsage;
      readonly latencyMs: number;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: DecisionFailureReason;
      readonly latencyMs: number;
    };
