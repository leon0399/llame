import { describe, expect, it } from "vitest";

import { isPaletteToggle } from "./command-palette";

describe("isPaletteToggle", () => {
  it("on macOS: Cmd+K toggles, Ctrl+K does NOT (Emacs kill-line binding)", () => {
    expect(
      isPaletteToggle({ key: "k", metaKey: true, ctrlKey: false }, true),
    ).toBe(true);
    expect(
      isPaletteToggle({ key: "k", metaKey: false, ctrlKey: true }, true),
    ).toBe(false);
  });

  it("off macOS: Ctrl+K toggles, Cmd/Win+K does NOT", () => {
    expect(
      isPaletteToggle({ key: "K", metaKey: false, ctrlKey: true }, false),
    ).toBe(true);
    expect(
      isPaletteToggle({ key: "k", metaKey: true, ctrlKey: false }, false),
    ).toBe(false);
  });

  it("ignores plain k and other modified keys", () => {
    expect(
      isPaletteToggle({ key: "k", metaKey: false, ctrlKey: false }, true),
    ).toBe(false);
    expect(
      isPaletteToggle({ key: "j", metaKey: true, ctrlKey: false }, true),
    ).toBe(false);
  });

  it("ignores the primary modifier + K when an EXTRA modifier is also held (Cmd+Shift+K, Ctrl+Alt+K)", () => {
    expect(
      isPaletteToggle(
        { key: "k", metaKey: true, ctrlKey: false, shiftKey: true },
        true,
      ),
    ).toBe(false);
    expect(
      isPaletteToggle(
        { key: "k", metaKey: false, ctrlKey: true, altKey: true },
        false,
      ),
    ).toBe(false);
  });
});
