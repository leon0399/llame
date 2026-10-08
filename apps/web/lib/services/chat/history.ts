import type { UIMessage } from "ai";
import type {
  ChatMessagesResponse as GeneratedChatMessagesResponse,
  CheckpointStatsResponse,
} from "../../api/generated/models";

export type ChatMessageResponse = {
  id: string;
  chatId: string;
  seq: number;
  role: UIMessage["role"] | "tool" | "checkpoint";
  senderUserId: string | null;
  parts: UIMessage["parts"];
  attachments: Array<unknown>;
  usage: unknown;
  inReplyTo: string | null;
  createdAt: string;
  absorbedThroughSeq?: number;
  absorbedMessageCount?: number;
  summary?: string;
  stats?: CheckpointStatsResponse;
};

/**
 * The checkpoint row fields the transcript boundary reads. The API sends all
 * of them on every checkpoint row; `absorbedThroughSeq` places the boundary.
 */
export type Compaction = Required<
  Pick<
    ChatMessageResponse,
    "absorbedThroughSeq" | "absorbedMessageCount" | "summary" | "stats"
  >
> &
  Pick<ChatMessageResponse, "createdAt">;

export type ChatMessagesResponse = {
  messages: Array<ChatMessageResponse>;
  compaction: Compaction | null;
};

function isCompaction(
  message: ChatMessageResponse,
): message is ChatMessageResponse & Compaction {
  return (
    message.role === "checkpoint" &&
    message.absorbedThroughSeq !== undefined &&
    message.absorbedMessageCount !== undefined &&
    message.summary !== undefined &&
    message.stats !== undefined
  );
}

/** Adapt the generated unknown-part wire contract to the AI SDK UI facade. */
export function normalizeChatMessagesResponse(
  response: GeneratedChatMessagesResponse,
): ChatMessagesResponse {
  const messages: Array<ChatMessageResponse> = response.messages.map(
    (message) => ({
      ...message,
      // SAFETY: the wire contract types `parts` as opaque objects only
      // because OpenAPI cannot express the AI SDK's discriminated part
      // union — this app is the sole producer and consumer of the stored
      // rows, and persists exactly the shapes `UIMessage["parts"]` allows
      // (see AGENTS.md "Preserve stored conversation parts wholesale").
      parts: message.parts as UIMessage["parts"],
    }),
  );
  const compaction = [...messages].reverse().find(isCompaction);
  return { compaction: compaction ?? null, messages };
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

/**
 * A server-authored context item carrying the project instruction files one
 * trigger loaded. `payload.files` is the model-visible set — the API's seen
 * set keys on `canonicalPath` — and `importedBy` identifies an imported
 * file's immediate importer. `payload.denied` is owner-only metadata: the
 * paths the `read` permission group rejected, which the model-visible text
 * never names.
 */
export type InstructionsPart = {
  type: "data-context";
  data: {
    v: 1;
    producer: "instructions";
    form: "notice";
    runId: string;
    payload: {
      files: ReadonlyArray<{
        path: string;
        canonicalPath: string;
        truncated: boolean;
        importedBy?: string;
      }>;
      denied: ReadonlyArray<string>;
    };
    text?: string;
  };
};

/** The private payload of an instructions item: what the owner chip renders. */
export type InstructionsPayload = InstructionsPart["data"]["payload"];

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

/** The envelope every `data-context` notice this app renders shares: exact
 *  key set (`text` optional), `v: 1`, the expected `producer`, form
 *  `notice`, a UUID `runId`, and `text` a string when present. Returns the
 *  still-unvalidated `payload` once the envelope holds — each caller owns
 *  validating that payload — or `undefined` when it does not. */
function noticePayload(
  value: unknown,
  producer: "effective-context-change" | "instructions",
) {
  if (!isContextItemPart(value)) return undefined;
  const requiredKeys = ["v", "producer", "form", "runId", "payload"];
  if (
    !isNonNullObject(value.data) ||
    (!keysMatch(Object.keys(value.data), requiredKeys) &&
      !keysMatch(Object.keys(value.data), [...requiredKeys, "text"]))
  ) {
    return undefined;
  }
  // SAFETY: the checks above confirmed `value.data` is a non-null object
  // with exactly these keys (optionally plus `text`); each field is
  // validated individually below before the payload is returned.
  const {
    v,
    producer: actualProducer,
    form,
    runId,
    payload,
    text,
  } = value.data as {
    v: unknown;
    producer: unknown;
    form: unknown;
    runId: unknown;
    payload: unknown;
    text?: unknown;
  };
  if (
    v !== 1 ||
    actualProducer !== producer ||
    form !== "notice" ||
    !isString(runId) ||
    !UUID_PATTERN.test(runId) ||
    (text !== undefined && !isString(text))
  ) {
    return undefined;
  }
  return payload;
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
  return isModelSwitchPayload(noticePayload(value, "effective-context-change"));
}

export function modelSwitchPart(message: {
  parts: ReadonlyArray<unknown>;
}): ModelSwitchPart | null {
  return message.parts.find(isModelSwitchPart) ?? null;
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

/** One `payload.files` entry, validated on its own — the owner chip renders
 *  these, so a shape mismatch must not reach it. */
function isInstructionsFileEntry(
  value: unknown,
): value is InstructionsPart["data"]["payload"]["files"][number] {
  if (!isNonNullObject(value)) return false;
  const hasImportedBy = Object.hasOwn(value, "importedBy");
  if (
    !keysMatch(Object.keys(value), [
      "path",
      "canonicalPath",
      "truncated",
      ...(hasImportedBy ? ["importedBy"] : []),
    ])
  ) {
    return false;
  }
  // SAFETY: `keysMatch` above confirmed `value` has exactly the accepted
  // file-entry shape; each field is validated individually below.
  const { path, canonicalPath, truncated, importedBy } = value as {
    path: unknown;
    canonicalPath: unknown;
    truncated: unknown;
    importedBy?: unknown;
  };
  return (
    isNonEmptyString(path) &&
    isNonEmptyString(canonicalPath) &&
    typeof truncated === "boolean" &&
    (!hasImportedBy || isNonEmptyString(importedBy))
  );
}

/** The `data.payload` shape of an instructions context item, validated on its
 *  own — a real sub-boundary of `isInstructionsPart`, not an arbitrary split.
 *  `files` is non-empty because the api authors an item only for a bundle
 *  that loaded at least one file; an empty list is a shape this build does
 *  not know, and rendering a chip from it would claim disclosure of nothing. */
function isInstructionsPayload(
  value: unknown,
): value is InstructionsPart["data"]["payload"] {
  if (
    !isNonNullObject(value) ||
    !keysMatch(Object.keys(value), ["files", "denied"])
  ) {
    return false;
  }
  // SAFETY: `keysMatch` above confirmed `value` has exactly the `files` and
  // `denied` keys; both stay `unknown` and are validated individually below.
  const { files, denied } = value as { files: unknown; denied: unknown };
  return (
    Array.isArray(files) &&
    files.length > 0 &&
    files.every(isInstructionsFileEntry) &&
    Array.isArray(denied) &&
    denied.every(isNonEmptyString)
  );
}

export function isInstructionsPart(value: unknown): value is InstructionsPart {
  return isInstructionsPayload(noticePayload(value, "instructions"));
}

/** Whether this app renders a server context item on that role: the
 *  model-switch marker the rail stages on a user message, and the
 *  instructions item, which rides either role. A type predicate, so the
 *  caller keeps the narrowed part. */
function isRenderableControlPart(
  role: UIMessage["role"],
  part: unknown,
): part is ModelSwitchPart | InstructionsPart {
  return role === "user"
    ? isModelSwitchPart(part) || isInstructionsPart(part)
    : isInstructionsPart(part);
}

/**
 * The control parts a server-fetched message is trusted to overlay, each with
 * its stored position: exactly the producers this app renders from stored
 * parts — the model-switch marker the rail stages on a user message, and the
 * instructions item, which rides the assistant turn of an in-Run load and the
 * triggering user turn of the accepted-turn load (design D5, D9). Every other
 * producer stays invisible, and a part no server message vouches for is
 * dropped.
 *
 * Server order is kept: a turn the rail both switched models on and loaded
 * instructions for carries both parts, in the order the api stored them.
 */
function trustedContextParts(message: {
  role: UIMessage["role"];
  parts: ReadonlyArray<unknown>;
}) {
  // Each part's index is the count of non-context parts before it: the merge
  // drops context parts of every other producer, so they occupy no index.
  const placed: Array<{
    index: number;
    part: ModelSwitchPart | InstructionsPart;
  }> = [];
  let index = 0;
  for (const part of message.parts) {
    if (!isContextItemPart(part)) {
      index += 1;
    } else if (isRenderableControlPart(message.role, part)) {
      placed.push({ index, part });
    }
  }
  return placed;
}

/**
 * useChat freezes its initial history, while the authoritative message query
 * refreshes after a completed turn. Overlay only server-fetched control parts
 * by message id; client/stream-authored copies are removed unconditionally.
 *
 * Each trusted part goes back where the server stored it, measured in the
 * non-context parts that precede it: the model-switch marker and an
 * accepted-turn instructions item stay at the top of the user turn they
 * introduce, while an in-Run item lands right after the triggering step's
 * last tool part — the position the model actually received it in. Stored
 * indices ascend, and a live turn carrying fewer parts than the server copy
 * clamps the insert to its end.
 */
export function mergeTrustedModelContextParts(
  liveMessages: ReadonlyArray<UIMessage>,
  serverMessages: ReadonlyArray<UIMessage>,
): Array<UIMessage> {
  const trustedByMessageId = new Map(
    serverMessages.map(
      (message) => [message.id, trustedContextParts(message)] as const,
    ),
  );

  return liveMessages.map((message) => {
    // Every context item is server-authored control metadata — one branch
    // covers every producer, including ones this app does not know about —
    // so only the trusted copies looked up by id survive the merge, each
    // re-inserted at the index the server stored it at.
    const visibleParts: Array<unknown> = message.parts.filter(
      (part) => !isContextItemPart(part),
    );
    // Stored indices ascend, so offsetting by the parts already inserted keeps
    // two parts sharing one index in server order; splice clamps a start past
    // the end of a shorter live turn.
    (trustedByMessageId.get(message.id) ?? []).forEach(
      ({ index, part }, placed) => visibleParts.splice(index + placed, 0, part),
    );
    return {
      ...message,
      // SAFETY: `part` is this app's own `data-context` part and
      // `visibleParts` is `message.parts` with every context part filtered
      // out — both are already `UIMessage["parts"]`-shaped content; the cast
      // is only needed because the part's literal-typed `data` doesn't
      // structurally match the SDK's wider generic `data-*` part type.
      parts: visibleParts as UIMessage["parts"],
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
// plain array straight through without fabricating a checkpoint boundary.
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
