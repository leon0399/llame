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

  it.each([
    ["a query change", `/chat/${CHAT_ID}`, `/chat/${CHAT_ID}?draft=sent`],
    ["a path change", "/", `/chat/${CHAT_ID}?draft=sent`],
  ])("passes no state on %s, so the router adopts the URL", (_, from, to) => {
    window.history.replaceState({ __NA: true }, "", from);
    const replace = vi.spyOn(window.history, "replaceState");

    replaceDraftUrl(to);

    expect(replace).toHaveBeenCalledWith(null, "", to);
    expect(window.location.pathname + window.location.search).toBe(to);
  });
});
