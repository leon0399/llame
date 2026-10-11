/**
 * ContextBuilder — turns a chat's stored messages into the model input ({ system, messages }).
 *
 * Design contract (#53 context assembly; #57 lineage-based compaction):
 * - Cache-aware: `system` is the stable prefix, delivered via the model's native system
 *   channel — not a `role: 'system'` entry in `messages`; `messages` is history oldest→newest
 * - `system` contains NO timestamps, ids, or per-request values — byte-identical across turns
 * - Stored user text/context parts replay in place without sender decoration
 * - Persisted reasoning parts replay ONLY into a request that continues the
 *   Chat storing them (D15); compaction input excludes them (D16)
 * - Deterministic: identical inputs → identical output
 * - No message-count cap: context size is governed in TOKENS by the compaction
 *   threshold (#57). A count cap would silently drop old turns without any
 *   summary covering them whenever many short messages stay under the token
 *   threshold — lineage-less memory loss.
 */

import type { AssistantContent, ModelMessage, ProviderMetadata } from 'ai';

import { isContextItemPart, type ContextItemPart } from './context-item';
import type { UnknownRecord } from '@workspace/runtime-safety';
import {
  projectToolObservations,
  renderToolObservationOmission,
  type ProjectedToolObservationPair,
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
 * A reasoning ("thinking") part. PERSISTED for display (survives reload) and
 * replayed to the provider on the ONE request kind that reuses it: a
 * continuation of the Chat that stores it. `buildContext` re-emits it as a
 * reasoning content part ahead of the content the same turn produced, with the
 * text byte-identical to the stored part (never trimmed, repaired, re-ordered,
 * or neutralized) — DeepSeek's `tools` rule makes that replay mandatory on the
 * completions wire (D7/D15). Everywhere else the exclusion stands: `partsToText`
 * still strips reasoning, so compaction input, chat search, and public shares
 * never carry it.
 */
export interface ReasoningPart {
  type: 'reasoning';
  text: string;
  /**
   * Opaque provider metadata the adapter attached to this part (D15), stored
   * verbatim beside the text. llame never reads a key inside it: the
   * continuation passes the value through unchanged as the emitted content
   * part's `providerOptions`, so the wire that produced the part recognizes it
   * again — and a wire that cannot represent it ignores or rejects it under
   * the existing failure contract. Absent when the adapter supplied none, and
   * it changes neither the part's display text nor its order.
   */
  providerMetadata?: ProviderMetadata;
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

/** Duck-typed like `isTextPart`: `parts` is jsonb with no runtime validation. */
function isReasoningPart(part: unknown): part is ReasoningPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'reasoning' &&
    'text' in part &&
    typeof part.text === 'string'
  );
}

/**
 * A stored `data-context` part with text is model-bearing content of its own:
 * replay emits it as a user-role message, unlike a metadata-only or empty one.
 */
function hasModelContextText(part: MessagePart): boolean {
  return isContextItemPart(part) && !!part.data.text;
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
  role: 'user' | 'assistant' | 'system' | 'tool' | 'checkpoint';
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
 * A persisted checkpoint selected for replay. The text is read from the
 * checkpoint row once, then emitted literally; replay never re-renders it.
 */
export interface ContextCheckpoint {
  text: string;
  absorbedThroughSeq: number;
}

/**
 * What the built request is for (D16). Replaying a Chat's persisted reasoning
 * is a property of the request kind, not of the projection: a request that
 * continues the Chat carries its stored reasoning parts, while a request that
 * asks a model to summarize that history into a compaction carries none —
 * reasoning must not be folded into summary text that is no longer
 * provider-authorized.
 */
export type ContextRequestKind = 'continuation' | 'compaction';

export interface BuildContextOptions {
  systemPrompt: string;
  /**
   * Required, with no default: every caller states whether this request
   * continues the Chat (reasoning replays) or summarizes it (reasoning is
   * excluded), so a new caller cannot inherit a silent choice (D16).
   */
  requestKind: ContextRequestKind;
  /** The active checkpoint for this request, if any. */
  checkpoint?: ContextCheckpoint;
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

/**
 * A user turn's model-facing content: its text and the text of its context
 * items, in stored order. Exported for the run worker, which sets the
 * triggering message's content from the parts its dispatch stored.
 */
export function userPartsToModelContent(
  parts: ReadonlyArray<unknown>,
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

/**
 * The SDK's prompt-side reasoning content part, derived from `ModelMessage` so
 * this file cannot drift from the SDK's part vocabulary. Names the byte-level
 * distinction the persisted `ReasoningPart` crosses at replay: the stored
 * `providerMetadata` becomes this part's `providerOptions`, unreshaped.
 */
type PromptReasoningPart = Extract<
  Extract<AssistantContent, ReadonlyArray<unknown>>[number],
  { type: 'reasoning' }
>;

/**
 * Batches consecutive text parts into one assistant message and inserts the
 * omission notice at the right point in the stream — the running state
 * `pushAssistantHistory` below drives while walking `parts` in order.
 *
 * On a continuation request the emitter also carries each persisted reasoning
 * part through in its stored position: reasoning is buffered and emitted ahead
 * of the next assistant content the same turn produces (text, tool call, or
 * omission notice), and a turn ending on reasoning flushes it as its own
 * assistant message. Reasoning text is passed through byte-identically, with
 * the part's opaque provider metadata riding along as `providerOptions`.
 */
class AssistantHistoryEmitter {
  private readonly pendingText: Array<string> = [];
  private readonly pendingReasoning: Array<PromptReasoningPart> = [];
  private omissionRendered = false;

  constructor(
    private readonly result: Array<ModelMessage>,
    private readonly projection: ToolObservationProjection | null,
  ) {}

  appendText(text: string): void {
    this.pendingText.push(text);
  }

  appendReasoning(part: PromptReasoningPart): void {
    this.pendingReasoning.push(part);
  }

  flushPendingText(): void {
    const text = this.pendingText.join('\n');
    this.pendingText.length = 0;
    if (text.length > 0) {
      this.pushAssistantText(text);
    }
  }

  flushPendingToolPair(pair: ProjectedToolObservationPair): void {
    const reasoning = this.takePendingReasoning();
    this.result.push(
      reasoning.length === 0
        ? { role: 'assistant', content: [pair.toolCallPart] }
        : { role: 'assistant', content: [...reasoning, pair.toolCallPart] },
      { role: 'tool', content: [pair.toolResultPart] },
    );
  }

  flushPendingReasoning(): void {
    if (this.pendingReasoning.length === 0) return;
    this.result.push({
      role: 'assistant',
      content: this.takePendingReasoning(),
    });
  }

  /**
   * An item stored on the assistant message replays as its own user-role
   * message at the stored position: the walk has already flushed the tool pair
   * (or its omission notice) the item follows, so anything still pending here
   * belongs before it. An item without text contributes nothing.
   */
  appendContextItem(text: string | undefined): void {
    if (!text) return;
    this.flushPendingText();
    this.flushPendingReasoning();
    this.result.push({ role: 'user', content: [{ type: 'text', text }] });
  }

  appendOmissionWhenDue(partIndex: number): void {
    const { projection } = this;
    if (
      projection === null ||
      this.omissionRendered ||
      projection.omissionPartIndex === null ||
      projection.omissionPartIndex > partIndex
    ) {
      return;
    }
    this.flushPendingText();
    this.pushAssistantText(
      renderToolObservationOmission(projection.omittedCount),
    );
    this.omissionRendered = true;
  }

  private takePendingReasoning(): Array<PromptReasoningPart> {
    const reasoning = [...this.pendingReasoning];
    this.pendingReasoning.length = 0;
    return reasoning;
  }

  /**
   * Every assistant text message takes the reasoning collected ahead of it, so
   * the stored order of reasoning against text and tool calls holds.
   */
  private pushAssistantText(text: string): void {
    const reasoning = this.takePendingReasoning();
    this.result.push(
      reasoning.length === 0
        ? { role: 'assistant', content: text }
        : {
            role: 'assistant',
            content: [...reasoning, { type: 'text' as const, text }],
          },
    );
  }
}

function pushAssistantHistory(
  result: Array<ModelMessage>,
  parts: Array<MessagePart>,
  projection: ToolObservationProjection | null,
  requestKind: ContextRequestKind,
): void {
  // TODO(#599): Research canonical AI SDK UIMessage persistence before replacing
  // this projector; stored assistant parts currently omit multi-step boundaries.
  const pairsByPartIndex = new Map(
    (projection?.pairs ?? []).map((pair) => [pair.partIndex, pair]),
  );
  const emitter = new AssistantHistoryEmitter(result, projection);

  for (const [partIndex, part] of parts.entries()) {
    emitter.appendOmissionWhenDue(partIndex);
    if (isTextPart(part)) {
      emitter.appendText(part.text);
      continue;
    }
    if (isReasoningPart(part)) {
      // Text recorded before the reasoning flushes first: the reasoning part
      // belongs in its stored position, not hoisted or pushed behind it.
      if (requestKind === 'continuation') {
        emitter.flushPendingText();
        // The part's opaque provider metadata (D15) crosses unchanged as the
        // prompt part's `providerOptions`; llame reads no key inside it. A
        // part without metadata emits the bare part — no undefined key.
        const providerOptions = part.providerMetadata;
        emitter.appendReasoning({
          type: 'reasoning',
          text: part.text,
          ...(providerOptions !== undefined && { providerOptions }),
        });
      }
      continue;
    }
    const pair = pairsByPartIndex.get(partIndex);
    if (pair) {
      emitter.flushPendingText();
      emitter.flushPendingToolPair(pair);
    } else if (isContextItemPart(part)) {
      emitter.appendContextItem(part.data.text);
    }
  }

  emitter.appendOmissionWhenDue(Number.POSITIVE_INFINITY);
  emitter.flushPendingText();
  emitter.flushPendingReasoning();
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
): ModelRequestContext {
  const { systemPrompt, checkpoint, requestKind } = options;

  // Checkpoint rows are storage-only markers. The selected checkpoint is
  // represented by its stored literal text below; every other checkpoint row
  // is skipped and can never fall through the assistant branch.
  const history = messages.filter(
    (m) =>
      m.role !== 'system' &&
      m.role !== 'tool' &&
      m.role !== 'checkpoint' &&
      (checkpoint === undefined || m.seq > checkpoint.absorbedThroughSeq),
  );

  // Deterministic order: sort by seq (monotonic insertion order) even if the
  // caller passed an unsorted array. seq (not createdAt) because same-transaction
  // messages share created_at — see messages.seq in the schema.
  const ordered = [...history].sort((a, b) => a.seq - b.seq);

  const result: Array<ModelMessage> = [];

  if (checkpoint !== undefined) {
    result.push({
      role: 'user',
      content: [{ type: 'text', text: checkpoint.text }],
    });
  }

  for (const m of ordered) {
    if (m.role === 'user') {
      appendUserMessage(result, m);
    } else {
      appendAssistantMessage(result, m, requestKind);
    }
  }

  return { system: systemPrompt, messages: result };
}

function appendUserMessage(
  result: Array<ModelMessage>,
  m: StoredMessage,
): void {
  const content = userPartsToModelContent(m.parts);
  if (content.length > 0) {
    result.push({ role: 'user', content });
  }
}

function appendAssistantMessage(
  result: Array<ModelMessage>,
  m: StoredMessage,
  requestKind: ContextRequestKind,
): void {
  const visibleText = partsToText(m.parts);
  const projected =
    m.role === 'assistant' ? projectToolObservations(m.parts) : null;
  // The one reuse of persisted reasoning: a request continuing this Chat
  // re-sends the turn's reasoning where it occurred (D15). A compaction
  // request summarizes the same turns with no reasoning in reach (D16).
  const hasReasoning =
    requestKind === 'continuation' && m.parts.some(isReasoningPart);
  const hasContextText = m.parts.some(hasModelContextText);

  if (
    visibleText.length === 0 &&
    !projected &&
    !hasReasoning &&
    !hasContextText
  ) {
    return;
  }

  if (projected || hasReasoning || hasContextText) {
    pushAssistantHistory(result, m.parts, projected, requestKind);
    return;
  }

  // Assistant output is replayed byte-identically and never neutralized: a
  // model does not treat its own prior turns as authoritative, and llame's
  // users legitimately discuss llame's own envelope, which neutralization
  // would corrupt.
  result.push({ role: 'assistant', content: visibleText });
}
