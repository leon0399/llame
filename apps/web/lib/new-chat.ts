import { useSyncExternalStore } from "react";

/*
 * New chat always starts a clean draft. On `/` the address does not change,
 * so the home page cannot tell a New chat from its pathname: every New chat
 * entry point counts one request here, and the home page starts a new draft
 * when the count moves.
 */

let requests = 0;
const listeners = new Set<() => void>();

/** Records a New chat; call it alongside the navigation to `/`. */
export function requestNewChat(): void {
  requests += 1;

  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** How many New chats this page has requested. */
export function useNewChatRequests(): number {
  return useSyncExternalStore(
    subscribe,
    () => requests,
    () => 0,
  );
}
