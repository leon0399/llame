import { describe, expect, it } from "vitest";

import {
  draftChatPath,
  draftChatPathWithHash,
  draftPhaseFromSearchParam,
  type DraftPhase,
} from "./draft-route";

const CHAT_ID = "chat-123";
const draftPhaseCases: Array<
  [string | Array<string> | undefined, DraftPhase | null]
> = [
  ["fresh", "fresh"],
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
  it("adds the fresh draft phase as a query parameter", () => {
    expect(draftChatPath(CHAT_ID, "fresh")).toBe(
      `/chat/${CHAT_ID}?draft=fresh`,
    );
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
