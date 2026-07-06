import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText, messageText } from "./clipboard";

describe("messageText", () => {
  it("concatenates text parts and skips non-text parts", () => {
    expect(
      messageText([
        { type: "reasoning", text: "hidden thinking" },
        { type: "text", text: "Hello" },
        { type: "dynamic-tool", toolName: "x" },
        { type: "text", text: "world" },
      ]),
    ).toBe("Hello\n\nworld");
  });

  it("returns empty when there are no text parts", () => {
    expect(messageText([{ type: "reasoning", text: "x" }])).toBe("");
    expect(messageText([])).toBe("");
  });
});

describe("copyText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("hi")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hi");
  });

  it("degrades gracefully (returns false, never throws) when no clipboard API and no DOM", async () => {
    vi.stubGlobal("navigator", {}); // no clipboard (insecure context)
    // No `document` in the node test env → the legacy fallback can't run.
    await expect(copyText("hi")).resolves.toBe(false);
  });

  it("swallows a clipboard write rejection and does not throw", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    // Rejected write → falls through; no DOM → false, but crucially no throw.
    await expect(copyText("hi")).resolves.toBe(false);
  });
});
