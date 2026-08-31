/**
 * ContextBuilder — turns a chat's stored messages into the model input ({ system, messages }).
 *
 * Design contract (#53 context assembly; #57 lineage-based compaction):
 * - Cache-aware: `system` is the stable prefix, delivered via the model's native system
 *   channel — not a `role: 'system'` entry in `messages`; `messages` is history oldest→newest
 * - `system` contains NO timestamps, ids, or per-request values — byte-identical across turns
 * - Stored user text/context parts replay in place without sender decoration
 * - Deterministic: identical inputs → identical output
 * - No message-count cap: context size is governed in TOKENS by the compaction
 *   threshold (#57). A count cap would silently drop old turns without any
 *   summary covering them whenever many short messages stay under the token
 *   threshold — lineage-less memory loss.
 */

import type {
  ModelMessage,
  ToolCallPart as SdkToolCallPart,
  ToolResultPart as SdkToolResultPart,
} from 'ai';

import {
  type CompactionReplacementMessage,
  type RunContextItem,
} from '../db/schema/chats';
import {
  isContextItemPart,
  renderContextItem,
  type ContextItemPart,
} from './context-item';
import {
  COMPACTION_CHECKPOINT_FORM,
  renderCompactionCheckpoint,
} from './context-item-producers';
import { resolveForm } from './context-item';
import type { UnknownRecord } from '../unknown-record';
import {
  projectToolObservations,
  type ToolObservationProjection,
} from './tool-observation-part';
import {
  isStoredReplacementToolPart,
  parseCompactionReplacementHistory,
  renderToolObservationOmission,
  type StoredReplacementToolPart,
} from './compaction-replacement-history';

export { projectToolObservations };
export type { ModelMessage };

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

/**
 * Stored chat-message parts: explicit server-authored variants plus the open
 * object fallback for other persisted AI SDK/provider/tool parts.
 */
export type MessagePart =
  | TextPart
  | ReasoningPart
  | ContextItemPart
  | UnknownRecord;

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
  parts: Array<MessagePart>;
  attachments: Array<unknown>;
  /** Durable assistant telemetry; transition compaction uses completed turns only. */
  usage?: unknown;
  createdAt: Date;
}

/**
 * `ModelMessage` is now the SDK's own type, re-exported above. Content can
 * carry text, tool-call parts (assistant), and tool-result parts (tool role),
 * so tool observations survive into later turns in the conventional
 * representation.
 */

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
  /** Required, message-shaped JSONB. Runtime-validated before model replay. */
  replacementHistory: unknown;
}

export interface BuildContextOptions {
  systemPrompt: string;
  /** Latest compaction for the chat, if any (#57). */
  compaction?: ContextCompaction;
}

/**
 * Frames the summary as recalled context, clearly delimited from live user input.
 * Server-authored (trusted) — but rendered as history data, not system instruction.
 *
 * The checkpoint renders through the same envelope as every other context
 * item, under `producer: 'compaction'` and the `checkpoint` form. Its storage
 * stays in `compactions`, whose `parentId` lineage and `uptoSeq` supersession
 * query cannot be expressed as a message part — but the model sees one
 * convention rather than a second delimiter making the same "treat as data"
 * claim in different words.
 */
export function renderConversationCheckpoint(summary: string): string {
  const rendered = renderContextItem({
    producer: 'compaction',
    form: COMPACTION_CHECKPOINT_FORM,
    body: renderCompactionCheckpoint(summary),
  });
  // `compaction` is a recognized producer, so the renderer's fail-closed branch
  // is unreachable here; throwing rather than emitting an empty checkpoint
  // keeps that a loud contradiction instead of a silently missing summary.
  if (rendered === null) {
    throw new TypeError('compaction is not a recognized context-item producer');
  }
  return rendered;
}

/**
 * Extracts the text content from an AI SDK v5 UIMessage parts array.
 * Only canonical visible text is portable across later model requests.
 * Exported for the compaction planner (#57), which renders absorbed turns.
 */
export function partsToText(parts: ReadonlyArray<unknown>): string {
  return parts
    .flatMap((part) => (isTextPart(part) ? [part.text] : []))
    .join('\n');
}

/** What a provider request needs: the stable prefix plus history. */
export interface ModelRequestContext {
  system: string;
  messages: Array<ModelMessage>;
}

export interface BuiltContext extends ModelRequestContext {
  /**
   * Every context item this build injected, as rendered.
   *
   * Returned rather than re-derivable: an item's wording is not reproducible
   * from its durable part once a renderer changes, and a bind-time item is not
   * reproducible at all — so the caller records this, and the record is the
   * authority for what the run injected.
   */
  contextItems: Array<RunContextItem>;
}

/**
 * Read every stored context item in place. Metadata is receipt-only here;
 * `data.text` is the sole model replay authority.
 */
function readContextItems(
  parts: ReadonlyArray<MessagePart>,
): Array<RunContextItem> {
  return parts
    .filter((part): part is ContextItemPart => isContextItemPart(part))
    .map((part) => {
      const producer = part.data.producer;
      const form = resolveForm(part);
      return {
        producer,
        ...(form !== undefined && { form }),
        residency: 'rail' as const,
        // Historical metadata-only and explicitly empty items remain visible
        // in receipts as inert entries; metadata never manufactures text.
        text: part.data.text ?? '',
      };
    });
}

function userPartsToModelContent(
  parts: ReadonlyArray<MessagePart>,
): Array<TextPart> {
  return parts.flatMap((part) => {
    if (isTextPart(part)) {
      return [{ type: 'text' as const, text: part.text }];
    }
    if (!isContextItemPart(part)) return [];
    const text = part.data.text;
    return text === undefined || text.length === 0
      ? []
      : [{ type: 'text' as const, text }];
  });
}

function replacementRecordToModelMessages(
  record: CompactionReplacementMessage,
): Array<ModelMessage> {
  const part = record.parts[0];
  if (record.role === 'user') {
    if (!isTextPart(part)) {
      throw new TypeError('Invalid compaction replacement history');
    }
    return [
      {
        role: 'user',
        content: [{ type: 'text', text: part.text }],
      },
    ];
  }

  if (isTextPart(part)) {
    return [
      {
        role: 'assistant',
        content: [{ type: 'text', text: part.text }],
      },
    ];
  }
  if (!isStoredReplacementToolPart(part)) {
    throw new TypeError('Invalid compaction replacement history');
  }
  return toolReplacementRecordToModelMessages(part);
}

/** Reconstruct the tool-call/tool-result message pair a stored replacement tool part represents. */
function toolReplacementRecordToModelMessages(
  part: StoredReplacementToolPart,
): Array<ModelMessage> {
  const toolName = part.type.slice('tool-'.length);
  const toolCallPart: SdkToolCallPart = {
    type: 'tool-call',
    toolCallId: part.toolCallId,
    toolName,
    input: part.input ?? {},
  };
  const toolResultPart: SdkToolResultPart = {
    type: 'tool-result',
    toolCallId: part.toolCallId,
    toolName,
    output: { type: 'text', value: part.output },
  };
  return [
    { role: 'assistant', content: [toolCallPart] },
    { role: 'tool', content: [toolResultPart] },
  ];
}

function appendCompactionReplacementHistory(
  result: Array<ModelMessage>,
  contextItems: Array<RunContextItem>,
  value: ContextCompaction['replacementHistory'],
): void {
  const replacementHistory = parseCompactionReplacementHistory(value);
  if (replacementHistory === null) {
    throw new TypeError('Invalid compaction replacement history');
  }

  for (const record of replacementHistory) {
    result.push(...replacementRecordToModelMessages(record));
  }

  const first = replacementHistory[0].parts[0];
  if (!isTextPart(first)) {
    throw new TypeError('Invalid compaction replacement history');
  }
  contextItems.push({
    producer: 'compaction',
    form: COMPACTION_CHECKPOINT_FORM,
    residency: 'rail',
    text: first.text,
  });
}

/**
 * Batches consecutive text parts into one assistant message and inserts the
 * omission notice at the right point in the stream — the running state
 * `pushAssistantHistory` below drives while walking `parts` in order.
 */
function createAssistantHistoryEmitter(
  result: Array<ModelMessage>,
  projection: ToolObservationProjection,
) {
  const pendingText: Array<string> = [];
  let omissionRendered = false;

  const flushPendingText = () => {
    const text = pendingText.join('\n');
    pendingText.length = 0;
    if (text.length > 0) {
      result.push({ role: 'assistant', content: text });
    }
  };

  const appendOmissionWhenDue = (partIndex: number) => {
    if (
      !omissionRendered &&
      projection.omissionPartIndex !== null &&
      projection.omissionPartIndex <= partIndex
    ) {
      flushPendingText();
      result.push({
        role: 'assistant',
        content: renderToolObservationOmission(projection.omittedCount),
      });
      omissionRendered = true;
    }
  };

  return { pendingText, flushPendingText, appendOmissionWhenDue };
}

function pushAssistantHistory(
  result: Array<ModelMessage>,
  parts: Array<MessagePart>,
  projection: ToolObservationProjection,
): void {
  // TODO(#599): Research canonical AI SDK UIMessage persistence before replacing
  // this projector; stored assistant parts currently omit multi-step boundaries.
  const pairsByPartIndex = new Map(
    projection.pairs.map((pair) => [pair.partIndex, pair]),
  );
  const emitter = createAssistantHistoryEmitter(result, projection);

  for (const [partIndex, part] of parts.entries()) {
    emitter.appendOmissionWhenDue(partIndex);
    if (isTextPart(part)) {
      emitter.pendingText.push(part.text);
      continue;
    }

    const pair = pairsByPartIndex.get(partIndex);
    if (!pair) continue;
    emitter.flushPendingText();
    result.push(
      { role: 'assistant', content: [pair.toolCallPart] },
      { role: 'tool', content: [pair.toolResultPart] },
    );
  }

  emitter.appendOmissionWhenDue(Number.POSITIVE_INFINITY);
  emitter.flushPendingText();
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
  messages: Array<StoredMessage>,
  options: BuildContextOptions,
): BuiltContext {
  const { systemPrompt, compaction } = options;

  // Exclude any stored system-role rows: `system` (above) is the only system
  // content this function emits — a persisted system-role row (none are written
  // today, but the schema's role union permits one) must not leak into `messages`.
  // A compaction supersedes everything at or before its uptoSeq (#57): those turns
  // are represented by the summary below, so they must not also appear verbatim.
  const history = messages.filter(
    (m) =>
      m.role !== 'system' &&
      m.role !== 'tool' &&
      (compaction === undefined || m.seq > compaction.uptoSeq),
  );

  // Deterministic order: sort by seq (monotonic insertion order) even if the
  // caller passed an unsorted array. seq (not createdAt) because same-transaction
  // messages share created_at — see messages.seq in the schema.
  const ordered = [...history].sort((a, b) => a.seq - b.seq);

  const result: Array<ModelMessage> = [];
  const contextItems: Array<RunContextItem> = [];

  // Stored replacement history leads the history — the complete application
  // replay replacement for everything it superseded. The raw summary is not a
  // replay authority and must never be rendered here.
  if (compaction !== undefined) {
    appendCompactionReplacementHistory(
      result,
      contextItems,
      compaction.replacementHistory,
    );
  }

  for (const m of ordered) {
    if (m.role === 'user') {
      appendUserMessage(result, contextItems, m);
    } else {
      appendAssistantMessage(result, m);
    }
  }

  return { system: systemPrompt, messages: result, contextItems };
}

function appendUserMessage(
  result: Array<ModelMessage>,
  contextItems: Array<RunContextItem>,
  m: StoredMessage,
): void {
  contextItems.push(...readContextItems(m.parts));
  const content = userPartsToModelContent(m.parts);
  if (content.length > 0) {
    result.push({ role: 'user', content });
  }
}

function appendAssistantMessage(
  result: Array<ModelMessage>,
  m: StoredMessage,
): void {
  const visibleText = partsToText(m.parts);
  const projected =
    m.role === 'assistant' ? projectToolObservations(m.parts) : null;

  if (visibleText.length === 0 && !projected) {
    return;
  }

  if (projected) {
    pushAssistantHistory(result, m.parts, projected);
  } else {
    // Assistant output is replayed byte-identically and never neutralized: a
    // model does not treat its own prior turns as authoritative, and llame's
    // users legitimately discuss llame's own envelope, which neutralization
    // would corrupt.
    result.push({ role: 'assistant', content: visibleText });
  }
}
