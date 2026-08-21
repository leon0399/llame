import { afterEach, describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  buildChatMessagesHistoryUrl,
  messageRenderKey,
  mergeTrustedModelContextParts,
  modelSwitchPart,
  runIdFromMessageMetadata,
  shouldAdoptServerHistory,
  toChatUiMessages,
} from "./history";

describe("buildChatMessagesHistoryUrl", () => {
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    }
  });

  it("builds the chat history endpoint URL", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com/";

    expect(buildChatMessagesHistoryUrl("chat-1")).toBe(
      "https://api.example.com/api/v1/chats/chat-1/messages",
    );
  });

  it("adds history pagination query params", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com/";

    expect(
      buildChatMessagesHistoryUrl("chat-1", { limit: 50, beforeSeq: 42 }),
    ).toBe(
      "https://api.example.com/api/v1/chats/chat-1/messages?limit=50&beforeSeq=42",
    );
  });
});

describe("toChatUiMessages", () => {
  it("maps persisted chat messages to AI SDK UI messages", () => {
    expect(
      toChatUiMessages({
        messages: [
          {
            id: "user-message",
            chatId: "chat-1",
            seq: 1,
            role: "user",
            senderUserId: "user-1",
            parts: [{ type: "text", text: "Hello" }],
            attachments: [],
            usage: null,
            inReplyTo: null,
            createdAt: "2026-07-01T12:00:00.000Z",
          },
          {
            id: "assistant-message",
            chatId: "chat-1",
            seq: 2,
            role: "assistant",
            senderUserId: null,
            parts: [{ type: "text", text: "Hi" }],
            attachments: [],
            usage: { status: "completed" },
            inReplyTo: "user-message",
            createdAt: "2026-07-01T12:00:01.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        id: "user-message",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        metadata: { seq: 1 },
      },
      {
        id: "assistant-message",
        role: "assistant",
        parts: [{ type: "text", text: "Hi" }],
        // seq is unconditional (compaction boundary); usage is carried
        // alongside it when present, for the usage display.
        metadata: { seq: 2, usage: { status: "completed" } },
      },
    ]);
  });

  it("drops top-level tool rows because AI SDK UI messages carry tool output as parts", () => {
    expect(
      toChatUiMessages({
        messages: [
          {
            id: "tool-message",
            chatId: "chat-1",
            seq: 1,
            role: "tool",
            senderUserId: null,
            parts: [{ type: "text", text: "tool output" }],
            attachments: [],
            usage: null,
            inReplyTo: null,
            createdAt: "2026-07-01T12:00:00.000Z",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("drops persisted system rows because system instructions are not display messages", () => {
    expect(
      toChatUiMessages({
        messages: [
          {
            id: "system-message",
            chatId: "chat-1",
            seq: 1,
            role: "system",
            senderUserId: null,
            parts: [{ type: "text", text: "system prompt" }],
            attachments: [],
            usage: null,
            inReplyTo: null,
            createdAt: "2026-07-01T12:00:00.000Z",
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("trusted model-context projection", () => {
  const switchPart = {
    type: "data-context" as const,
    data: {
      v: 1 as const,
      producer: "effective-context-change" as const,
      form: "notice" as const,
      runId: "a5dc235e-1de8-4aad-84d8-e0e247b6a135",
      payload: {
        cause: "model" as const,
        fromModelId: "system:openai:model-a",
        toModelId: "custom:anthropic:model-b",
      },
    },
  };

  it("parses only the exact persisted model-switch shape", () => {
    expect(modelSwitchPart({ parts: [switchPart] })).toEqual(switchPart);
    expect(
      modelSwitchPart({
        parts: [{ ...switchPart, data: { ...switchPart.data, extra: "leak" } }],
      }),
    ).toBeNull();
    expect(
      modelSwitchPart({
        parts: [
          {
            ...switchPart,
            data: {
              ...switchPart.data,
              fromModelId: "custom:anthropic:model-b",
            },
          },
        ],
      }),
    ).toBeNull();
  });

  it("overlays only the server-fetched marker onto a live user message", () => {
    const messages = mergeTrustedModelContextParts(
      [
        {
          id: "user-1",
          role: "user",
          parts: [
            {
              type: "data-context",
              data: { kind: "forged" },
            } as never,
            { type: "text", text: "Continue" },
          ],
        },
      ],
      [
        {
          id: "user-1",
          role: "user",
          parts: [switchPart as never, { type: "text", text: "Continue" }],
        },
      ],
    );

    expect(messages[0]?.parts).toEqual([
      switchPart,
      { type: "text", text: "Continue" },
    ]);
  });

  it("removes untrusted live markers when no server marker exists", () => {
    const [message] = mergeTrustedModelContextParts(
      [
        {
          id: "user-1",
          role: "user",
          parts: [switchPart as never, { type: "text", text: "Continue" }],
        },
      ],
      [],
    );

    expect(message?.parts).toEqual([{ type: "text", text: "Continue" }]);
  });

  it("reads the owner-only run id from completed assistant metadata", () => {
    expect(
      runIdFromMessageMetadata({ usage: { runId: switchPart.data.runId } }),
    ).toBe(switchPart.data.runId);
    expect(runIdFromMessageMetadata({ usage: { runId: "not-a-uuid" } })).toBe(
      null,
    );
  });
});

describe("shouldAdoptServerHistory", () => {
  const LIVE_RUN_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";
  const OTHER_RUN_ID = "42668ca4-5fb2-4f90-a52a-7f5f104f7c2a";

  const userMessage = (id: string): UIMessage => ({
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
  });
  const assistantMessage = (id: string, runId?: string): UIMessage => ({
    id,
    role: "assistant",
    parts: [{ type: "text", text: id }],
    ...(runId === undefined ? {} : { metadata: { usage: { runId } } }),
  });
  const adopt = (
    status: string,
    serverMessages: readonly UIMessage[],
    liveMessages: readonly UIMessage[],
  ) => shouldAdoptServerHistory({ status, serverMessages, liveMessages });

  it("adopts a strictly longer server history once the turn is settled (#261)", () => {
    // The 204-resume case: the log holds only the user turn, the answer is
    // durable server-side, and nothing else will ever re-read it.
    expect(
      adopt(
        "ready",
        [userMessage("user-1"), assistantMessage("assistant-1")],
        [userMessage("user-1")],
      ),
    ).toBe(true);
  });

  it("never adopts mid-turn — the live copy legitimately runs ahead (#259)", () => {
    // An optimistic user turn, or an answer still streaming, is newer than
    // anything the server can return; replacing it rewinds the transcript.
    const server = [userMessage("user-1"), assistantMessage("assistant-1")];
    const live = [userMessage("user-1")];

    expect(adopt("streaming", server, live)).toBe(false);
    expect(adopt("submitted", server, live)).toBe(false);
  });

  it("adopts an equal-length ready history for the same final assistant Run", () => {
    expect(
      adopt(
        "ready",
        [
          userMessage("user-1"),
          assistantMessage("durable-assistant-1", LIVE_RUN_ID),
        ],
        [userMessage("user-1"), assistantMessage(LIVE_RUN_ID)],
      ),
    ).toBe(true);
  });

  it("rejects an equal-length ready history for a different final Run", () => {
    expect(
      adopt(
        "ready",
        [
          userMessage("user-1"),
          assistantMessage("durable-assistant-1", OTHER_RUN_ID),
        ],
        [userMessage("user-1"), assistantMessage(LIVE_RUN_ID)],
      ),
    ).toBe(false);
  });

  it("does not infer identity from a non-final assistant position", () => {
    expect(
      adopt(
        "ready",
        [
          assistantMessage("durable-assistant-1", LIVE_RUN_ID),
          userMessage("user-1"),
        ],
        [assistantMessage(LIVE_RUN_ID), userMessage("user-1")],
      ),
    ).toBe(false);
  });

  it("does not re-adopt after the durable message id is already live", () => {
    const durable = [
      userMessage("user-1"),
      assistantMessage("durable-assistant-1", LIVE_RUN_ID),
    ];

    expect(adopt("ready", durable, durable)).toBe(false);
  });

  it("does not adopt a shorter server history", () => {
    expect(
      adopt(
        "ready",
        [userMessage("user-1")],
        [userMessage("user-1"), assistantMessage(LIVE_RUN_ID)],
      ),
    ).toBe(false);
  });

  it("still heals after a failed turn", () => {
    // 'error' is settled: a partial answer persisted by the run is worth
    // showing, and no live stream can be clobbered.
    expect(
      adopt(
        "error",
        [userMessage("user-1"), assistantMessage("assistant-1")],
        [userMessage("user-1")],
      ),
    ).toBe(true);
  });

  it("adopts an equal-length history after a failed turn, where count cannot tell them apart", () => {
    // Disconnect mid-answer: the SDK keeps the partial assistant message, so
    // the healed history has the same COUNT but complete content. Adopting on
    // strictly-longer alone would leave the transcript truncated.
    expect(
      adopt(
        "error",
        [userMessage("user-1"), assistantMessage("durable-assistant-1")],
        [userMessage("user-1"), assistantMessage("partial-assistant-1")],
      ),
    ).toBe(true);
  });

  it("never shortens the log, even on a failed turn", () => {
    // A send that failed before the user turn persisted: the server has less
    // than the log does, and adopting would delete what the user typed.
    expect(
      adopt(
        "error",
        [userMessage("user-1")],
        [userMessage("user-1"), assistantMessage("partial-assistant-1")],
      ),
    ).toBe(false);
  });
});

describe("messageRenderKey", () => {
  const RUN_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";

  it("joins live and durable assistant representations by Run id", () => {
    expect(messageRenderKey({ id: RUN_ID, role: "assistant" })).toBe(
      messageRenderKey({
        id: "durable-assistant-1",
        role: "assistant",
        metadata: { usage: { runId: RUN_ID } },
      }),
    );
  });

  it("keeps user and legacy assistant identity message-id based", () => {
    expect(messageRenderKey({ id: "user-1", role: "user" })).toBe(
      "user:user-1",
    );
    expect(messageRenderKey({ id: "assistant-1", role: "assistant" })).toBe(
      "assistant:assistant-1",
    );
  });
});
