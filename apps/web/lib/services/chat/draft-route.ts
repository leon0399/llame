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
 * Rewrites the address bar for the draft's phase without a navigation. It
 * passes no history state, which makes Next adopt the URL: `usePathname`
 * then names the chat, so the header and rails follow it, and Next's own
 * idea of the current URL never lags behind the address bar. A lagging one
 * is written back by Next's next history update, which reverted a finished
 * home-page chat to `?draft=sent`.
 */
export function replaceDraftUrl(url: string): void {
  window.history.replaceState(null, "", url);
}
