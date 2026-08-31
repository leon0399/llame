// A deliberately loose shape (unlike lib.dom's `Navigator`, which declares
// `clipboard` required): the whole point of this guard is the real-world
// case where the global object exists but `clipboard.writeText` doesn't —
// e.g. outside secure contexts — which lib.dom's own type doesn't model.
type MinimalNavigator = {
  clipboard?: { writeText?: (text: string) => Promise<void> };
};

function supportsClipboardWriteText(
  value: MinimalNavigator | undefined,
): value is { clipboard: { writeText: (text: string) => Promise<void> } } {
  return (
    value !== undefined && typeof value.clipboard?.writeText === "function"
  );
}

/**
 * Copy text to the clipboard, resilient to NON-secure contexts. Self-hosted
 * llame is commonly served over plain HTTP on a LAN, where
 * `navigator.clipboard` is undefined — fall back to the legacy execCommand
 * path so the copy button works there too. Returns whether it succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  // `globalThis.navigator`/`globalThis.document` are property reads (safe
  // even when absent), unlike the bare identifiers — reading those directly
  // in a context where they were never declared (e.g. SSR) throws a
  // ReferenceError instead of evaluating to `undefined`.
  const navigatorRef: MinimalNavigator | undefined = globalThis.navigator;
  if (supportsClipboardWriteText(navigatorRef)) {
    try {
      await navigatorRef.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path (e.g. permissions/insecure context)
    }
  }
  if (globalThis.document === undefined) return false;
  const textarea = document.createElement("textarea");
  try {
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    // Guaranteed cleanup: if execCommand throws (or anything else does)
    // after appendChild, the textarea must not linger detached-but-mounted
    // in the DOM.
    textarea.remove();
  }
}
