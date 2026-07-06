import { afterEach, describe, expect, it } from "vitest";
import { buildChatMessagesHistoryUrl, toChatUiMessages } from "./history";

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
