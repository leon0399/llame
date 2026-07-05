import { describe, expect, it } from "vitest";

import { userMessageText } from "./message-text";

describe("userMessageText", () => {
  it("joins the text of text parts", () => {
    expect(
      userMessageText([
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ]),
    ).toBe("Hello world");
  });

  it("ignores non-text parts", () => {
    expect(
      userMessageText([
        { type: "text", text: "keep" },
        { type: "tool-search", text: undefined },
        { type: "step-start" },
      ]),
    ).toBe("keep");
  });

  it("is empty for no text parts", () => {
    expect(userMessageText([])).toBe("");
    expect(userMessageText([{ type: "step-start" }])).toBe("");
  });
});
