import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "./clipboard";

// This project runs vitest in the Node environment (no jsdom configured), so
// `navigator`/`document` don't exist by default — copyText itself relies on
// that (`typeof document === "undefined"` short-circuits). These tests stub
// just enough of each global to exercise the two code paths without pulling
// in a DOM implementation.
describe("copyText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when navigator.clipboard is absent (insecure context)", async () => {
    const removed = vi.fn();
    const textarea = { value: "", style: {}, select: vi.fn(), remove: removed };
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: () => textarea,
      body: { appendChild: vi.fn() },
      execCommand: vi.fn().mockReturnValue(true),
    });

    await expect(copyText("hello")).resolves.toBe(true);
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it("removes the fallback textarea even when execCommand throws", async () => {
    const removed = vi.fn();
    const textarea = { value: "", style: {}, select: vi.fn(), remove: removed };
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: () => textarea,
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => {
        throw new Error("blocked");
      }),
    });

    await expect(copyText("hello")).resolves.toBe(false);
    expect(removed).toHaveBeenCalledTimes(1);
  });
});
