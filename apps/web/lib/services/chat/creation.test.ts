import { describe, expect, it } from "vitest";

import {
  buildCreateChatRequest,
  createChatFailureMessage,
  workspaceFailure,
  type CreateChatDraft,
} from "./creation";

const SELECTION = {
  repositoryId: "repo-1",
  executorId: "machine:nas",
  checkoutId: "checkout-1",
};

function draft(overrides: Partial<CreateChatDraft> = {}): CreateChatDraft {
  return {
    chatId: "chat-1",
    messageId: "message-1",
    projectId: "project-1",
    selection: SELECTION,
    isolation: "reuse",
    message: {
      parts: [{ type: "text", text: "Start here" }],
      modelId: "model-1",
    },
    ...overrides,
  };
}

describe("buildCreateChatRequest", () => {
  it("sends the project, the location, and the message", () => {
    expect(buildCreateChatRequest(draft())).toEqual({
      id: "chat-1",
      projectId: "project-1",
      repositoryId: "repo-1",
      executorId: "machine:nas",
      checkoutId: "checkout-1",
      message: {
        id: "message-1",
        parts: [{ type: "text", text: "Start here" }],
        modelId: "model-1",
      },
    });
  });

  it("asks for a worktree only when isolating, as an empty object", () => {
    // The server names the worktree and cuts it from the source checkout.
    expect(
      buildCreateChatRequest(draft({ isolation: "worktree" })).worktree,
    ).toEqual({});
    expect(buildCreateChatRequest(draft()).worktree).toBeUndefined();
  });

  it("omits a blank effort and the safe permission mode", () => {
    const request = buildCreateChatRequest(
      draft({
        message: {
          parts: [{ type: "text", text: "Hi" }],
          modelId: "model-1",
          effort: "",
          permissionMode: "default",
        },
      }),
    );

    expect(request.message).toEqual({
      id: "message-1",
      parts: [{ type: "text", text: "Hi" }],
      modelId: "model-1",
    });
  });

  it("carries an effort and a bypass mode when chosen", () => {
    const request = buildCreateChatRequest(
      draft({
        message: {
          parts: [{ type: "text", text: "Hi" }],
          modelId: "model-1",
          effort: "high",
          permissionMode: "bypass",
        },
      }),
    );

    expect(request.message).toMatchObject({
      effort: "high",
      permissionMode: "bypass",
    });
  });
});

describe("workspaceFailure", () => {
  it("treats both usable statuses as no failure", () => {
    expect(workspaceFailure({ status: "bound", root: "/src" })).toBeNull();
    expect(workspaceFailure({ status: "unbound" })).toBeNull();
  });

  it("keeps the status and the server's sentence", () => {
    expect(
      workspaceFailure({
        status: "worktree_failed",
        code: "path_not_registered",
        message: "The path is outside the registered roots.",
      }),
    ).toEqual({
      status: "worktree_failed",
      message: "The path is outside the registered roots.",
    });
  });
});

describe("createChatFailureMessage", () => {
  it("reads the server's typed envelope", () => {
    const error = Object.assign(new Error("request failed"), {
      status: 422,
      info: { message: "The model is unavailable." },
    });

    expect(createChatFailureMessage(error)).toBe("The model is unavailable.");
  });

  it("falls back for a transport failure", () => {
    expect(createChatFailureMessage(new Error("network down"))).toBe(
      "The chat could not be created. Try again.",
    );
  });
});
