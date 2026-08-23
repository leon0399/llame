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

import type { ModelMessage } from 'ai';

import { type RunContextItem } from '../db/schema/chats';
import {
  assembleUserContent,
  isContextItemPart,
  orderContextItems,
  renderContextItem,
  type ContextItemPart,
} from './context-item';
import {
  COMPACTION_CHECKPOINT_FORM,
  renderCompactionCheckpoint,
  renderContextItemPart,
} from './context-item-producers';
import { resolveForm } from './context-item';
import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { type UnknownRecord } from '@workspace/harness';
import {
  projectCompactionToolObservationLedger,
  projectToolObservations,
  renderToolObservationOmission,
  type ToolObservationProjection,
} from './tool-observation-part';

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
  parts: MessagePart[];
  attachments: unknown[];
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
  /** Internal, versioned JSONB. Runtime-validated before model replay. */
  toolObservationLedger?: unknown;
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
export function partsToText(parts: readonly unknown[]): string {
  return parts
    .flatMap((part) => (isTextPart(part) ? [part.text] : []))
    .join('\n');
}

/** What a provider request needs: the stable prefix plus history. */
export interface ModelRequestContext {
  system: string;
  messages: ModelMessage[];
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
  contextItems: RunContextItem[];
}

/**
 * Render every context item on a message, in the rail's fixed producer
 * precedence order, preserving emission order within one producer.
 *
 * A part this reader cannot interpret — an unrecognized producer, or a payload
 * failing its producer's validation — contributes nothing rather than being
 * emitted as opaque content.
 */
function renderContextItems(parts: readonly MessagePart[]): RunContextItem[] {
  const items = parts.filter((part): part is ContextItemPart =>
    isContextItemPart(part),
  );
  return orderContextItems(
    items.map((part) => ({ producer: part.data.producer, part })),
  ).map(({ producer, part }) => {
    const text = renderContextItemPart(part);
    const form = resolveForm(part);
    return {
      producer,
      ...(form !== undefined && { form }),
      residency: 'rail' as const,
      // An item this reader cannot interpret renders as nothing but is still
      // recorded, with empty text marking what was dropped. Omitting it would
      // turn a declared fail-closed omission into an undetectable loss — the
      // opposite of what the record is for.
      text: text ?? '',
    };
  });
}

function pushCompactionToolObservations(
  result: ModelMessage[],
  projection: ToolObservationProjection,
): void {
  if (projection.omittedCount > 0) {
    result.push({
      role: 'assistant',
      content: renderToolObservationOmission(projection.omittedCount),
    });
  }
  for (const pair of projection.pairs) {
    result.push({ role: 'assistant', content: [pair.toolCallPart] });
    result.push({ role: 'tool', content: [pair.toolResultPart] });
  }
}

function pushAssistantHistory(
  result: ModelMessage[],
  parts: MessagePart[],
  projection: ToolObservationProjection,
): void {
  const pairsByPartIndex = new Map(
    projection.pairs.map((pair) => [pair.partIndex, pair]),
  );
  const pendingText: string[] = [];
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

  for (const [partIndex, part] of parts.entries()) {
    appendOmissionWhenDue(partIndex);
    if (isTextPart(part)) {
      pendingText.push(part.text);
      continue;
    }

    const pair = pairsByPartIndex.get(partIndex);
    if (!pair) continue;
    flushPendingText();
    result.push({ role: 'assistant', content: [pair.toolCallPart] });
    result.push({ role: 'tool', content: [pair.toolResultPart] });
  }

  appendOmissionWhenDue(Number.POSITIVE_INFINITY);
  flushPendingText();
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
      .filter(
        (m): m is StoredMessage & { senderUserId: string } =>
          m.role === 'user' && m.senderUserId !== null,
      )
      .map((m) => m.senderUserId),
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
      m.role !== 'tool' &&
      (compaction === undefined || m.seq > compaction.uptoSeq),
  );

  // Deterministic order: sort by seq (monotonic insertion order) even if the
  // caller passed an unsorted array. seq (not createdAt) because same-transaction
  // messages share created_at — see messages.seq in the schema.
  const ordered = [...history].sort((a, b) => a.seq - b.seq);

  const result: ModelMessage[] = [];
  const contextItems: RunContextItem[] = [];

  // The summary leads the history — the stand-in for everything it superseded.
  if (compaction !== undefined) {
    const checkpoint = renderConversationCheckpoint(compaction.summary);
    result.push({ role: 'user', content: checkpoint });
    // Recorded like any other item: it is bind-time, so unlike a
    // persisted-derived item it cannot be reconstructed from anything later.
    contextItems.push({
      producer: 'compaction',
      form: COMPACTION_CHECKPOINT_FORM,
      residency: 'rail',
      text: checkpoint,
    });
    const compactedObservations = projectCompactionToolObservationLedger(
      compaction.toolObservationLedger,
    );
    if (compactedObservations) {
      pushCompactionToolObservations(result, compactedObservations);
    }
  }

  for (const m of ordered) {
    const visibleText = partsToText(m.parts);
    const projected =
      m.role === 'assistant' ? projectToolObservations(m.parts) : null;

    if (visibleText.length === 0 && !projected) {
      continue;
    }

    // Sender attribution prefixes the USER's own text, never the injected
    // items above it: an item is not authored by that sender, and attributing
    // it to one would be the exact confusion the envelope exists to prevent.
    const attributedText =
      multiSender && m.role === 'user' && m.senderUserId !== null
        ? `[${m.senderUserId}] ${visibleText}`
        : visibleText;

    if (m.role === 'user') {
      const items = renderContextItems(m.parts);
      contextItems.push(...items);
      const renderedItems = items.flatMap((item) =>
        item.text.length > 0 ? [item.text] : [],
      );
      // User-authored text is neutralized on the way into model context so it
      // cannot emit a reserved delimiter and forge an item beside the genuine
      // ones. The stored message is untouched.
      const content = assembleUserContent({
        renderedItems,
        visibleText: sanitizeAuthoredText(attributedText),
      });
      result.push({ role: 'user', content });
    } else if (projected) {
      pushAssistantHistory(result, m.parts, projected);
    } else {
      // Assistant output is replayed byte-identically and never neutralized: a
      // model does not treat its own prior turns as authoritative, and llame's
      // users legitimately discuss llame's own envelope, which neutralization
      // would corrupt.
      result.push({ role: 'assistant', content: attributedText });
    }
  }

  return { system: systemPrompt, messages: result, contextItems };
}
