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

const submitMessage = (r: { body: Record<string, unknown> }) =>
  r.body.message as { id: string; model?: string };

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
      id: "chat-1",
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "old" }] },
        { id: "m2", role: "user", parts: [{ type: "text", text: "new" }] },
      ],
    } as never);
    const message = body.message as {
      id: string;
      parts: { type: string; text: string }[];
    };
    expect(message.id).toBe("m2");
    expect(message.parts).toEqual([{ type: "text", text: "new" }]);
    expect(JSON.stringify(body)).not.toContain("m1");
  });

  it("rejects an empty message list", () => {
    expect(() =>
      prepareSendMessagesRequest({ id: "chat-1", messages: [] } as never),
    ).toThrow(/empty chat request/i);
  });
});

describe("prepareSendMessagesRequest model selection (#76)", () => {
  it("forwards a selected model from the request body", () => {
    const request = prepareSendMessagesRequest({
      id: "chat-1",
      messages: [lastMessage],
      body: { model: "openai/gpt-5.4-mini" },
    });
    expect(submitMessage(request).model).toBe("openai/gpt-5.4-mini");
    expect(submitMessage(request).id).toBe("m-1");
  });

  it("omits the model when none is supplied (api uses the caller default)", () => {
    const request = prepareSendMessagesRequest({
      id: "chat-1",
      messages: [lastMessage],
    });
    expect(submitMessage(request)).not.toHaveProperty("model");
  });

  it("omits a blank or non-string model", () => {
    expect(
      submitMessage(
        prepareSendMessagesRequest({
          id: "chat-1",
          messages: [lastMessage],
          body: { model: "" },
        }),
      ),
    ).not.toHaveProperty("model");
    expect(
      submitMessage(
        prepareSendMessagesRequest({
          id: "chat-1",
          messages: [lastMessage],
          body: { model: 123 },
        }),
      ),
    ).not.toHaveProperty("model");
  });
});

describe("prepareSendMessagesRequest regenerate routing", () => {
  it("routes a regenerate to POST /chats/:id/runs (not /messages) with the model", () => {
    const request = prepareSendMessagesRequest({
      id: "chat-9",
      messages: [lastMessage],
      body: { model: "openai/gpt-5.4-mini" },
      trigger: "regenerate-message",
    });
    expect(request.api).toMatch(/\/api\/v1\/chats\/chat-9\/runs$/);
    expect(request.body).toEqual({ model: "openai/gpt-5.4-mini" });
    // No user-message payload — the server targets the last turn itself.
    expect(request.body).not.toHaveProperty("message");
  });

  it("regenerate omits the model when none is selected", () => {
    const request = prepareSendMessagesRequest({
      id: "chat-9",
      messages: [lastMessage],
      trigger: "regenerate-message",
    });
    expect(request.api).toMatch(/\/runs$/);
    expect(request.body).toEqual({});
  });
});
