import { describe, expect, it } from "vitest";

import {
  ariaKeyShortcut,
  chordFromEvent,
  chordId,
  formatChord,
  matchChord,
} from "./chord";
import { findConflicts } from "./definitions";

const key = (
  value: string,
  held: Partial<
    Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>
  > = {},
) => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...held,
});

const MOD_K = { key: "k", mod: true };

describe("matchChord", () => {
  it("on macOS: Cmd+K matches, Ctrl+K does not (Emacs kill-line)", () => {
    expect(matchChord(key("k", { metaKey: true }), MOD_K, true)).toBe(true);
    expect(matchChord(key("k", { ctrlKey: true }), MOD_K, true)).toBe(false);
  });

  it("off macOS: Ctrl+K matches, Win+K does not", () => {
    expect(matchChord(key("K", { ctrlKey: true }), MOD_K, false)).toBe(true);
    expect(matchChord(key("k", { metaKey: true }), MOD_K, false)).toBe(false);
  });

  it("rejects missing and extra modifiers", () => {
    expect(matchChord(key("k"), MOD_K, true)).toBe(false);
    expect(
      matchChord(key("k", { metaKey: true, shiftKey: true }), MOD_K, true),
    ).toBe(false);
    expect(
      matchChord(key("k", { metaKey: true, altKey: true }), MOD_K, true),
    ).toBe(false);
    expect(
      matchChord(key("Escape", { metaKey: true }), { key: "Escape" }, true),
    ).toBe(false);
  });

  it("matches a bare key and a shifted chord exactly", () => {
    expect(matchChord(key("Escape"), { key: "Escape" }, false)).toBe(true);
    expect(
      matchChord(
        key("O", { ctrlKey: true, shiftKey: true }),
        { key: "o", mod: true, shift: true },
        false,
      ),
    ).toBe(true);
  });
});

describe("chordFromEvent", () => {
  it("records the primary modifier and lowercases a letter", () => {
    expect(
      chordFromEvent(key("J", { metaKey: true, shiftKey: true }), true),
    ).toEqual({
      key: "j",
      mod: true,
      shift: true,
    });
  });

  it("ignores a lone modifier and the non-primary modifier", () => {
    expect(chordFromEvent(key("Shift", { shiftKey: true }), false)).toBeNull();
    expect(chordFromEvent(key("k", { ctrlKey: true }), true)).toBeNull();
    expect(chordFromEvent(key("k", { metaKey: true }), false)).toBeNull();
  });
});

describe("formatting", () => {
  it("prints chords the way Kbd hints do", () => {
    expect(formatChord({ key: "o", mod: true, shift: true }, "⌘")).toBe(
      "⌘+Shift+O",
    );
    expect(formatChord(MOD_K, "Ctrl")).toBe("Ctrl+K");
    expect(formatChord({ key: "Escape" }, "Ctrl")).toBe("Esc");
  });

  it("names modifiers for aria-keyshortcuts", () => {
    expect(ariaKeyShortcut({ key: "u", mod: true }, true)).toBe("Meta+U");
    expect(ariaKeyShortcut({ key: "u", mod: true }, false)).toBe("Control+U");
  });

  it("gives equal chords one id regardless of key case", () => {
    expect(chordId({ key: "K", mod: true })).toBe(chordId(MOD_K));
  });
});

describe("findConflicts", () => {
  it("pairs equal chords both ways and leaves the rest alone", () => {
    const conflicts = findConflicts([
      { id: "chat.new", chord: MOD_K },
      { id: "palette.toggle", chord: { key: "K", mod: true } },
      { id: "composer.attach", chord: { key: "u", mod: true } },
    ]);

    expect(conflicts.get("chat.new")).toEqual(["palette.toggle"]);
    expect(conflicts.get("palette.toggle")).toEqual(["chat.new"]);
    expect(conflicts.has("composer.attach")).toBe(false);
  });

  it("does not confuse a chord with its shifted variant", () => {
    expect(
      findConflicts([
        { id: "composer.send", chord: { key: "Enter" } },
        { id: "composer.newline", chord: { key: "Enter", shift: true } },
      ]).size,
    ).toBe(0);
  });
});
