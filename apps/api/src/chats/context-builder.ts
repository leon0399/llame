/**
 * ContextBuilder — turns a chat's stored messages into the model input array.
 *
 * Design contract (SPEC §53):
 * - Cache-aware order: [stable system prefix] → [history oldest→newest]
 * - Stable prefix contains NO timestamps, ids, or per-request values — byte-identical across turns
 * - Sender attribution prefix applied when >1 distinct senderUserId in the chat
 * - Deterministic: identical inputs → identical output
 * - Hard cap (maxMessages) keeps most-recent-N messages within token budget
 *   Lineage-based compaction is issue #57.
 */

/** AI SDK v5 UIMessage part shape (text part — the common case). */
export interface TextPart {
  type: 'text';
  text: string;
}

/** Union of AI SDK v5 UIMessage parts. Extend as more part types are added. */
export type MessagePart = TextPart | Record<string, unknown>;

/**
 * The subset of a stored DB message that ContextBuilder needs.
 * Mirrors the `messages` table columns used here.
 */
export interface StoredMessage {
  id: string;
  chatId: string;
  // Monotonic insertion-order key (messages.seq). Used to order history
  // deterministically — created_at is the transaction timestamp and ties for
  // messages written in the same transaction.
  seq: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  senderUserId: string | null;
  parts: MessagePart[];
  attachments: unknown[];
  createdAt: Date;
}

/**
 * Minimal model message shape for v0.1.
 *
 * NOTE (v0.1 simplification): `content` is a flattened string. This is sufficient
 * for the text-only Q&A loop and is NOT the full AI SDK `ModelMessage`/`CoreMessage`
 * shape — assistant/tool messages there carry structured `content` arrays
 * (tool-call / tool-result parts). When the real model layer is wired in (#54),
 * this type aligns with the AI SDK and `assistant`/`tool` roles preserve structured
 * parts instead of being stringified by `partsToText`. No tools exist in v0.1, so
 * flattening loses nothing today.
 */
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface BuildContextOptions {
  systemPrompt: string;
  /**
   * Maximum number of messages to include (most-recent-N).
   * Hard cap: keeps the context within a token budget.
   * Default: 100. Lineage-based compaction is issue #57.
   */
  maxMessages?: number;
}

const DEFAULT_MAX_MESSAGES = 100;

/**
 * Extracts the text content from an AI SDK v5 UIMessage parts array.
 * Non-text parts are serialised as JSON so nothing is silently dropped.
 */
function partsToText(parts: MessagePart[]): string {
  return parts
    .map((p) => {
      if ('type' in p && p.type === 'text' && 'text' in p) {
        return (p as TextPart).text;
      }
      return JSON.stringify(p);
    })
    .join('\n');
}

/**
 * Build the model input array from a chat's stored messages.
 *
 * Order: [system] → [history oldest→newest (trimmed to maxMessages)]
 *
 * The system message is always first and contains ONLY the static systemPrompt
 * so it is byte-identical across turns and prompt-cache-friendly.
 */
export function buildContext(
  messages: StoredMessage[],
  options: BuildContextOptions,
): ModelMessage[] {
  const { systemPrompt, maxMessages = DEFAULT_MAX_MESSAGES } = options;

  // Determine if sender attribution is needed (>1 distinct human sender)
  const senderIds = new Set(
    messages
      .filter((m) => m.role === 'user' && m.senderUserId !== null)
      .map((m) => m.senderUserId as string),
  );
  const multiSender = senderIds.size > 1;

  // Deterministic order: sort by seq (monotonic insertion order) BEFORE trimming,
  // so the hard cap keeps the most-recent-N by conversation order even if the
  // caller passed an unsorted array. seq (not createdAt) because same-transaction
  // messages share created_at — see messages.seq in the schema.
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);

  // Apply hard cap: keep the most-recent N messages
  const trimmed =
    ordered.length > maxMessages
      ? ordered.slice(ordered.length - maxMessages)
      : ordered;

  // Build message array
  const result: ModelMessage[] = [
    // Stable system prefix — MUST contain no per-request data
    { role: 'system', content: systemPrompt },
  ];

  for (const m of trimmed) {
    const baseContent = partsToText(m.parts);

    let content: string;
    if (multiSender && m.role === 'user' && m.senderUserId !== null) {
      // Sender attribution: prefix with sender id so the model can attribute turns.
      // Content is treated as data, not instruction (SPEC §28.2 trust boundary).
      content = `[${m.senderUserId}] ${baseContent}`;
    } else {
      content = baseContent;
    }

    result.push({
      role: m.role === 'tool' ? 'tool' : m.role,
      content,
    });
  }

  return result;
}
