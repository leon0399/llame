/**
 * A key chord: one key plus the modifiers held with it. `mod` is the
 * platform's primary modifier, ⌘ on Apple platforms and Ctrl elsewhere, so
 * one binding reads and behaves natively on both. On a Mac, Ctrl+K is the
 * Emacs kill-line edit binding inside text fields, which is why `mod` never
 * matches Ctrl there.
 */
export type Chord = {
  /** `KeyboardEvent.key`, compared case-insensitively: `"k"`, `"Escape"`. */
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

type KeyState = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt", "AltGraph"]);

function primaryHeld(event: KeyState, isMac: boolean): boolean {
  return isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

/** True when the event is exactly this chord: no modifier missing, none extra. */
export function matchChord(
  event: KeyState,
  chord: Chord,
  isMac: boolean,
): boolean {
  const modState =
    chord.mod === true
      ? primaryHeld(event, isMac)
      : !event.metaKey && !event.ctrlKey;

  return (
    modState &&
    event.shiftKey === (chord.shift === true) &&
    event.altKey === (chord.alt === true) &&
    event.key.toLowerCase() === chord.key.toLowerCase()
  );
}

/** The chord a keypress makes, for recording a binding; null for a lone
 *  modifier or a chord that holds the non-primary modifier (Ctrl on a Mac,
 *  the Windows key elsewhere), which no binding can name. */
export function chordFromEvent(event: KeyState, isMac: boolean): Chord | null {
  if (MODIFIER_KEYS.has(event.key)) return null;

  const foreign = isMac ? event.ctrlKey : event.metaKey;

  if (foreign) return null;

  return {
    key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
    ...((isMac ? event.metaKey : event.ctrlKey) && { mod: true }),
    ...(event.shiftKey && { shift: true }),
    ...(event.altKey && { alt: true }),
  };
}

/** A canonical id, equal for equal chords: `mod+shift+o`. */
export function chordId(chord: Chord): string {
  return [
    chord.mod === true ? "mod" : null,
    chord.alt === true ? "alt" : null,
    chord.shift === true ? "shift" : null,
    chord.key.toLowerCase(),
  ]
    .filter((part) => part !== null)
    .join("+");
}

const KEY_LABELS = new Map([
  ["escape", "Esc"],
  ["enter", "Enter"],
  ["arrowup", "↑"],
  ["arrowdown", "↓"],
  ["arrowleft", "←"],
  ["arrowright", "→"],
  [" ", "Space"],
]);

/** The chord as the app's Kbd hints print it: `⌘+Shift+O`, `Ctrl+K`, `Esc`. */
export function formatChord(chord: Chord, modifierKey: "⌘" | "Ctrl"): string {
  const key = chord.key.toLowerCase();

  const keyLabel =
    KEY_LABELS.get(key) ?? (key.length === 1 ? key.toUpperCase() : chord.key);

  return [
    chord.mod === true ? modifierKey : null,
    chord.alt === true ? (modifierKey === "⌘" ? "⌥" : "Alt") : null,
    chord.shift === true ? "Shift" : null,
    keyLabel,
  ]
    .filter((part) => part !== null)
    .join("+");
}

/** `aria-keyshortcuts` names modifiers by their DOM key values. */
export function ariaKeyShortcut(chord: Chord, isMac: boolean): string {
  return [
    chord.mod === true ? (isMac ? "Meta" : "Control") : null,
    chord.alt === true ? "Alt" : null,
    chord.shift === true ? "Shift" : null,
    chord.key.length === 1 ? chord.key.toUpperCase() : chord.key,
  ]
    .filter((part) => part !== null)
    .join("+");
}
