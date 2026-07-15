/**
 * ContextBuilder — turns a chat's stored messages into the model input ({ system, messages }).
 *
 * Design contract (#53 context assembly; #57 lineage-based compaction):
 * - Cache-aware: `system` is the stable prefix, delivered via the model's native system
 *   channel — not a `role: 'system'` entry in `messages`; `messages` is history oldest→newest
 * - `system` contains NO timestamps, ids, or per-request values — byte-identical across turns
 * - Sender attribution prefix applied when >1 distinct senderUserId in the chat
 * - Deterministic: identical inputs → identical output
 * - No message-count cap: context size is governed in TOKENS by the compaction
 *   threshold (#57). A count cap would silently drop old turns without any
 *   summary covering them whenever many short messages stay under the token
 *   threshold — lineage-less memory loss.
 */

/** AI SDK v5 UIMessage part shape (text part — the common case). */
export interface TextPart {
  type: 'text';
  text: string;
}

/**
 * A reasoning ("thinking") part. PERSISTED for display (survives reload) but
 * NEVER re-fed to the model — `partsToText` strips it (see below), preserving
 * the original "reasoning is never re-fed" guarantee.
 */
export interface ReasoningPart {
  type: 'reasoning';
  text: string;
}

/** Union of AI SDK v5 UIMessage parts. Extend as more part types are added. */
export type MessagePart = TextPart | ReasoningPart | Record<string, unknown>;

/** True for a reasoning part — the one part type kept OUT of model context. */
/**
 * Display-only parts stripped from model context on replay, exactly like
 * reasoning: a `tool-<name>` activity part or the `data-cap-notice` marker.
 * The model already saw tool results inline while the run's own loop executed
 * (AI SDK feeds them back live); the persisted parts are a UI record. Without
 * this strip, `partsToText` would `JSON.stringify` a tool result — including
 * other chats' snippets surfaced by search_conversations — into a
 * `role:'assistant'` history entry re-fed on every later turn AND into
 * compaction summaries, presenting tool observations as the model's own prior
 * output and re-exposing any injected content as authoritative text (D8).
 */
function isDisplayOnlyPart(part: MessagePart): boolean {
  if (typeof part !== 'object' || part === null || !('type' in part)) {
    return false;
  }
  const type = part.type;
  return (
    type === 'reasoning' ||
    type === 'data-cap-notice' ||
    (typeof type === 'string' && type.startsWith('tool-'))
  );
}

/** The single source of the text-part shape check — reused by the context
 * builder and the chat-list excerpt mapper so the duck-typing can't drift. */
export function isTextPart(part: unknown): part is TextPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'text' &&
    'text' in part &&
    typeof part.text === 'string'
  );
}

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
 * parts instead of being stringified by `partsToText`. Display-only parts
 * (reasoning, tool activity, cap notice) are stripped by `partsToText`, so
 * flattening the remaining text loses nothing today.
 */
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

/**
 * A compaction summary to fold into the context (#57). Supersedes every stored
 * message with seq <= uptoSeq; buildContext renders it as the leading history
 * entry (role 'user') so the system prompt stays byte-identical across turns
 * (prompt-cache contract) and no `role: 'system'` entry enters `messages`
 * (AI SDK v6 rejects those).
 */
export interface ContextCompaction {
  summary: string;
  uptoSeq: number;
}

export interface BuildContextOptions {
  systemPrompt: string;
  /** Latest compaction for the chat, if any (#57). */
  compaction?: ContextCompaction;
}

/**
 * Frames the summary as recalled context, clearly delimited from live user input.
 * Server-authored (trusted) — but rendered as history data, not system instruction.
 */
export const COMPACTION_SUMMARY_HEADER =
  'Summary of the earlier conversation (older turns were compacted):';

/**
 * Extracts the text content from an AI SDK v5 UIMessage parts array.
 * Non-text parts are serialised as JSON so nothing is silently dropped.
 * Exported for the compaction planner (#57), which renders absorbed turns.
 */
export function partsToText(parts: MessagePart[]): string {
  return (
    parts
      // Strip display-only parts (reasoning, tool activity, cap notice) so they
      // never re-enter model context or a compaction summary — compaction also
      // calls partsToText. Keeps the "display-only parts are never re-fed"
      // guarantee (see isDisplayOnlyPart).
      .filter((p) => !isDisplayOnlyPart(p))
      .map((p) => (isTextPart(p) ? p.text : JSON.stringify(p)))
      .join('\n')
  );
}

export interface BuiltContext {
  /** The static system prompt, delivered via the model provider's native system channel
   * (not as a message in `messages`) — byte-identical across turns, prompt-cache-friendly. */
  system: string;
  /** History only — oldest→newest. No system entry. */
  messages: ModelMessage[];
}

/**
 * Build the model input from a chat's stored messages.
 *
 * `system` is always the static systemPrompt verbatim; `messages` is history only
 * (oldest→newest). Keeping system out of `messages` matches the AI SDK's
 * `system`/`instructions` channel and avoids relying on providers tolerating a
 * `role: 'system'` entry inside the messages array.
 */
export function buildContext(
  messages: StoredMessage[],
  options: BuildContextOptions,
): BuiltContext {
  const { systemPrompt, compaction } = options;

  // Determine if sender attribution is needed (>1 distinct human sender)
  const senderIds = new Set(
    messages
      .filter((m) => m.role === 'user' && m.senderUserId !== null)
      .map((m) => m.senderUserId as string),
  );
  const multiSender = senderIds.size > 1;

  // Exclude any stored system-role rows: `system` (above) is the only system
  // content this function emits — a persisted system-role row (none are written
  // today, but the schema's role union permits one) must not leak into `messages`.
  // A compaction supersedes everything at or before its uptoSeq (#57): those turns
  // are represented by the summary below, so they must not also appear verbatim.
  const history = messages.filter(
    (m) =>
      m.role !== 'system' &&
      (compaction === undefined || m.seq > compaction.uptoSeq),
  );

  // Deterministic order: sort by seq (monotonic insertion order) even if the
  // caller passed an unsorted array. seq (not createdAt) because same-transaction
  // messages share created_at — see messages.seq in the schema.
  const ordered = [...history].sort((a, b) => a.seq - b.seq);

  const result: ModelMessage[] = [];

  // The summary leads the history — the stand-in for everything it superseded.
  if (compaction !== undefined) {
    result.push({
      role: 'user',
      content: `${COMPACTION_SUMMARY_HEADER}\n${compaction.summary}`,
    });
  }

  for (const m of ordered) {
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

  return { system: systemPrompt, messages: result };
}

/** The chat system prompt — chat-domain configuration, consumed by the
 * run executor at context-assembly time. Tool-aware (MVP tool loop): the
 * model is told tools exist and when to use them, rather than told not to. */
export const CHAT_SYSTEM_PROMPT =
  'You are llame, a helpful assistant. Answer the latest user message directly ' +
  'and concisely. Use the provided tools when they help you answer accurately ' +
  '(for example, to get the current date or time, which you cannot otherwise ' +
  'know); when no tool is needed, answer from your own knowledge. Never claim ' +
  'to have taken an action or used a tool that you did not.';
