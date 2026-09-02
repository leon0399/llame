import type { UIMessage } from "ai";
import type { ChatMessagesResponse as GeneratedChatMessagesResponse } from "../../api/generated/models";

export type ChatMessageResponse = {
  id: string;
  chatId: string;
  seq: number;
  role: UIMessage["role"] | "tool";
  senderUserId: string | null;
  parts: UIMessage["parts"];
  attachments: Array<unknown>;
  usage: unknown;
  inReplyTo: string | null;
  createdAt: string;
};

/**
 * Display-relevant subset of a compaction's usage telemetry (#136). All
 * fields are null-safe: an older/seeded compaction may carry no usage at
 * all, and `absorbedMessageCount` is independent of usage entirely (pure
 * seq arithmetic on the api side) so it can be present even when the rest
 * isn't. `beforeTokens`/`afterTokens` are the summarization call's own
 * input/output token counts (the size of what got absorbed vs. the size of
 * the summary that replaced it) — not a literal "chat context size before
 * vs. after" figure, which isn't persisted anywhere.
 */
export type CompactionStats = {
  absorbedMessageCount: number | null;
  beforeTokens: number | null;
  afterTokens: number | null;
  modelId: string | null;
};

/**
 * The chat's latest compaction (#57), embedded in the messages response
 * (#136) instead of a separate `GET :id/compaction` round trip.
 */
export type Compaction = {
  uptoSeq: number;
  summary: string;
  createdAt: string;
  stats: CompactionStats;
};

export type ChatMessagesResponse = {
  messages: Array<ChatMessageResponse>;
  compaction: Compaction | null;
};

/** Adapt the generated unknown-part wire contract to the AI SDK UI facade. */
export function normalizeChatMessagesResponse(
  response: GeneratedChatMessagesResponse,
): ChatMessagesResponse {
  return {
    compaction: response.compaction,
    messages: response.messages.map((message) => ({
      ...message,
      // SAFETY: the wire contract types `parts` as opaque objects only
      // because OpenAPI cannot express the AI SDK's discriminated part
      // union — this app is the sole producer and consumer of the stored
      // rows, and persists exactly the shapes `UIMessage["parts"]` allows
      // (see AGENTS.md "Preserve stored conversation parts wholesale").
      parts: message.parts as UIMessage["parts"],
    })),
  };
}

/** The combined shape `ChatPage` renders from — one query, one fetch. */
export type ChatHistory = {
  messages: Array<UIMessage>;
  compaction: Compaction | null;
};

/**
 * A server-authored context item carrying a model change.
 *
 * Every injected context item shares the `data-context` part type; the
 * `producer` tells them apart. This app renders only the model-change
 * boundary, so it narrows to that one producer and treats every other item as
 * something it does not display.
 */
export type ModelSwitchPart = {
  type: "data-context";
  data: {
    v: 1;
    producer: "effective-context-change";
    form: "notice";
    runId: string;
    payload: {
      cause: "model";
      fromModelId: string;
      toModelId: string;
    };
    text?: string;
  };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonNullObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** Exact key-set structural check on an already-narrowed object's own keys —
 *  the caller still owns validating each field's type; this only confirms
 *  which fields exist. */
function keysMatch(
  actualKeys: ReadonlyArray<string>,
  expectedKeys: ReadonlyArray<string>,
): boolean {
  return (
    [...actualKeys].sort().join("\0") === [...expectedKeys].sort().join("\0")
  );
}

export function isContextItemPart(
  value: unknown,
): value is { type: "data-context"; data: unknown } {
  if (
    !isNonNullObject(value) ||
    !keysMatch(Object.keys(value), ["type", "data"])
  ) {
    return false;
  }
  // SAFETY: `keysMatch` above confirmed `value` has exactly the `type` and
  // `data` keys; both are read here still unvalidated, and checked on the
  // following lines before this function returns true.
  const { type, data } = value as { type: unknown; data: unknown };
  return type === "data-context" && isNonNullObject(data);
}

/** The `data.payload` shape of a model-switch context item, validated on its
 *  own — a real sub-boundary of `isModelSwitchPart`, not an arbitrary split. */
function isModelSwitchPayload(
  value: unknown,
): value is ModelSwitchPart["data"]["payload"] {
  if (
    !isNonNullObject(value) ||
    !keysMatch(Object.keys(value), ["cause", "fromModelId", "toModelId"])
  ) {
    return false;
  }
  // SAFETY: `keysMatch` above confirmed `value` has exactly these three
  // keys; each field is validated individually below.
  const { cause, fromModelId, toModelId } = value as {
    cause: unknown;
    fromModelId: unknown;
    toModelId: unknown;
  };
  return (
    cause === "model" &&
    isString(fromModelId) &&
    fromModelId.trim().length > 0 &&
    isString(toModelId) &&
    toModelId.trim().length > 0 &&
    fromModelId !== toModelId
  );
}

export function isModelSwitchPart(value: unknown): value is ModelSwitchPart {
  if (!isContextItemPart(value)) return false;
  const requiredKeys = ["v", "producer", "form", "runId", "payload"];
  if (
    !isNonNullObject(value.data) ||
    (!keysMatch(Object.keys(value.data), requiredKeys) &&
      !keysMatch(Object.keys(value.data), [...requiredKeys, "text"]))
  ) {
    return false;
  }
  // SAFETY: the checks above confirmed `value.data` is a non-null object
  // with exactly these keys (optionally plus `text`); each field is
  // validated individually below before being trusted.
  const { v, producer, form, runId, payload, text } = value.data as {
    v: unknown;
    producer: unknown;
    form: unknown;
    runId: unknown;
    payload: unknown;
    text?: unknown;
  };
  return (
    v === 1 &&
    producer === "effective-context-change" &&
    form === "notice" &&
    isString(runId) &&
    UUID_PATTERN.test(runId) &&
    (text === undefined || isString(text)) &&
    isModelSwitchPayload(payload)
  );
}

export function modelSwitchPart(message: {
  parts: ReadonlyArray<unknown>;
}): ModelSwitchPart | null {
  return message.parts.find(isModelSwitchPart) ?? null;
}

/**
 * useChat freezes its initial history, while the authoritative message query
 * refreshes after a completed turn. Overlay only server-fetched control parts
 * by message id; client/stream-authored copies are removed unconditionally.
 */
export function mergeTrustedModelContextParts(
  liveMessages: ReadonlyArray<UIMessage>,
  serverMessages: ReadonlyArray<UIMessage>,
): Array<UIMessage> {
  const trustedByMessageId = new Map(
    serverMessages.flatMap((message) => {
      const part = message.role === "user" ? modelSwitchPart(message) : null;
      return part ? [[message.id, part] as const] : [];
    }),
  );

  return liveMessages.map((message) => {
    // Every context item is server-authored control metadata, never visible
    // chat content — one branch covers every producer, including ones this
    // app does not know about.
    const visibleParts = message.parts.filter(
      (part) => !isContextItemPart(part),
    );
    const trusted = trustedByMessageId.get(message.id);
    return {
      ...message,
      // SAFETY: `trusted` is a `ModelSwitchPart` (one of this app's own
      // `data-context` parts) and `visibleParts` is `message.parts` with
      // those context parts filtered out — both are already
      // `UIMessage["parts"]`-shaped content; the cast is only needed
      // because `ModelSwitchPart`'s literal-typed `data` doesn't
      // structurally match the SDK's wider generic `data-*` part type.
      parts: (trusted
        ? [trusted, ...visibleParts]
        : visibleParts) as UIMessage["parts"],
    };
  });
}

export function runIdFromMessageMetadata(metadata: unknown): string | null {
  if (!isNonNullObject(metadata)) return null;
  // SAFETY: `isNonNullObject` above confirmed `metadata` is a non-null
  // object; `usage` is read here still unvalidated and checked next.
  const usage = (metadata as { usage?: unknown }).usage;
  if (!isNonNullObject(usage)) return null;
  // SAFETY: `isNonNullObject` above confirmed `usage` is a non-null
  // object; `runId` is read here still unvalidated and checked next.
  const runId = (usage as { runId?: unknown }).runId;
  return isString(runId) && UUID_PATTERN.test(runId) ? runId : null;
}

export function messageRenderKey(
  message: Pick<UIMessage, "id" | "role" | "metadata">,
): string {
  const identity =
    message.role === "assistant"
      ? (runIdFromMessageMetadata(message.metadata) ?? message.id)
      : message.id;
  return `${message.role}:${identity}`;
}

type ChatUiMessageResponse = ChatMessageResponse & {
  role: Extract<UIMessage["role"], "user" | "assistant">;
};

function isChatUiMessageResponse(
  message: ChatMessageResponse,
): message is ChatUiMessageResponse {
  return message.role === "user" || message.role === "assistant";
}

// Decoupled from the full ChatMessagesResponse (just the `messages` field it
// actually needs) so a caller that already unwrapped `.messages` from a
// paginated walk (which discards the response's other fields) can pass the
// plain array straight through, without needing to fabricate a `compaction`
// field just to satisfy the type.
export function toChatUiMessages(response: {
  messages: Array<ChatMessageResponse>;
}): Array<UIMessage> {
  return response.messages.filter(isChatUiMessageResponse).map((message) => {
    // `seq` is unconditional — the compaction boundary needs it to locate
    // where the summarized span ends (AI SDK UIMessage has no seq of its
    // own), and dropping it on a turn with nothing else to carry would
    // mis-place the boundary. `usage` is included only when present: it
    // carries per-turn usage into message metadata so the UI shows it on
    // historical turns exactly as it does live (the run bridge emits the
    // same `{ usage }` shape as a message-metadata chunk at completion).
    const metadata = message.usage
      ? { seq: message.seq, usage: message.usage }
      : { seq: message.seq };
    return {
      id: message.id,
      role: message.role,
      parts: message.parts,
      metadata,
    };
  });
}

/**
 * The `seq` a message carries when it came from durable history
 * (`toChatUiMessages` stamps it), or null for a live-authored message — an
 * optimistic user turn or a streamed answer, whose metadata carries at most
 * `usage`, never `seq`.
 */
export function messageSeqFromMetadata(metadata: unknown): number | null {
  if (!isNonNullObject(metadata)) return null;
  // SAFETY: `isNonNullObject` above confirmed `metadata` is a non-null
  // object; `seq` is read here still unvalidated and checked next.
  const seq = (metadata as { seq?: unknown }).seq;
  return isNumber(seq) && Number.isSafeInteger(seq) && seq > 0 ? seq : null;
}

/**
 * The oldest and newest durable seq in a message list, in one pass — null
 * when the list holds no durable row at all. Returning the pair together
 * lets the type system carry "at least one seq'd message exists" through
 * adoptServerHistory, instead of two scans with individually-nullable
 * results that are in fact null together.
 */
function durableSeqBounds(
  messages: ReadonlyArray<UIMessage>,
): { oldest: number; newest: number } | null {
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const message of messages) {
    const seq = messageSeqFromMetadata(message.metadata);
    if (seq === null) continue;
    oldest ??= seq;
    newest = seq;
  }
  return oldest !== null && newest !== null ? { oldest, newest } : null;
}

/**
 * The healed message list a freshly fetched server history justifies, or
 * null when the live list should stand. `useChat` freezes its messages at
 * creation, so a refetch is the ONLY thing that can heal a log the durable
 * run has moved past (#261) — and it can only heal it through `setMessages`.
 *
 * The not-streaming guard is the one with teeth: mid-turn the live copy
 * legitimately runs ahead of the server (an optimistic user turn, an answer
 * still streaming), and replacing it there duplicates or rewinds the
 * transcript (#259).
 *
 * Settled, the adoption rule is a durable-coverage comparison: adopt when
 * the server list extends past the log's durable rows on EITHER end.
 *
 * - NEWER coverage: the server's newest seq is beyond the newest durable seq
 *   the log holds. Live-authored messages never carry a seq, so every
 *   settled state worth healing lands here — a strictly longer history
 *   (204-resume, #261), a disconnect that left a partial answer at equal
 *   length, and a completed turn whose final assistant must swap its
 *   streaming representation (Run id as message id) for the durable one
 *   (Message id + Run id in metadata, which the fork affordance and context
 *   inspector need).
 * - OLDER coverage: an on-demand older page (#187) grew the window at the
 *   head without touching the newest seq.
 *
 * Adoption stamps every message with its durable seq, so re-running
 * afterwards is a no-op.
 *
 * The server history is a WINDOW (#187): the pages the reader has loaded,
 * not necessarily the whole chat. Live messages older than the window's
 * coverage (they exist exactly when the reader loaded older pages that a
 * later slid-window refetch no longer spans) are durable rows already
 * adopted once — keep them, and replace only the covered tail. The split is
 * on strict `seq < server oldest`, so the overlap region dedupes to the
 * server copy.
 */
export function adoptServerHistory(input: {
  status: string;
  serverMessages: ReadonlyArray<UIMessage>;
  liveMessages: ReadonlyArray<UIMessage>;
}): Array<UIMessage> | null {
  if (input.status === "streaming" || input.status === "submitted") {
    return null;
  }
  const server = input.serverMessages;
  const serverBounds = durableSeqBounds(server);
  if (serverBounds === null) return null;
  const liveBounds = durableSeqBounds(input.liveMessages);

  const extendsNewer =
    liveBounds === null || serverBounds.newest > liveBounds.newest;
  const extendsOlder =
    liveBounds !== null && serverBounds.oldest < liveBounds.oldest;
  if (!extendsNewer && !extendsOlder) return null;

  const head: Array<UIMessage> = [];
  for (const message of input.liveMessages) {
    const seq = messageSeqFromMetadata(message.metadata);
    if (seq === null || seq >= serverBounds.oldest) break;
    head.push(message);
  }

  // Adoption must not clip the log's live end: a refetch can land while the
  // tail is only PARTIALLY durable — the user turn commits synchronously at
  // send, the assistant reply only at run termination, so a mid-stream
  // disconnect refetch advances the newest seq (the user turn) while the
  // reader's partial answer exists nowhere server-side. Wiping it blanks
  // text the reader is looking at until the background poll re-adopts,
  // which on a long run is minutes. So keep each trailing live-authored
  // message unless THIS server read provably carries its durable copy: a
  // user turn persists under the client-supplied message id (idempotent
  // create), and a streamed assistant's live id is its Run id, which the
  // durable row carries in usage metadata. Matching per message (not
  // "server advanced ⇒ tail covered") is what keeps a kept message from
  // ever duplicating a server row.
  const serverIds = new Set(server.map((message) => message.id));
  const serverRunIds = new Set(
    server.flatMap((message) => {
      const runId = runIdFromMessageMetadata(message.metadata);
      return runId === null ? [] : [runId];
    }),
  );
  const tail: Array<UIMessage> = [];
  for (let index = input.liveMessages.length - 1; index >= 0; index--) {
    const message = input.liveMessages[index];
    if (messageSeqFromMetadata(message.metadata) !== null) break;
    if (serverIds.has(message.id) || serverRunIds.has(message.id)) continue;
    tail.unshift(message);
  }
  return [...head, ...server, ...tail];
}
