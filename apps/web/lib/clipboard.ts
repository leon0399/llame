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
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** Concatenate only the TEXT parts of a message (skip reasoning/tool parts). */
export function messageText(parts: ReadonlyArray<unknown>): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: unknown }).type === "text" &&
        typeof (p as { text?: unknown }).text === "string",
    )
    .map((p) => p.text)
    .join("\n\n")
    .trim();
}
