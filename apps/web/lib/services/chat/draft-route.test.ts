import { describe, expect, it } from "vitest";

import {
  draftChatPath,
  draftPhaseFromSearchParam,
  type DraftPhase,
} from "./draft-route";

const CHAT_ID = "chat-123";
const draftPhaseCases: Array<
  [string | string[] | undefined, DraftPhase | null]
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

  it("omits the query parameter when there is no draft phase", () => {
    expect(draftChatPath(CHAT_ID, null)).toBe(`/chat/${CHAT_ID}`);
  });
});
