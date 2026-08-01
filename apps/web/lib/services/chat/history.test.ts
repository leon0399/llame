import { afterEach, describe, expect, it } from "vitest";
import {
  buildChatMessagesHistoryUrl,
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
    type: "data-model-context" as const,
    data: {
      kind: "model_switch" as const,
      fromModelId: "system:openai:model-a",
      toModelId: "custom:anthropic:model-b",
      runId: "a5dc235e-1de8-4aad-84d8-e0e247b6a135",
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
              type: "data-model-context",
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
  const adopt = (
    status: string,
    serverMessageCount: number,
    liveMessageCount: number,
  ) =>
    shouldAdoptServerHistory({ status, serverMessageCount, liveMessageCount });

  it("adopts a strictly longer server history once the turn is settled (#261)", () => {
    // The 204-resume case: the log holds only the user turn, the answer is
    // durable server-side, and nothing else will ever re-read it.
    expect(adopt("ready", 2, 1)).toBe(true);
  });

  it("never adopts mid-turn — the live copy legitimately runs ahead (#259)", () => {
    // An optimistic user turn, or an answer still streaming, is newer than
    // anything the server can return; replacing it rewinds the transcript.
    expect(adopt("streaming", 3, 2)).toBe(false);
    expect(adopt("submitted", 3, 2)).toBe(false);
  });

  it("does not adopt an equal or shorter server history", () => {
    // Equal is the steady state (and what the adoption itself produces, so
    // re-running is a no-op); shorter means the server has yet to catch up.
    expect(adopt("ready", 2, 2)).toBe(false);
    expect(adopt("ready", 1, 2)).toBe(false);
  });

  it("still heals after a failed turn", () => {
    // 'error' is settled: a partial answer persisted by the run is worth
    // showing, and no live stream can be clobbered.
    expect(adopt("error", 2, 1)).toBe(true);
  });
});
