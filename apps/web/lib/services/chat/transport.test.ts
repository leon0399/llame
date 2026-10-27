import { describe, expect, it } from "vitest";

import {
  buildChatMessagesUrl,
  buildChatStreamUrl,
  buildFollowUpRunUrl,
  type ChatSendBody,
  type ChatTransportRequestOptions,
  followUpRunRequest,
  NO_FOLLOW_UP_ACTION_ERROR,
  prepareReconnectToStreamRequest,
  prepareSendMessagesRequest,
} from "./transport";

/** The chat-send body of a prepared request, proven to be a send rather than a
 *  follow-up (the api tells the two apart by `action`). */
function sendBody(options: ChatTransportRequestOptions): ChatSendBody {
  const { body } = prepareSendMessagesRequest(options);
  if ("action" in body) throw new Error("expected a chat-send body");
  return body;
}

describe("chat transport urls", () => {
  it("builds the send, resume, and follow-up endpoints for a chat", () => {
    expect(buildChatMessagesUrl("chat-1")).toMatch(
      /\/api\/v1\/chats\/chat-1\/messages$/,
    );
    expect(buildChatStreamUrl("chat-1")).toMatch(
      /\/api\/v1\/chats\/chat-1\/stream$/,
    );
    expect(buildFollowUpRunUrl("chat-1", "message-1")).toMatch(
      /\/api\/v1\/chats\/chat-1\/messages\/message-1\/runs$/,
    );
  });

  it("points reconnectToStream at the resume endpoint for the chat id (#49)", () => {
    const request = prepareReconnectToStreamRequest({ id: "chat-42" });
    expect(request.api).toMatch(/\/api\/v1\/chats\/chat-42\/stream$/);
  });
});

describe("prepareSendMessagesRequest", () => {
  it("sends ONLY the last message — the server owns history", () => {
    // SAFETY: `PrepareSendMessagesOptions["messages"]` is
    // `Pick<UIMessage, "id" | "parts">[]` — the fixture's extra `role` field
    // (kept for readability alongside other message fixtures) makes this an
    // excess-property mismatch, not an unsound value; `as never` opts out of
    // that structural check.
    const body = sendBody({
      chatId: "chat-1",
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
    // SAFETY: same excess-property mismatch as above — the fixture message
    // carries a `role` field beyond `Pick<UIMessage, "id" | "parts">`.
    const body = sendBody({
      chatId: "chat-1",
      modelId: "system:openai:reasoner",
      effort: "xhigh",
      messages: [{ id: "m1", role: "user", parts: [] }],
    } as never);
    expect(body.effort).toBe("xhigh");
  });

  // Absent, never null or "": the api rejects a blank effort with 400 and
  // treats absence as "resolve this model's own defaultEffort".
  it.each([undefined, ""])("omits the effort field for %p", (effort) => {
    // SAFETY: same excess-property mismatch as above — the fixture message
    // carries a `role` field beyond `Pick<UIMessage, "id" | "parts">`.
    const body = sendBody({
      chatId: "chat-1",
      modelId: "system:openai:reasoner",
      effort,
      messages: [{ id: "m1", role: "user", parts: [] }],
    } as never);
    expect(body).not.toHaveProperty("effort");
  });

  it("sends a selected permission mode verbatim", () => {
    // SAFETY: same excess-property mismatch as above — the fixture message
    // carries a `role` field beyond `Pick<UIMessage, "id" | "parts">`.
    const body = sendBody({
      chatId: "chat-1",
      modelId: "system:openai:reasoner",
      permissionMode: "bypass",
      messages: [{ id: "m1", role: "user", parts: [] }],
    } as never);
    expect(body.permissionMode).toBe("bypass");
  });

  it.each([undefined, "default"])(
    "omits the permission mode field for %p",
    (permissionMode) => {
      // SAFETY: same excess-property mismatch as above — the fixture message
      // carries a `role` field beyond `Pick<UIMessage, "id" | "parts">`.
      const body = sendBody({
        chatId: "chat-1",
        modelId: "system:openai:reasoner",
        permissionMode,
        messages: [{ id: "m1", role: "user", parts: [] }],
      } as never);
      expect(body).not.toHaveProperty("permissionMode");
    },
  );

  it("rejects an empty message list", () => {
    // SAFETY: this fixture omits the required `modelId` on purpose — it
    // proves the empty-messages runtime check throws before that field is
    // ever read, so a deliberately invalid literal is exactly the point;
    // `as never` opts out of the compile-time required-field check.
    expect(() => prepareSendMessagesRequest({ messages: [] } as never)).toThrow(
      /empty chat request/i,
    );
  });

  it("rejects a missing selected model", () => {
    // SAFETY: same excess-property mismatch as the tests above (fixture
    // message carries `role`); `modelId` itself is intentionally blank to
    // exercise the runtime guard, which is a valid `string`, not a type hole.
    expect(() =>
      prepareSendMessagesRequest({
        chatId: "chat-1",
        modelId: " ",
        messages: [{ id: "m1", role: "user", parts: [] }],
      } as never),
    ).toThrow(/selected model/i);
  });

  it("refuses a chat send with no model resolved yet", () => {
    // `modelId: undefined` is what the composer holds before the catalog
    // resolves; the send path must refuse it rather than shape a request
    // without a model.
    expect(() =>
      prepareSendMessagesRequest({
        chatId: "chat-1",
        modelId: undefined,
        messages: [{ id: "m1", parts: [] }],
      }),
    ).toThrow(/selected model/i);
  });
});

describe("follow-up requests", () => {
  const USER_MESSAGE = { id: "user-1", parts: [] };

  it("routes a continue to the follow-up route with the composer's mode", () => {
    const request = prepareSendMessagesRequest({
      chatId: "chat-1",
      trigger: "regenerate-message",
      followUp: { action: "continue", permissionMode: "bypass" },
      modelId: "system:openai:composer-model",
      effort: "high",
      messages: [USER_MESSAGE],
    });
    expect(request.api).toMatch(
      /\/api\/v1\/chats\/chat-1\/messages\/user-1\/runs$/,
    );
    // Continue takes its model and effort from the Run it resumes, so the
    // composer's values must not ride along.
    expect(request.body).toEqual({
      action: "continue",
      permissionMode: "bypass",
    });
  });

  it.each([undefined, "default"] as const)(
    "omits the permission mode field for a %p continue",
    (permissionMode) => {
      const request = prepareSendMessagesRequest({
        chatId: "chat-1",
        trigger: "regenerate-message",
        followUp: { action: "continue", permissionMode },
        modelId: "system:openai:composer-model",
        messages: [USER_MESSAGE],
      });
      expect(request.body).toEqual({ action: "continue" });
    },
  );

  it("sends the latest Run's own settings on a plain regenerate", () => {
    const request = prepareSendMessagesRequest({
      chatId: "chat-1",
      trigger: "regenerate-message",
      followUp: {
        action: "regenerate",
        modelId: "system:openai:previous",
        effort: "low",
        permissionMode: "bypass",
      },
      // The composer shows another model; a plain click repeats the Run.
      modelId: "system:openai:composer-model",
      effort: "high",
      messages: [USER_MESSAGE],
    });
    expect(request.body).toEqual({
      action: "regenerate",
      modelId: "system:openai:previous",
      effort: "low",
      permissionMode: "bypass",
    });
  });

  it("keys a follow-up on the user message of a turn with no reply", () => {
    const request = prepareSendMessagesRequest({
      chatId: "chat-1",
      trigger: "regenerate-message",
      followUp: { action: "regenerate", modelId: "system:openai:previous" },
      modelId: undefined,
      messages: [
        { id: "user-1", parts: [] },
        // The failed Run left no reply row, so the user turn is the last
        // message the SDK hands the transport.
      ],
    });
    expect(request.api).toMatch(/\/messages\/user-1\/runs$/);
    expect(request.body).toEqual({
      action: "regenerate",
      modelId: "system:openai:previous",
    });
  });

  it("refuses a follow-up without an action", () => {
    expect(() =>
      prepareSendMessagesRequest({
        chatId: "chat-1",
        trigger: "regenerate-message",
        modelId: "system:openai:composer-model",
        messages: [USER_MESSAGE],
      }),
    ).toThrow(NO_FOLLOW_UP_ACTION_ERROR);
  });

  it("refuses a regenerate body that names no model", () => {
    expect(() =>
      prepareSendMessagesRequest({
        chatId: "chat-1",
        trigger: "regenerate-message",
        followUp: { action: "regenerate" },
        modelId: "system:openai:composer-model",
        messages: [USER_MESSAGE],
      }),
    ).toThrow(NO_FOLLOW_UP_ACTION_ERROR);
  });
});

describe("followUpRunRequest", () => {
  it("drops the fields an action does not accept", () => {
    expect(
      followUpRunRequest({
        action: "continue",
        modelId: "system:openai:previous",
        effort: "low",
      }),
    ).toEqual({ action: "continue" });
  });

  it("drops a blank effort and a default permission mode", () => {
    expect(
      followUpRunRequest({
        action: "regenerate",
        modelId: "system:openai:previous",
        effort: "",
        permissionMode: "default",
      }),
    ).toEqual({ action: "regenerate", modelId: "system:openai:previous" });
  });

  it("rejects a body that is not a follow-up request", () => {
    expect(followUpRunRequest(undefined)).toBeNull();
    expect(followUpRunRequest({ action: "delete" })).toBeNull();
    expect(
      followUpRunRequest({ action: "regenerate", modelId: " " }),
    ).toBeNull();
  });
});
