/**
 * Crypto-strong UUID v4 that also works in non-secure contexts.
 *
 * `crypto.randomUUID()` is only defined in secure contexts (HTTPS or localhost). A
 * self-hosted llame reached over plain HTTP on a LAN address (a supported deployment)
 * has `crypto` but not `randomUUID`, so calling it directly crashes the page. Prefer
 * `randomUUID` when present; otherwise build a v4 UUID from `crypto.getRandomValues`
 * (available in non-secure contexts), falling back to `Math.random` only if `crypto`
 * is entirely absent.
 */
export function safeRandomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
