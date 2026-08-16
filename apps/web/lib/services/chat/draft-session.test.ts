import { describe, expect, it } from "vitest";

import {
  draftPhaseForSession,
  initialDraftSession,
  reduceDraftSession,
  shouldQueryChatHistory,
  shouldRenderChatOwner,
  shouldResumeChat,
} from "./draft-session";

describe("initialDraftSession", () => {
  it("starts every owner-visible chat persisted and resumable", () => {
    expect(initialDraftSession(null, true)).toEqual({
      kind: "persisted",
      resumeRequested: true,
    });
    expect(initialDraftSession("fresh", true)).toEqual({
      kind: "persisted",
      resumeRequested: true,
    });
    expect(initialDraftSession("sent", true)).toEqual({
      kind: "persisted",
      resumeRequested: true,
    });
  });

  it("starts a missing fresh chat with its owner mounted", () => {
    const state = initialDraftSession("fresh", false);

    expect(state).toEqual({ kind: "fresh" });
    expect(shouldRenderChatOwner(state)).toBe(true);
    expect(shouldQueryChatHistory(state)).toBe(false);
  });

  it("recovers a missing sent chat before mounting its owner", () => {
    const state = initialDraftSession("sent", false);

    expect(state).toEqual({ kind: "recovering", ownerMounted: false });
    expect(shouldRenderChatOwner(state)).toBe(false);
    expect(shouldQueryChatHistory(state)).toBe(true);
  });
});

describe("reduceDraftSession", () => {
  it("marks the first send without enabling recovery early", () => {
    const state = reduceDraftSession(
      { kind: "fresh" },
      { type: "send-started" },
    );

    expect(state).toEqual({ kind: "sending" });
    expect(draftPhaseForSession(state)).toBe("sent");
    expect(shouldQueryChatHistory(state)).toBe(false);
  });

  it("keeps a live owner mounted when the first send needs recovery", () => {
    const state = reduceDraftSession(
      { kind: "sending" },
      { type: "send-failed" },
    );

    expect(state).toEqual({ kind: "recovering", ownerMounted: true });
    expect(shouldRenderChatOwner(state)).toBe(true);
    expect(shouldQueryChatHistory(state)).toBe(true);
  });

  it.each([false, true])(
    "requests one resume after history recovers (owner mounted: %s)",
    (ownerMounted) => {
      const state = reduceDraftSession(
        { kind: "recovering", ownerMounted },
        { type: "chat-visible" },
      );

      expect(state).toEqual({ kind: "persisted", resumeRequested: true });
      expect(shouldResumeChat(state)).toBe(true);
    },
  );

  it("returns to a usable fresh draft after final owner-scoped 404", () => {
    const state = reduceDraftSession(
      { kind: "recovering", ownerMounted: false },
      { type: "history-missing" },
    );

    expect(state).toEqual({ kind: "fresh" });
    expect(draftPhaseForSession(state)).toBe("fresh");
    expect(shouldRenderChatOwner(state)).toBe(true);
  });

  it("retains sent recovery intent for indeterminate failures", () => {
    const state = { kind: "recovering", ownerMounted: false } as const;

    expect(reduceDraftSession(state, { type: "history-indeterminate" })).toBe(
      state,
    );
    expect(draftPhaseForSession(state)).toBe("sent");
  });

  it("finishes normally without requesting a redundant resume", () => {
    const state = reduceDraftSession({ kind: "sending" }, { type: "finished" });

    expect(state).toEqual({ kind: "persisted", resumeRequested: false });
    expect(draftPhaseForSession(state)).toBeNull();
    expect(shouldResumeChat(state)).toBe(false);
  });
});
