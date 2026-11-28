import { chordId, type Chord } from "./chord";

export type ShortcutDefinition = {
  id: ShortcutId;
  label: string;
  group: "General" | "Chat" | "Composer";
  defaultChord: Chord;
  /** Dispatched by the shortcuts provider, so the owner can rebind it.
   *  Fixed ones are handled where they live (the textarea, the vendored
   *  sidebar) and are listed so their chords count for conflicts. */
  rebindable: boolean;
};

export const SHORTCUT_IDS = [
  "palette.toggle",
  "chat.new",
  "rail.toggle",
  "run.stop",
  "composer.attach",
  "composer.send",
  "composer.newline",
  "composer.queue",
] as const;

export type ShortcutId = (typeof SHORTCUT_IDS)[number];

export const SHORTCUTS: ReadonlyArray<ShortcutDefinition> = [
  {
    id: "palette.toggle",
    label: "Search chats and commands",
    group: "General",
    defaultChord: { key: "k", mod: true },
    rebindable: true,
  },
  {
    id: "chat.new",
    label: "New chat",
    group: "General",
    defaultChord: { key: "o", mod: true, shift: true },
    rebindable: true,
  },
  {
    id: "rail.toggle",
    label: "Show or hide the sidebar",
    group: "General",
    defaultChord: { key: "b", mod: true },
    rebindable: false,
  },
  {
    id: "run.stop",
    label: "Stop the running reply",
    group: "Chat",
    defaultChord: { key: "Escape" },
    rebindable: false,
  },
  {
    id: "composer.attach",
    label: "Attach photos & files",
    group: "Composer",
    defaultChord: { key: "u", mod: true },
    rebindable: true,
  },
  {
    id: "composer.send",
    label: "Send, or steer a running reply",
    group: "Composer",
    defaultChord: { key: "Enter" },
    rebindable: false,
  },
  {
    id: "composer.newline",
    label: "New line",
    group: "Composer",
    defaultChord: { key: "Enter", shift: true },
    rebindable: false,
  },
  {
    id: "composer.queue",
    label: "Queue after the running reply",
    group: "Composer",
    defaultChord: { key: "Enter", mod: true },
    rebindable: false,
  },
];

export const SHORTCUTS_BY_ID = new Map(SHORTCUTS.map((def) => [def.id, def]));

/**
 * For each shortcut, the others bound to the same chord. Every shortcut can
 * be live at once (the composer sits on every chat page, and document-level
 * chords fire inside it too), so equal chords always conflict. A shortcut
 * absent from the map has none.
 */
export function findConflicts(
  bindings: ReadonlyArray<{ id: ShortcutId; chord: Chord }>,
): Map<ShortcutId, Array<ShortcutId>> {
  const conflicts = new Map<ShortcutId, Array<ShortcutId>>();

  for (const left of bindings) {
    const clashes = bindings.filter(
      (right) =>
        right.id !== left.id && chordId(right.chord) === chordId(left.chord),
    );

    if (clashes.length > 0) {
      conflicts.set(
        left.id,
        clashes.map((right) => right.id),
      );
    }
  }

  return conflicts;
}
