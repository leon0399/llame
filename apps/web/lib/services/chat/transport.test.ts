import { describe, expect, it } from "vitest";

import {
  buildChatMessagesUrl,
  buildChatStreamUrl,
  prepareReconnectToStreamRequest,
  prepareSendMessagesRequest,
} from "./transport";

const lastMessage = {
  id: "m-1",
  parts: [{ type: "text" as const, text: "hi" }],
};

describe("chat transport urls", () => {
  it("builds the send and resume endpoints for a chat", () => {
    expect(buildChatMessagesUrl("chat-1")).toMatch(
      /\/api\/v1\/chats\/chat-1\/messages$/,
    );
    expect(buildChatStreamUrl("chat-1")).toMatch(
      /\/api\/v1\/chats\/chat-1\/stream$/,
    );
  });

  it("points reconnectToStream at the resume endpoint for the chat id (#49)", () => {
    const request = prepareReconnectToStreamRequest({ id: "chat-42" });
    expect(request.api).toMatch(/\/api\/v1\/chats\/chat-42\/stream$/);
  });
});

describe("prepareSendMessagesRequest", () => {
  it("sends ONLY the last message — the server owns history", () => {
    const { body } = prepareSendMessagesRequest({
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "old" }] },
        { id: "m2", role: "user", parts: [{ type: "text", text: "new" }] },
      ],
    } as never);
    expect(body.message.id).toBe("m2");
    expect(body.message.parts).toEqual([{ type: "text", text: "new" }]);
    expect(JSON.stringify(body)).not.toContain("m1");
  });

  it("rejects an empty message list", () => {
    expect(() => prepareSendMessagesRequest({ messages: [] } as never)).toThrow(
      /empty chat request/i,
    );
  });
});

describe("prepareSendMessagesRequest model selection (#76)", () => {
  it("forwards a selected model from the request body", () => {
    const request = prepareSendMessagesRequest({
      messages: [lastMessage],
      body: { model: "openai/gpt-5.4-mini" },
    });
    expect(request.body.message.model).toBe("openai/gpt-5.4-mini");
    expect(request.body.message.id).toBe("m-1");
  });

  it("omits the model when none is supplied (api uses the caller default)", () => {
    const request = prepareSendMessagesRequest({ messages: [lastMessage] });
    expect(request.body.message).not.toHaveProperty("model");
  });

  it("omits a blank or non-string model", () => {
    expect(
      prepareSendMessagesRequest({
        messages: [lastMessage],
        body: { model: "" },
      }).body.message,
    ).not.toHaveProperty("model");
    expect(
      prepareSendMessagesRequest({
        messages: [lastMessage],
        body: { model: 123 },
      }).body.message,
    ).not.toHaveProperty("model");
  });
});
