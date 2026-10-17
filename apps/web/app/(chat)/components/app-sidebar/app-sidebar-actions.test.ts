import { describe, expect, it } from "vitest";

import { isNewChatShortcut } from "./app-sidebar-actions";

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
