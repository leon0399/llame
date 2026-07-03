/**
 * Compaction planning (#57) — pure logic for lineage-based context compaction.
 *
 * When the live context approaches the token threshold, older turns are
 * absorbed into a summary row (`compactions` table) that supersedes them; the
 * ContextBuilder then assembles summary + recent turns. Compacted (absorbed)
 * messages are never deleted or mutated — the summary row's uptoSeq/parentId
 * keep the full history auditable and rewindable (Hermes-style lineage, SPEC
 * §2.1). (Regenerate may delete the newest assistant reply, which is by
 * definition still in the live window and never yet absorbed — so it never
 * touches compacted lineage.)
 *
 * This module is deliberately DB-free: the CompactionService orchestrates
 * (load → plan → model call → insert); everything decidable is decided here.
 */

import {
  buildContext,
  partsToText,
  type ModelMessage,
  type StoredMessage,
} from '../chats/context-builder';

/**
 * Fallback trigger threshold, in tokens, when neither an explicit threshold nor
 * the model's context window is configured. Conservative: safe for the common
 * 128k-token floor. See resolveCompactionThreshold for the full precedence.
 */
export const DEFAULT_COMPACTION_TOKEN_THRESHOLD = 100_000;

/**
 * When the model's context window is known (MODEL_CONTEXT_WINDOW_TOKENS),
 * compact at this fraction of it — the remaining headroom absorbs the next
 * turns, the model's output, and estimation error. Same shape as the
 * window-minus-reserve triggers in opencode / Claude Code / OpenClaw, expressed
 * as a ratio so it scales from 8k to 1M+ windows without retuning.
 */
export const COMPACTION_WINDOW_RATIO = 0.8;

/** Recent turns always kept verbatim so the model keeps fine-grained recency. */
export const DEFAULT_KEEP_RECENT_MESSAGES = 8;

/**
 * The summarize instruction — sent as the FINAL USER MESSAGE of the compaction
 * request, not as a system prompt. The request reuses the chat's own system
 * prompt and history rendering (see buildCompactionRequest), so its prefix is
 * byte-identical to the turn that just ran and the provider's prompt cache
 * (OpenAI-style strict prefix matching) covers the absorbed bulk; only this
 * trailing instruction is uncached. What the summary must preserve comes from
 * #57: objective, constraints, decisions, pending items — working state, not
 * prose.
 */
export const COMPACTION_INSTRUCTION =
  'Summarize the conversation above. The summary will replace these turns in the ' +
  'model context of a future request, so preserve: the ' +
  "user's objectives, hard constraints and preferences, decisions made and why, " +
  'open questions and pending items, and any facts required to continue seamlessly. ' +
  'If the conversation starts with an earlier summary, fold it in — nothing it ' +
  'preserves may be lost. Drop greetings, filler, and verbatim chatter. Output only ' +
  'the summary as plain prose — no preamble, no headers.';

/**
 * Crude, deterministic, provider-independent token estimate (~4 chars/token).
 * Fallback only: the trigger prefers the real usage reported for the turn that
 * just completed (see planCompaction.measuredContextTokens).
 */
export function estimateContextTokens(
  history: StoredMessage[],
  previousSummary: string | undefined,
): number {
  const historyChars = history.reduce(
    (sum, m) => sum + partsToText(m.parts).length,
    0,
  );
  const summaryChars = previousSummary?.length ?? 0;

  return Math.ceil((historyChars + summaryChars) / 4);
}

/**
 * Resolve the trigger threshold. Precedence:
 * 1. COMPACTION_TOKEN_THRESHOLD — explicit operator override (the eval suite
 *    sets it very low to exercise compaction cheaply);
 * 2. contextWindowTokens × COMPACTION_WINDOW_RATIO — the model's context
 *    window, resolved by the caller (operator env override, else the built-in
 *    model catalog — see CompactionService.thresholdTokens), so known models
 *    derive the threshold automatically;
 * 3. DEFAULT_COMPACTION_TOKEN_THRESHOLD (unknown model on some
 *    OpenAI-compatible endpoint, nothing configured).
 */
export function resolveCompactionThreshold(input: {
  explicitThresholdTokens?: number;
  contextWindowTokens?: number;
}): number {
  if (isPositiveFinite(input.explicitThresholdTokens)) {
    return input.explicitThresholdTokens;
  }

  if (isPositiveFinite(input.contextWindowTokens)) {
    return Math.floor(input.contextWindowTokens * COMPACTION_WINDOW_RATIO);
  }

  return DEFAULT_COMPACTION_TOKEN_THRESHOLD;
}

/** Shared "usable positive number" predicate for thresholds and env overrides. */
export function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

export interface CompactionPlan {
  /** The new compaction supersedes every message with seq <= uptoSeq. */
  uptoSeq: number;
  /** The turns being absorbed into the summary (oldest→newest). */
  absorb: StoredMessage[];
}

/**
 * Decide whether to compact and where to cut.
 *
 * `history` is the live window: messages AFTER the previous compaction (or the
 * whole chat when none), oldest→newest. `measuredContextTokens` is the real
 * total token usage the provider reported for the turn that just completed
 * (input + output ≈ the next request's prompt) — preferred over the char-based
 * estimate whenever present, matching how opencode/Claude Code/OpenClaw/Hermes
 * all trigger on real usage with an estimate fallback. Returns null when under
 * threshold or when nothing precedes the keep-recent window.
 */
export function planCompaction(input: {
  history: StoredMessage[];
  previousSummary: string | undefined;
  thresholdTokens: number;
  keepRecentMessages: number;
  measuredContextTokens?: number;
}): CompactionPlan | null {
  const contextTokens = isPositiveFinite(input.measuredContextTokens)
    ? input.measuredContextTokens
    : estimateContextTokens(input.history, input.previousSummary);
  if (contextTokens < input.thresholdTokens) {
    return null;
  }

  const ordered = [...input.history].sort((a, b) => a.seq - b.seq);
  const absorb = ordered.slice(
    0,
    Math.max(0, ordered.length - input.keepRecentMessages),
  );
  if (absorb.length === 0) {
    return null;
  }

  return { uptoSeq: absorb[absorb.length - 1].seq, absorb };
}

/**
 * Build the summarization model request as a CACHE-ALIGNED continuation of the
 * chat itself, not a fresh prompt:
 *
 * - `system` is the chat's own system prompt (passed by the caller — the exact
 *   string the just-finished turn used), NOT a dedicated summarizer prompt;
 * - the previous summary and absorbed turns are rendered through the SAME
 *   buildContext path the live turn used (same summary header, same part
 *   flattening, same ordering), so the request is a byte-identical prefix of
 *   the turn that just populated the provider's prompt cache;
 * - the summarize instruction rides as the final user message.
 *
 * With OpenAI-style strict-prefix caching this makes the absorbed bulk (the
 * expensive part — up to the whole threshold) a cache read instead of a fresh
 * prefill; a swapped system prompt would invalidate the entire prefix.
 * Compaction runs immediately after the turn (fire-and-forget), well inside
 * provider cache TTLs.
 *
 * Caveat: buildContext derives multi-sender attribution from the messages it is
 * given, so a chat whose extra senders appear only in the kept-recent window
 * could render absorb differently than the live turn did. Single-sender chats
 * (all of v0.1) are unaffected.
 */
export function buildCompactionRequest(input: {
  system: string;
  previous: { summary: string; uptoSeq: number } | undefined;
  absorb: StoredMessage[];
}): { system: string; messages: ModelMessage[] } {
  const { system, messages } = buildContext(input.absorb, {
    systemPrompt: input.system,
    ...(input.previous ? { compaction: input.previous } : {}),
  });

  messages.push({ role: 'user', content: COMPACTION_INSTRUCTION });

  return { system, messages };
}
