import { describe, expect, it } from "vitest";

import { isNewChatShortcut, isPaletteToggle } from "./command-palette";

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

const chord = (
  overrides: Partial<{
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }>,
) => ({
  key: "O",
  metaKey: false,
  ctrlKey: false,
  shiftKey: true,
  altKey: false,
  ...overrides,
});

describe("isNewChatShortcut", () => {
  it.each([
    ["Ctrl+Shift+O off a Mac", chord({ ctrlKey: true }), false, true],
    ["⌘+Shift+O on a Mac", chord({ metaKey: true }), true, true],
    [
      "lowercase key with Shift held",
      chord({ ctrlKey: true, key: "o" }),
      false,
      true,
    ],
    ["Ctrl+Shift+O on a Mac", chord({ ctrlKey: true }), true, false],
    ["⌘+Shift+O off a Mac", chord({ metaKey: true }), false, false],
    ["without Shift", chord({ ctrlKey: true, shiftKey: false }), false, false],
    ["with Alt too", chord({ ctrlKey: true, altKey: true }), false, false],
    [
      "with both modifiers",
      chord({ ctrlKey: true, metaKey: true }),
      false,
      false,
    ],
    ["another key", chord({ ctrlKey: true, key: "P" }), false, false],
  ] as const)("%s → %s", (_name, event, isMac, expected) => {
    expect(isNewChatShortcut(event, isMac)).toBe(expected);
  });
});
