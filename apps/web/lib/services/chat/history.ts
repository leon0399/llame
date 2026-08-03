import type { UIMessage } from "ai";
import { buildApiUrl } from "../../api/client";

export type ChatMessageResponse = {
  id: string;
  chatId: string;
  seq: number;
  role: UIMessage["role"] | "tool";
  senderUserId: string | null;
  parts: UIMessage["parts"];
  attachments: unknown[];
  usage: Record<string, unknown> | null;
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
  messages: ChatMessageResponse[];
  compaction: Compaction | null;
};

/** The combined shape `ChatPage` renders from — one query, one fetch. */
export type ChatHistory = {
  messages: UIMessage[];
  compaction: Compaction | null;
};

export type ModelSwitchPart = {
  type: "data-model-context";
  data: {
    kind: "model_switch";
    fromModelId: string;
    toModelId: string;
    runId: string;
  };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expectedKeys].sort().join("\0")
  );
}

export function isModelSwitchPart(value: unknown): value is ModelSwitchPart {
  if (!isExactRecord(value, ["type", "data"])) return false;
  if (value.type !== "data-model-context") return false;
  if (
    !isExactRecord(value.data, ["kind", "fromModelId", "toModelId", "runId"])
  ) {
    return false;
  }
  const { kind, fromModelId, toModelId, runId } = value.data;
  return (
    kind === "model_switch" &&
    typeof fromModelId === "string" &&
    fromModelId.trim().length > 0 &&
    typeof toModelId === "string" &&
    toModelId.trim().length > 0 &&
    fromModelId !== toModelId &&
    typeof runId === "string" &&
    UUID_PATTERN.test(runId)
  );
}

export function modelSwitchPart(message: {
  parts: readonly unknown[];
}): ModelSwitchPart | null {
  return message.parts.find(isModelSwitchPart) ?? null;
}

/**
 * useChat freezes its initial history, while the authoritative message query
 * refreshes after a completed turn. Overlay only server-fetched control parts
 * by message id; client/stream-authored copies are removed unconditionally.
 */
export function mergeTrustedModelContextParts(
  liveMessages: readonly UIMessage[],
  serverMessages: readonly UIMessage[],
): UIMessage[] {
  const trustedByMessageId = new Map(
    serverMessages.flatMap((message) => {
      const part = message.role === "user" ? modelSwitchPart(message) : null;
      return part ? [[message.id, part] as const] : [];
    }),
  );

  return liveMessages.map((message) => {
    const visibleParts = message.parts.filter(
      (part) =>
        !(
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "data-model-context"
        ),
    );
    const trusted = trustedByMessageId.get(message.id);
    return {
      ...message,
      parts: (trusted
        ? [trusted, ...visibleParts]
        : visibleParts) as UIMessage["parts"],
    };
  });
}

export function runIdFromMessageMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const usage = (metadata as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const runId = (usage as { runId?: unknown }).runId;
  return typeof runId === "string" && UUID_PATTERN.test(runId) ? runId : null;
}

export type ChatMessagesHistoryOptions = {
  limit?: number;
  beforeSeq?: number;
};

export function buildChatMessagesHistoryUrl(
  chatId: string,
  options: ChatMessagesHistoryOptions = {},
): string {
  const url = new URL(
    buildApiUrl(`/api/v1/chats/${encodeURIComponent(chatId)}/messages`),
  );

  if (options.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }

  if (options.beforeSeq !== undefined) {
    url.searchParams.set("beforeSeq", String(options.beforeSeq));
  }

  return url.toString();
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
  messages: ChatMessageResponse[];
}): UIMessage[] {
  return response.messages.filter(isChatUiMessageResponse).map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts,
    // `seq` is unconditional — the compaction boundary needs it to locate
    // where the summarized span ends (AI SDK UIMessage has no seq of its
    // own), and a conditional spread would drop it on a turn with nothing
    // else to carry, mis-placing the boundary. `usage` stays conditional: it
    // carries per-turn usage into message metadata so the UI shows it on
    // historical turns exactly as it does live (the run bridge emits the
    // same `{ usage }` shape as a message-metadata chunk at completion).
    metadata: {
      seq: message.seq,
      ...(message.usage ? { usage: message.usage } : {}),
    },
  }));
}

/**
 * Whether a freshly fetched server history should replace the live message
 * list. `useChat` freezes its messages at creation, so a refetch is the ONLY
 * thing that can heal a log the durable run has moved past (#261) — and it can
 * only heal it through `setMessages`.
 *
 * The not-streaming half is the guard with teeth: mid-turn the live copy
 * legitimately runs ahead of the server (an optimistic user turn, an answer
 * still streaming), and replacing it there duplicates or rewinds the
 * transcript (#259).
 *
 * Two settled states are worth adopting, and they need different tests:
 *
 * - a STRICTLY LONGER history — the answer exists server-side and the log
 *   never received it. Count alone is enough, and it makes re-running this
 *   after adoption a no-op.
 * - a FAILED turn at equal length — a disconnect mid-answer leaves the SDK
 *   holding a *partial* assistant message, so the healed history has the same
 *   count but complete content. Count alone would call that settled and leave
 *   the transcript truncated. `error` is only reachable once the live stream
 *   is over, so nothing in flight can be clobbered.
 */
export function shouldAdoptServerHistory(input: {
  status: string;
  serverMessageCount: number;
  liveMessageCount: number;
}): boolean {
  if (input.status === "streaming" || input.status === "submitted") {
    return false;
  }
  if (input.status === "error") {
    return input.serverMessageCount >= input.liveMessageCount;
  }
  return input.serverMessageCount > input.liveMessageCount;
}
