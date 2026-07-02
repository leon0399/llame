/**
 * Compaction planning (#57) — pure logic for lineage-based context compaction.
 *
 * When the estimated context approaches the token threshold, older turns are
 * absorbed into a summary row (`compactions` table) that supersedes them; the
 * ContextBuilder then assembles summary + recent turns. Messages are never
 * deleted or mutated — the summary row's uptoSeq/parentId keep the full history
 * auditable and rewindable (Hermes-style lineage, SPEC §2.1).
 *
 * This module is deliberately DB-free: the CompactionService orchestrates
 * (load → plan → model call → insert); everything decidable is decided here.
 */

import {
  partsToText,
  type ModelMessage,
  type StoredMessage,
} from './context-builder';

/**
 * Trigger threshold, in estimated tokens, at which a chat compacts — BEFORE the
 * model's context limit, not after a failure. Default assumes a ≥128k-token
 * window compacted with ample headroom; override with COMPACTION_TOKEN_THRESHOLD
 * (the eval suite (#58) sets it very low to exercise compaction cheaply).
 */
export const DEFAULT_COMPACTION_TOKEN_THRESHOLD = 100_000;

/** Recent turns always kept verbatim so the model keeps fine-grained recency. */
export const DEFAULT_KEEP_RECENT_MESSAGES = 8;

/**
 * What the summary must preserve comes from #57: objective, constraints,
 * decisions, pending items — working state, not prose. Verbatim chatter drops.
 */
export const COMPACTION_SYSTEM_PROMPT =
  'You compact conversation history. Write a summary of the conversation that will ' +
  'replace the older turns in the model context of a future request. Preserve: the ' +
  "user's objectives, hard constraints and preferences, decisions made and why, " +
  'open questions and pending items, and any facts required to continue seamlessly. ' +
  'Drop greetings, filler, and verbatim chatter. Output only the summary as plain ' +
  'prose — no preamble, no headers.';

const SUMMARIZE_INSTRUCTION =
  'Summarize the conversation above now, following your instructions.';

const PREVIOUS_SUMMARY_HEADER =
  'Summary of the conversation before this point (from an earlier compaction):';

/**
 * Crude, deterministic, provider-independent token estimate (~4 chars/token).
 * Good enough for a trigger with generous headroom; the real guard is that the
 * threshold sits far below the context limit.
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
 * whole chat when none), oldest→newest. Returns null when under threshold or
 * when nothing precedes the keep-recent window.
 */
export function planCompaction(input: {
  history: StoredMessage[];
  previousSummary: string | undefined;
  thresholdTokens: number;
  keepRecentMessages: number;
}): CompactionPlan | null {
  const estimate = estimateContextTokens(input.history, input.previousSummary);
  if (estimate < input.thresholdTokens) {
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
 * Build the summarization model request. The previous summary (if any) leads the
 * input so re-compaction absorbs it — lineage loses nothing. Absorbed user and
 * assistant turns are replayed in their own roles; system rows are already
 * represented by `system`, and tool rows are flattened as user-visible context
 * because AI SDK tool-role messages require structured tool-result parts.
 */
export function buildCompactionRequest(input: {
  previousSummary: string | undefined;
  absorb: StoredMessage[];
}): { system: string; messages: ModelMessage[] } {
  const messages: ModelMessage[] = [];

  if (input.previousSummary !== undefined) {
    messages.push({
      role: 'user',
      content: `${PREVIOUS_SUMMARY_HEADER}\n${input.previousSummary}`,
    });
  }

  for (const m of input.absorb) {
    if (m.role === 'system') {
      continue;
    }

    messages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: partsToText(m.parts),
    });
  }

  messages.push({ role: 'user', content: SUMMARIZE_INSTRUCTION });

  return { system: COMPACTION_SYSTEM_PROMPT, messages };
}
