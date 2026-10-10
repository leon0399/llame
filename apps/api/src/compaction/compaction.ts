/**
 * Compaction planning (#57) — pure logic for context compaction.
 *
 * When a Run's prepared request reaches its model's compaction threshold, or no
 * longer fits that model's window, older turns are absorbed into a checkpoint
 * row (role `checkpoint`, stored in `messages`) that supersedes them; the
 * ContextBuilder then assembles the checkpoint's stored text + later turns.
 * Messages are never deleted or mutated — the checkpoint's absorbedThroughSeq
 * keeps the full history auditable and rewindable (Hermes-style lineage,
 * SPEC §2.1).
 *
 * One trigger, one request shape: which model, prompt, declarations and effort
 * fill it is data (design D4). This module is deliberately DB-free — the
 * CompactionService orchestrates (load → plan → model call); everything
 * decidable is decided here.
 */

import {
  buildContext,
  type ContextCheckpoint,
  type ModelRequestContext,
  type ModelMessage,
  type StoredMessage,
} from '../chats/context-builder';
import { loadPackagedTemplate } from '../prompts/template-engine';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import type { Message, ModelToolDeclaration } from '../db/schema';

/**
 * When the model's context window is known (MODEL_CONTEXT_WINDOW_TOKENS),
 * compact at this fraction of it — the remaining headroom absorbs the next
 * turns, the model's output, and estimation error. Same shape as the
 * window-minus-reserve triggers in opencode / Claude Code / OpenClaw, expressed
 * as a ratio so it scales from 8k to 1M+ windows without retuning.
 */
export const COMPACTION_WINDOW_RATIO = 0.8;

/**
 * Which trigger produced the summary request (design D4). The threshold and
 * window variants still select different model and prompt inputs in
 * CompactionService, but both use the same summarization instruction.
 */
export type CompactionVariant = 'threshold' | 'window';

/**
 * The summarize instruction — sent as the FINAL USER MESSAGE of the compaction
 * request, not as a system prompt. The request reuses the chat's own system
 * prompt and history rendering (see buildCompactionRequest), so its prefix is
 * byte-identical to the turn that just ran and the provider's prompt cache
 * (OpenAI-style strict prefix matching) covers the absorbed bulk; only this
 * trailing instruction is uncached. What the summary must preserve comes from
 * #57: objective, constraints, decisions, pending items — working state, not
 * prose. The section headings and rules are literal text in
 * `prompts/instruction.md`; `compaction.test.ts` pins them against the
 * rendered instruction.
 */

/**
 * Keeps the owner's standing profile out of the persisted checkpoint
 * (add-user-personalization D7).
 *
 * The replayed system prompt contains the rendered `<user_personalization>`
 * block, and the instructions above ask for constraints and preferences — so
 * without this, a standing preference gets copied into a checkpoint that is
 * persisted and replayed forever, and that a later personalization edit or
 * deletion can never reach.
 *
 * Syntactic, not semantic: naming the region asks the model only to not copy
 * text out of a marked region, where scoping by provenance ("preferences the
 * user stated in the conversation") would ask it to work out where a preference
 * it can see originated. The first is far more reliable.
 *
 * The rail's items no longer have a delimiter each: every one shares the
 * `<system-reminder>` envelope and is told apart by its `producer` attribute.
 * The exclusion therefore names the envelope TOGETHER WITH the producer whose
 * items are excluded — naming the envelope alone would exclude every producer's
 * items indiscriminately, and a `<chat-recency-update>` that no longer exists
 * would silently exclude nothing, which is the defect this paragraph exists to
 * prevent.
 *
 * Costs no cache. This is part of the trailing instruction — the FINAL USER
 * MESSAGE, already outside the byte-identical prefix. Stripping the block from
 * the replayed system prompt would work too and is rejected: that changes the
 * prefix and makes the whole (deliberately large) call cold.
 *
 * The sentence is literal text in `prompts/instruction.md`: the exclusion
 * stays in the packaged trailing instruction, and the test pins it verbatim.
 */
const renderCompactionInstructionTemplate = loadPackagedTemplate<
  Record<string, never>
>(__dirname, 'instruction');

export const COMPACTION_INSTRUCTION = renderCompactionInstructionTemplate({});

/** Accept only non-empty text from a compaction inference. */
export function normalizeCompactionSummary(value: unknown): string | null {
  if (!isString(value)) {
    return null;
  }
  const summary = value.trim();
  return summary.length > 0 ? summary : null;
}

/**
 * Chars/4 over a built request projection, with each replayed reasoning part's
 * opaque `providerOptions` left out (D15): that value is provider metadata
 * llame never interprets, and on the Responses wire it is a base64 blob of the
 * provider's own reasoning — potentially far larger than the prompt — so it
 * must not size the continuation estimate (D16). Reasoning TEXT still counts:
 * the model re-reads it on that continuation.
 */
function estimateProjectionTokens(projection: {
  system: string;
  messages: Array<ModelMessage>;
  tools: ReadonlyArray<ModelToolDeclaration>;
}): number {
  const sized = projection.messages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === 'reasoning' ? { type: part.type, text: part.text } : part,
      ),
    };
  });
  return Math.ceil(
    JSON.stringify({
      system: projection.system,
      messages: sized,
      tools: projection.tools,
    }).length / 4,
  );
}

/**
 * The estimate of everything a prepared request adds on top of a counted
 * measurement: the stored rows after the counted reply, plus the attempt's
 * staged rail text (which the persisted rows do not carry yet — rail items are
 * stored on the user message when the request dispatches). The counted
 * reply's own request is already measured by the provider's number, so the
 * system prompt and tool declarations are deliberately left out here.
 */
export function estimateContinuationTokens(input: {
  rows: Array<StoredMessage>;
  railText: string;
}): number {
  const { messages } = buildContext(input.rows, {
    systemPrompt: '',
    requestKind: 'continuation',
  });
  return (
    estimateProjectionTokens({ system: '', messages, tools: [] }) +
    Math.ceil(input.railText.length / 4)
  );
}

/**
 * The persisted final-request context size of the reply to the previous
 * completed Run, when that reply is one this trigger may measure (design D4).
 *
 * The comparison is by the user turn the reply answers, not by the reply's own
 * sequence: a retried assistant row is rewritten in place and keeps a sequence
 * below a checkpoint published between its attempts, and a measurement taken
 * before that checkpoint describes the request the checkpoint already shrank.
 * An absent, unfinished, or unstamped reply yields no measurement, and the
 * caller then estimates the whole request instead.
 */
export function countedContextTokens(input: {
  previousCompleted:
    | {
        readonly messageId: string | null;
        readonly triggeringUserSeq: number;
      }
    | undefined;
  rows: ReadonlyArray<Message>;
  boundarySeq: number;
}): { readonly replySeq: number; readonly contextTokens: number } | undefined {
  const previous = input.previousCompleted;
  if (
    previous === undefined ||
    previous.messageId === null ||
    previous.triggeringUserSeq <= input.boundarySeq
  ) {
    return undefined;
  }
  const reply = input.rows.find(
    (row) => row.role === 'assistant' && row.inReplyTo === previous.messageId,
  );
  if (reply === undefined) {
    return undefined;
  }
  const usage = reply.usage;
  const contextTokens =
    isRecord(usage) &&
    isNumber(usage.contextTokens) &&
    Number.isFinite(usage.contextTokens) &&
    usage.contextTokens >= 0
      ? usage.contextTokens
      : undefined;
  return contextTokens === undefined
    ? undefined
    : { replySeq: reply.seq, contextTokens };
}

/**
 * Provider-neutral preflight estimate for the complete top-level request.
 * JSON serialization deliberately includes role/tool/schema framing instead
 * of counting only visible text, but excludes replayed opaque provider
 * metadata (see estimateProjectionTokens). It remains an estimate; reserving
 * configured output tokens supplies the safety boundary used for admission.
 */
export function estimateModelRequestTokens(input: {
  system: string;
  messages: Array<ModelMessage>;
  toolDeclarations: ReadonlyArray<ModelToolDeclaration>;
}): number {
  return estimateProjectionTokens({
    system: input.system,
    messages: input.messages,
    tools: input.toolDeclarations,
  });
}

export function requestFitsContextWindow(input: {
  system: string;
  messages: Array<ModelMessage>;
  toolDeclarations: ReadonlyArray<ModelToolDeclaration>;
  contextWindowTokens: number;
  reservedOutputTokens: number | null;
}): boolean {
  return (
    estimateModelRequestTokens(input) + (input.reservedOutputTokens ?? 0) <=
    input.contextWindowTokens
  );
}

/**
 * Resolve the trigger threshold (providers-and-models-as-code, #167).
 * Precedence:
 * 1. explicitThresholdTokens — the model's own `compactionThresholdTokens`
 *    config override, carried on the executing client (evals/tests set it
 *    low to exercise compaction cheaply);
 * 2. contextWindowTokens × COMPACTION_WINDOW_RATIO — the model's context
 *    window, carried on the executing client. The window is a required field
 *    on every model, so there is no unknown-window fallback.
 * There is no instance-level override — compaction is model-driven, never an
 * instance knob.
 */
export function resolveCompactionThreshold(input: {
  explicitThresholdTokens?: number;
  contextWindowTokens: number;
}): number {
  if (isPositiveFinite(input.explicitThresholdTokens)) {
    return input.explicitThresholdTokens;
  }

  return Math.floor(input.contextWindowTokens * COMPACTION_WINDOW_RATIO);
}

/** Shared "usable positive number" predicate for thresholds and env overrides. */
export function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

export interface CompactionPlan {
  /** The new compaction supersedes every message with seq <= uptoSeq. */
  uptoSeq: number;
  /** The turns being absorbed into the summary (oldest→newest). */
  absorb: Array<StoredMessage>;
}

/**
 * What one pre-step publication absorbs (design D4): every user/assistant row
 * between the active checkpoint's boundary and the triggering user message,
 * which is never itself absorbed. An empty range publishes nothing — a retry
 * whose estimate is still over the threshold must proceed on the checkpoint it
 * already has rather than summarize nothing.
 */
export function planCompactionCheckpoint(input: {
  rows: ReadonlyArray<StoredMessage>;
  /** The active checkpoint's absorbed-through sequence; 0 when there is none. */
  boundarySeq: number;
  triggeringUserSeq: number;
}): CompactionPlan | null {
  const absorb = input.rows
    .filter(
      (row) =>
        (row.role === 'user' || row.role === 'assistant') &&
        row.seq > input.boundarySeq &&
        row.seq < input.triggeringUserSeq,
    )
    .sort((a, b) => a.seq - b.seq);
  const last = absorb.at(-1);
  return last === undefined ? null : { uptoSeq: last.seq, absorb };
}

/**
 * Build the summarization model request as a CACHE-ALIGNED continuation of the
 * chat itself, not a fresh prompt:
 *
 * - `system` is the prompt of the run whose prefix this request reproduces
 *   (passed by the caller), NOT a dedicated summarizer prompt;
 * - the previous checkpoint's stored text and the absorbed turns are replayed
 *   through the SAME buildContext path the live turn used, so the request
 *   preserves the byte-identical stored prefix that populated the provider's
 *   prompt cache;
 * - the summarize instruction rides as the final user message. Both trigger
 *   paths use the same instruction; the variant only selects the model inputs
 *   assembled by CompactionService.
 *
 * With OpenAI-style strict-prefix caching this makes the absorbed bulk (the
 * expensive part — up to the whole threshold) a cache read instead of a fresh
 * prefill; a swapped system prompt would invalidate the entire prefix.
 */
export function buildCompactionRequest(input: {
  system: string;
  previous: ContextCheckpoint | undefined;
  absorb: Array<StoredMessage>;
}): ModelRequestContext {
  const { system, messages } = buildContext(input.absorb, {
    systemPrompt: input.system,
    // Summarization input, not a continuation: reasoning the absorbed turns
    // persisted must not be folded into the checkpoint (D16).
    requestKind: 'compaction',
    ...(input.previous !== undefined && { checkpoint: input.previous }),
  });

  messages.push({
    role: 'user',
    content: COMPACTION_INSTRUCTION,
  });

  return { system, messages };
}
