/**
 * True for the command-palette toggle chord — PLATFORM-aware: Cmd+K on macOS,
 * Ctrl+K elsewhere. This is load-bearing: Ctrl+K inside a text field on macOS is
 * the Emacs "kill to end of line" edit binding, so treating Ctrl+K as a toggle
 * there would silently swallow a real edit. Pure so this regression-prone rule
 * is testable without the DOM. Excludes plain "k" and other modified keys —
 * including EXTRA modifiers on top of the primary one (Cmd+Shift+K, Ctrl+Alt+K,
 * …), which otherwise collide with unrelated browser/editor shortcuts that
 * happen to also hold the primary modifier + K.
 */
export function isPaletteToggle(
  e: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  },
  isMac: boolean,
): boolean {
  const modifier = isMac ? e.metaKey : e.ctrlKey;
  return (
    modifier &&
    !e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === "k"
  );
}
