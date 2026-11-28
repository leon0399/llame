// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  draftChatPath,
  draftChatPathWithHash,
  draftPhaseFromSearchParam,
  replaceDraftUrl,
} from "./draft-route";

const CHAT_ID = "chat-123";

const draftPhaseCases: Array<
  [string | Array<string> | undefined, "sent" | null]
> = [
  ["fresh", null],
  ["sent", "sent"],
  [undefined, null],
  ["unknown", null],
  [["fresh"], null],
];

describe("draftPhaseFromSearchParam", () => {
  it.each(draftPhaseCases)("maps %j to %j", (value, expected) => {
    expect(draftPhaseFromSearchParam(value)).toBe(expected);
  });
});

describe("draftChatPath", () => {
  it("keeps a fresh draft on the new-chat page", () => {
    expect(draftChatPath(CHAT_ID, "fresh")).toBe("/");
  });

  it("adds the sent draft phase as a query parameter", () => {
    expect(draftChatPath(CHAT_ID, "sent")).toBe(`/chat/${CHAT_ID}?draft=sent`);
  });

  it("omits the query parameter when there is no draft phase", () => {
    expect(draftChatPath(CHAT_ID, null)).toBe(`/chat/${CHAT_ID}`);
  });

  it("preserves a message target hash when changing the draft phase", () => {
    expect(draftChatPathWithHash(CHAT_ID, "sent", "#msg-900")).toBe(
      `/chat/${CHAT_ID}?draft=sent#msg-900`,
    );
  });

  it("preserves malformed hashes verbatim for navigation state", () => {
    expect(draftChatPathWithHash(CHAT_ID, null, "#not-a-target")).toBe(
      `/chat/${CHAT_ID}#not-a-target`,
    );
  });
});

describe("replaceDraftUrl", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("keeps the router's history state when only the query changes", () => {
    window.history.replaceState({ __NA: true }, "", `/chat/${CHAT_ID}`);
    const replace = vi.spyOn(window.history, "replaceState");

    replaceDraftUrl(`/chat/${CHAT_ID}?draft=sent`);

    expect(replace).toHaveBeenCalledWith(
      { __NA: true },
      "",
      `/chat/${CHAT_ID}?draft=sent`,
    );
  });

  it("passes no state when the path changes, so the router adopts it", () => {
    window.history.replaceState({ __NA: true }, "", "/");
    const replace = vi.spyOn(window.history, "replaceState");

    replaceDraftUrl(`/chat/${CHAT_ID}?draft=sent`);

    expect(replace).toHaveBeenCalledWith(
      null,
      "",
      `/chat/${CHAT_ID}?draft=sent`,
    );
  });
});
