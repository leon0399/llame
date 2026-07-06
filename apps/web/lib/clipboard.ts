/**
 * Copy text to the clipboard, resilient to NON-secure contexts. Self-hosted
 * llame is commonly served over plain HTTP on a LAN, where
 * `navigator.clipboard` is undefined — fall back to the legacy execCommand
 * path so the copy button works there too. Returns whether it succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path (e.g. permissions/insecure context)
    }
  }
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  try {
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
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
