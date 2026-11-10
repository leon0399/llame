/**
 * ContextBuilder — turns a chat's stored messages into the model input ({ system, messages }).
 *
 * Design contract (#53 context assembly; #57 lineage-based compaction; D14
 * of exact-turn-replay):
 * - Cache-aware: `system` is the stable prefix, delivered via the model's native system
 *   channel — not a `role: 'system'` entry in `messages`; `messages` is history oldest→newest
 * - `system` contains NO timestamps, ids, or per-request values — byte-identical across turns
 * - Stored user text/context parts replay in place without sender decoration
 * - One projection turns a stored reply into the model messages the live loop
 *   sent: one assistant message per model step, then one tool message with the
 *   results of its calls. It clears nothing and drops no tool pair — a
 *   checkpoint is the only boundary.
 * - Persisted reasoning and provider metadata follow the model rule of
 *   `reasoning-output` (D7): they replay for the reply's own model after a
 *   completed reply.
 * - Deterministic: identical inputs → identical output
 * - No message-count cap: context size is governed in TOKENS by the compaction
 *   threshold (#57). A count cap would silently drop old turns without any
 *   summary covering them whenever many short messages stay under the token
 *   threshold — lineage-less memory loss.
 */

import type {
  AssistantContent,
  FilePart,
  ImagePart,
  ModelMessage,
  ProviderMetadata,
  ToolCallPart,
  ToolResultPart,
} from 'ai';

import type { RetainedMedia } from '../media/attempt-media';
import { mergeRetainedMedia } from '../media/attempt-media';
import { storedFilePartSchema } from '../media/media-descriptors';
import { parseMediaLocator } from '../media/media-locator';
import { storedToolPartMediaKey } from '../media/retained-media';
import { isContextItemPart, type ContextItemPart } from './context-item';
import { promptImportMediaParts } from './prompt-imports-item';
import {
  isNumber,
  isRecord,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import {
  projectStoredToolPart,
  type StoredToolObservation,
} from './tool-observation-part';

/**
 * `ModelMessage` is now the SDK's own type, re-exported above. Content can
 * carry text, tool-call parts (assistant), and tool-result parts (tool role),
 * so tool observations survive into later turns in the conventional
 * representation.
 */
export type { ModelMessage };

/** AI SDK v5 UIMessage part shape (text part — the common case). */
export interface TextPart {
  type: 'text';
  text: string;
  /**
   * The model step that produced this part (design D5): numbered from 0 in a
   * Run, and continuing after the kept steps in a Continue Run. Absent on a
   * legacy part that never recorded one, where replay falls back to the
   * consecutive rule. It never changes the part's text or order.
   */
  step?: number;
  /**
   * Opaque provider metadata the adapter attached to this text part (design
   * A7), stored verbatim beside the text: on the Responses wire the item's
   * `itemId`. Same contract as `ReasoningPart`'s field — llame never reads a
   * key inside it, and `buildContext` sends it back as the prompt part's
   * `providerOptions` when the reply meets the model rule of
   * `reasoning-output`. Absent when the adapter supplied none, and it changes
   * neither the part's display text nor its order. The owner
   * history response and owner event stream strip it; exports, public shares,
   * search, logs, and telemetry never carry it.
   */
  providerMetadata?: ProviderMetadata;
}

/**
 * A reasoning ("thinking") part. PERSISTED for display (survives reload) and
 * replayed to the provider in its stored position on every request of the
 * reply's own model after that reply completed (D7); a summarization request
 * is one of those requests (D9). `buildContext` re-emits it as a reasoning
 * content part where it occurred, with the text byte-identical to the stored
 * part (never trimmed, repaired, re-ordered, or neutralized) — DeepSeek's
 * `tools` rule makes that replay mandatory on the completions wire. Elsewhere
 * the exclusion stands: `partsToText` still strips reasoning, so chat search
 * and public shares never carry it.
 */
export interface ReasoningPart {
  type: 'reasoning';
  text: string;
  /**
   * The model step that produced this part (design D5), on the same rules as
   * `TextPart`'s.
   */
  step?: number;
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
export function isReasoningPart(part: unknown): part is ReasoningPart {
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
 * Whether an owner interrupt cut this reasoning part (run-steering D8). The
 * collector marks it `providerMetadata.llame.interrupted`; it stays in the
 * transcript and no request carries it.
 */
export function isInterruptedReasoning(part: ReasoningPart): boolean {
  const llame = part.providerMetadata?.['llame'];

  return isRecord(llame) && llame['interrupted'] === true;
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
 * A persisted checkpoint selected for replay. The text is read from the
 * checkpoint row once, then emitted literally; replay never re-renders it.
 */
export interface ContextCheckpoint {
  text: string;
  absorbedThroughSeq: number;
}

export interface BuildContextOptions {
  systemPrompt: string;
  /**
   * Required, with no default: the llame model id this request runs on. The
   * model rule of `reasoning-output` (D7) replays a reply's reasoning and its
   * provider metadata only when the reply's `usage.modelId` is this value, so
   * a caller must state the model it builds for.
   */
  modelId: string;
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
  /**
   * The retained entry behind each media marker in `messages`, keyed by marker.
   * The caller merges them into its attempt's map before it sizes or composes
   * the request: a marker names its bytes, and only the row that produced it
   * holds them.
   */
  retainedMedia: ReadonlyMap<string, RetainedMedia>;
}

/**
 * One stored user message's model content (`context-injection`): context
 * items and text keep their stored relative order, and the owner `file` parts,
 * in their stored order, follow every context item (the temporal row
 * included) and so precede the owner's text, wherever they were stored. A
 * `prompt-imports` item's text is followed by one image reference per image
 * entry of its payload: its `media://` locator, or an unstored image keyed by
 * the entry (vision-media D8). References stay references here; only the step
 * composer turns them into image parts or placeholders (vision-media D6).
 * Exported for the run worker, which sets the triggering message's content
 * from the parts its dispatch stored.
 */
export function userPartsToModelContent(
  parts: ReadonlyArray<unknown>,
  retained?: Map<string, RetainedMedia>,
): Array<TextPart | FilePart | ImagePart> {
  const content: Array<TextPart | FilePart | ImagePart> = [];
  const files: Array<FilePart> = [];
  let afterLastItem = 0;

  for (const part of parts) {
    if (isTextPart(part)) {
      content.push({ type: 'text', text: part.text });
      continue;
    }

    if (isContextItemPart(part)) {
      content.push(...contextItemContent(part, retained));
      afterLastItem = content.length;
      continue;
    }

    const file = storedFilePartSchema.safeParse(part);

    if (file.success && parseMediaLocator(file.data.url) !== undefined) {
      const { url, mediaType, filename } = file.data;
      files.push({
        type: 'file',
        data: url,
        mediaType,
        ...(filename !== undefined && { filename }),
      });
    }
  }

  content.splice(afterLastItem, 0, ...files);

  return content;
}

/**
 * One stored `data-context` part as its model content: its text, then one media
 * marker per import entry that names a stored locator or kept bytes. Empty for
 * an item without text, so it contributes nothing.
 */
function contextItemContent(
  part: ContextItemPart,
  retained: Map<string, RetainedMedia> | undefined,
): Array<TextPart | ImagePart> {
  const text = part.data.text;

  if (text === undefined || text.length === 0) return [];
  const media = promptImportMediaParts(part);

  if (retained !== undefined) {
    mergeRetainedMedia(retained, media.retainedMedia);
  }

  return [{ type: 'text', text }, ...media.parts];
}

/**
 * The SDK's prompt-side reasoning content part, derived from `ModelMessage` so
 * this file cannot drift from the SDK's part vocabulary. Names the byte-level
 * distinction the persisted `ReasoningPart` crosses at replay: the stored
 * `providerMetadata` becomes this part's `providerOptions`, unreshaped.
 */
export type PromptReasoningPart = Extract<
  Extract<AssistantContent, ReadonlyArray<unknown>>[number],
  { type: 'reasoning' }
>;

/**
 * One stored reasoning part as the prompt-side part it replays as: the text
 * byte-identical, with the part's opaque provider metadata riding along as
 * `providerOptions`.
 */
export function toPromptReasoningPart(
  part: ReasoningPart,
): PromptReasoningPart {
  const providerOptions: ProviderMetadata | undefined = part.providerMetadata;

  return {
    type: 'reasoning',
    text: part.text,
    ...(providerOptions !== undefined && { providerOptions }),
  };
}

/** A prompt-side text part, so each stored text part stays its own part. */
type PromptTextPart = Extract<
  Extract<AssistantContent, ReadonlyArray<unknown>>[number],
  { type: 'text' }
>;

/**
 * One assistant content part of a replayed step, in stored order. Shared with
 * the Continue projection, whose kept steps are the same parts in the same
 * shape.
 */
export type ReplayedAssistantPart =
  | PromptReasoningPart
  | PromptTextPart
  | ToolCallPart;

/**
 * The model step a stored part records (design D5), or undefined for a part
 * stored before steps existed, whose step the consecutive rule recovers.
 * Exported for the Continue projection's step offset.
 */
export function partStep(part: MessagePart): number | undefined {
  return isRecord(part) && isNumber(part['step']) ? part['step'] : undefined;
}

type OpenStep = {
  /** Its reasoning, text, and calls, in stored order. */
  readonly content: Array<ReplayedAssistantPart>;
  /** One result per call of `content`, in call order. */
  readonly results: Array<ToolResultPart>;
  /** The step number the step records, once a numbered part joins it. */
  number: number | undefined;
};

/**
 * Whether `partNumber`/`isTool` begins a new step instead of joining `open`.
 *
 * Two numbered parts with different numbers are different steps. A row that
 * mixes numbered with legacy parts — a Continue reply whose kept prefix was
 * stored before step numbers — keeps the live shape at the seam: an unnumbered
 * part that precedes the open step's calls joins the numbered step it leads
 * into, and a numbered part after an unnumbered step's calls begins a new one.
 * A call directly after the open step's call joins it whatever number each
 * carries, because one response sent them together — so parallel calls stay in
 * one assistant message with the reasoning that led into them. A part with no
 * step number otherwise follows the Continue rule: each run of consecutive
 * calls, with the text and the reasoning before it, is one step — so text or
 * reasoning after a step's calls begins the next one.
 */
function startsNewStep(
  open: OpenStep,
  partNumber: number | undefined,
  isTool: boolean,
): boolean {
  if (open.number !== undefined && partNumber !== undefined) {
    return partNumber !== open.number;
  }

  if (
    isTool &&
    partNumber === undefined &&
    open.content.at(-1)?.type === 'tool-call'
  ) {
    return false;
  }

  return open.results.length > 0;
}

/**
 * One stored assistant reply as the model messages the live loop sent (D5,
 * D14): one assistant message per model step with its reasoning, text, and
 * calls in stored order, then one tool message with the results of its calls
 * in call order. A `data-context` part follows the tool message of the step
 * before it, which is where the live splice puts it.
 *
 * Nothing is cleared, dropped, or marked: the stored row is the request's
 * history. `privateParts` carries the model rule
 * of `reasoning-output` (D7) — when it is false, a reasoning part is omitted
 * and every text and tool part keeps its text but loses its provider metadata.
 * Two reasoning parts never replay on any model: one an interrupt cut
 * (marked `providerMetadata.llame.interrupted`), and — when `interruptedReply`
 * says an interrupt closed the reply — each one with no later kept part, which
 * covers a completed reasoning item with nothing after it (D8).
 * `mediaKey` names the retained bytes behind each part's media marker, so the
 * caller owns the row identity the marker is scoped to.
 */
class StoredReplyProjection {
  private readonly messages: Array<ModelMessage> = [];
  private open: OpenStep | null = null;
  constructor(
    private readonly privateParts: boolean,
    private readonly interruptedReply: boolean,
    private readonly retainedMedia: Map<string, RetainedMedia>,
    private readonly mediaKey: (partIndex: number) => string,
  ) {}

  /** The reply's messages, writing the retained entries its markers name. */
  project(parts: ReadonlyArray<MessagePart>): Array<ModelMessage> {
    for (const [partIndex, part] of parts.entries()) {
      this.appendPart(part, partIndex);
    }

    this.closeStep();

    if (this.interruptedReply) this.dropTrailingReasoning();

    return this.messages;
  }

  /**
   * An interrupted reply replays only reasoning with a later kept part (D8):
   * what ends the last assistant message, and is followed by no context item,
   * has none.
   */
  private dropTrailingReasoning(): void {
    const index = this.messages.findLastIndex(
      ({ role }) => role === 'assistant',
    );

    const last = this.messages[index];

    if (
      last?.role !== 'assistant' ||
      !Array.isArray(last.content) ||
      !this.messages.slice(index + 1).every(({ role }) => role === 'tool')
    ) {
      return;
    }

    const kept = [...last.content];

    while (kept.at(-1)?.type === 'reasoning') kept.pop();

    if (kept.length === last.content.length) return;

    if (kept.length === 0) this.messages.splice(index, 1);
    else this.messages[index] = { ...last, content: kept };
  }

  private appendPart(part: MessagePart, partIndex: number): void {
    // eslint-disable-next-line anti-slop/no-known-value-widening -- the stored part union is the runtime I/O shape; the guard narrows it to the replayable variant.
    if (isTextPart(part)) {
      this.appendText(part);

      return;
    }

    // eslint-disable-next-line anti-slop/no-known-value-widening -- the stored part union is the runtime I/O shape; the guard narrows it to the replayable variant.
    if (isReasoningPart(part)) {
      this.appendReasoning(part);

      return;
    }

    if (isContextItemPart(part)) {
      this.appendContextItem(part.data.text);

      return;
    }

    const observation = projectStoredToolPart(part, this.mediaKey(partIndex));

    if (observation !== undefined) {
      this.appendTool(partStep(part), observation);
    }
    // Every other part — a cap notice, an unfinished tool snapshot — is not
    // model content.
  }

  /** The SDK skips an empty text part, so replay emits none. */
  private appendText(part: TextPart): void {
    if (part.text.length === 0) return;
    this.openStep(partStep(part), false).content.push({
      type: 'text',
      text: part.text,
      ...(this.privateParts &&
        part.providerMetadata !== undefined && {
          providerOptions: part.providerMetadata,
        }),
    });
  }

  /**
   * The SDK sends a reasoning part even when its text is empty: such a part
   * exists because the provider withheld the text but delivered a signature,
   * redacted data, or encrypted content (D18). Only the model rule gates it.
   */
  private appendReasoning(part: ReasoningPart): void {
    if (!this.privateParts || isInterruptedReasoning(part)) return;
    this.openStep(partStep(part), false).content.push(
      toPromptReasoningPart(part),
    );
  }

  private appendTool(
    stepNumber: number | undefined,
    observation: StoredToolObservation,
  ): void {
    const step = this.openStep(stepNumber, true);
    step.content.push(this.callPart(observation));
    step.results.push(this.resultPart(observation));
    const { retained } = observation;

    if (retained !== undefined) {
      this.retainedMedia.set(retained.key, retained.entry);
    }
  }

  private appendContextItem(text: string | undefined): void {
    if (!text) return;
    this.closeStep();
    this.messages.push({ role: 'user', content: [{ type: 'text', text }] });
  }

  private openStep(stepNumber: number | undefined, isTool: boolean): OpenStep {
    const { open } = this;

    if (open !== null && !startsNewStep(open, stepNumber, isTool)) {
      // A numbered part that leads into the open unnumbered step adopts it, so
      // the rest of that response joins the same assistant message.
      open.number ??= stepNumber;

      return open;
    }

    this.closeStep();

    const created: OpenStep = {
      content: [],
      results: [],
      number: stepNumber,
    };

    this.open = created;

    return created;
  }

  private closeStep(): void {
    const step = this.open;
    this.open = null;

    if (step === null || step.content.length === 0) return;
    this.messages.push({ role: 'assistant', content: step.content });

    if (step.results.length > 0) {
      this.messages.push({ role: 'tool', content: step.results });
    }
  }

  private callPart(observation: StoredToolObservation): ToolCallPart {
    const { pair } = observation;

    const part =
      pair.refused && !this.privateParts && !isRecord(pair.toolCallPart.input)
        ? { ...pair.toolCallPart, input: {} }
        : pair.toolCallPart;

    return this.privateParts && pair.providerMetadata !== undefined
      ? { ...part, providerOptions: pair.providerMetadata }
      : part;
  }

  /**
   * The SDK copies the live call's provider metadata onto the result of a call
   * that ran; its own synthesized result for a refused call carried none.
   */
  private resultPart(observation: StoredToolObservation): ToolResultPart {
    const { pair } = observation;

    return this.privateParts &&
      !pair.refused &&
      pair.providerMetadata !== undefined
      ? { ...pair.toolResultPart, providerOptions: pair.providerMetadata }
      : pair.toolResultPart;
  }
}

/** What a request that replays stored parts needs from them. */
export type StoredReplyProjectionOptions = {
  /** Whether reasoning and provider metadata replay (the model rule). */
  privateParts: boolean;
  /** The retained-media marker key of the part at this index. */
  mediaKey: (partIndex: number) => string;
};

/**
 * One stored reply, or the kept parts of a Continue Run, as the model messages
 * the live loop sent (D5, D11, D14). Every request that replays stored parts
 * calls this: a later turn, a compaction request, and a Continue Run, so the
 * three cannot drift. The caller states the model rule and the retained-media
 * scope; nothing here decides either.
 */
export function projectStoredReplyParts(
  parts: ReadonlyArray<MessagePart>,
  options: StoredReplyProjectionOptions,
): Pick<ModelRequestContext, 'messages' | 'retainedMedia'> {
  const retainedMedia = new Map<string, RetainedMedia>();

  const messages = new StoredReplyProjection(
    options.privateParts,
    false,
    retainedMedia,
    options.mediaKey,
  ).project(parts);

  return { messages, retainedMedia };
}

/**
 * The model rule of `reasoning-output` (D7, A1/A2): a reply's reasoning and
 * provider metadata replay only when the reply completed on the model of this
 * request, or when an owner interrupt closed it (its reasoning then follows
 * the interrupted rule). A row without recorded usage — written before usage
 * existed, or still running — replays neither.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- the reply's stored `usage` is untyped jsonb; the `isRecord` guard below is its parse.
function replaysPrivateParts(usage: unknown, modelId: string): boolean {
  return (
    isRecord(usage) &&
    usage['modelId'] === modelId &&
    (usage['status'] === 'completed' || isInterruptedReply(usage))
  );
}

/** Whether the stored usage of a reply says an owner interrupt closed it. */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- the reply's stored `usage` is untyped jsonb; the `isRecord` guard below is its parse.
function isInterruptedReply(usage: unknown): boolean {
  return (
    isRecord(usage) &&
    usage['status'] === 'aborted' &&
    usage['interrupted'] === true
  );
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
  const { systemPrompt, checkpoint } = options;

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
  const retained = new Map<string, RetainedMedia>();

  if (checkpoint !== undefined) {
    result.push({
      role: 'user',
      content: [{ type: 'text', text: checkpoint.text }],
    });
  }

  for (const m of ordered) {
    if (m.role === 'user') {
      appendUserMessage(result, m, retained);
    } else {
      appendAssistantMessage(result, m, options.modelId, retained);
    }
  }

  return { system: systemPrompt, messages: result, retainedMedia: retained };
}

function appendUserMessage(
  result: Array<ModelMessage>,
  m: StoredMessage,
  retained: Map<string, RetainedMedia>,
): void {
  const content = userPartsToModelContent(m.parts, retained);

  if (content.length > 0) {
    result.push({ role: 'user', content });
  }
}

/**
 * One stored reply through the one projection. Assistant output is replayed
 * byte-identically and never neutralized: a model does not treat its own prior
 * turns as authoritative, and llame's users legitimately discuss llame's own
 * envelope, which neutralization would corrupt.
 */
function appendAssistantMessage(
  result: Array<ModelMessage>,
  m: StoredMessage,
  modelId: string,
  retained: Map<string, RetainedMedia>,
): void {
  // Model rule of `reasoning-output` (D7): same model, completed reply — or a
  // reply an interrupt closed, whose reasoning follows the interrupted rule.
  result.push(
    ...new StoredReplyProjection(
      replaysPrivateParts(m.usage, modelId),
      isInterruptedReply(m.usage),
      retained,
      (partIndex) => storedToolPartMediaKey(m.id, partIndex),
    ).project(m.parts),
  );
}
