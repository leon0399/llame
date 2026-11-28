export type DraftPhase = "fresh" | "sent";

/** Only a sent draft is addressable: a fresh one holds nothing to recover, so
 *  it lives on the new-chat page (`/`) and never in a chat URL. */
export function draftPhaseFromSearchParam(
  value: string | Array<string> | undefined,
): "sent" | null {
  return value === "sent" ? value : null;
}

export function draftChatPath(
  chatId: string,
  phase: DraftPhase | null,
): "/" | `/chat/${string}` {
  if (phase === "fresh") return "/";

  return phase === "sent" ? `/chat/${chatId}?draft=sent` : `/chat/${chatId}`;
}

export function draftChatPathWithHash(
  chatId: string,
  phase: DraftPhase | null,
  hash: string,
): string {
  return `${draftChatPath(chatId, phase)}${hash}`;
}

/**
 * Rewrites the address bar for the draft's phase without a navigation. A
 * change of query or hash keeps Next's own history state, so the router does
 * not re-sync a URL it already routes. A change of path (leaving the new-chat
 * page, or returning to it) passes no state, which makes Next adopt the URL:
 * `usePathname` then names the chat, so the header and the rails follow it.
 */
export function replaceDraftUrl(url: string): void {
  const movesPath =
    new URL(url, window.location.href).pathname !== window.location.pathname;

  window.history.replaceState(movesPath ? null : window.history.state, "", url);
}
