import { describe, expect, it } from "vitest";

import {
  buildChatMessagesUrl,
  buildChatStreamUrl,
  prepareReconnectToStreamRequest,
  prepareSendMessagesRequest,
} from "./transport";

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
      modelId: "system:openai:gpt-5.4-mini",
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "old" }] },
        { id: "m2", role: "user", parts: [{ type: "text", text: "new" }] },
      ],
    } as never);
    expect(body.modelId).toBe("system:openai:gpt-5.4-mini");
    expect(body.message.id).toBe("m2");
    expect(body.message.parts).toEqual([{ type: "text", text: "new" }]);
    expect(JSON.stringify(body)).not.toContain("m1");
  });

  it("sends a selected effort verbatim", () => {
    const { body } = prepareSendMessagesRequest({
      modelId: "system:openai:reasoner",
      effort: "xhigh",
      messages: [{ id: "m1", role: "user", parts: [] }],
    } as never);
    expect(body.effort).toBe("xhigh");
  });

  // Absent, never null or "": the api rejects a blank effort with 400 and
  // treats absence as "resolve this model's own defaultEffort".
  it.each([undefined, ""])("omits the effort field for %p", (effort) => {
    const { body } = prepareSendMessagesRequest({
      modelId: "system:openai:reasoner",
      effort,
      messages: [{ id: "m1", role: "user", parts: [] }],
    } as never);
    expect(body).not.toHaveProperty("effort");
  });

  it("rejects an empty message list", () => {
    expect(() => prepareSendMessagesRequest({ messages: [] } as never)).toThrow(
      /empty chat request/i,
    );
  });

  it("rejects a missing selected model", () => {
    expect(() =>
      prepareSendMessagesRequest({
        modelId: " ",
        messages: [{ id: "m1", role: "user", parts: [] }],
      } as never),
    ).toThrow(/selected model/i);
  });
});
