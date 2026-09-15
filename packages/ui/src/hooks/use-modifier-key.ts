import { useSyncExternalStore } from "react";

export function detectPrimaryModifier(): "⌘" | "Ctrl" {
  if (!("navigator" in globalThis)) return "Ctrl";

  if (navigator.userAgentData?.platform) {
    if (/mac/i.test(navigator.userAgentData.platform)) return "⌘";
  }

  const platform = navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPod|iPad/i.test(platform) ? "⌘" : "Ctrl";
}

/** The platform can't change during a session, so there is nothing to subscribe to. */
function subscribeToNothing() {
  return () => {};
}

/** The server (and the hydration render) has no platform to inspect, so it assumes Ctrl. */
function getModifierOnServer(): "⌘" | "Ctrl" {
  return "Ctrl";
}

/**
 * The primary modifier key to label shortcuts with: `⌘` on Apple platforms,
 * `Ctrl` everywhere else. Read through `useSyncExternalStore` so the server
 * snapshot (`Ctrl`) is what SSR and hydration render, and the detected key
 * takes over on the client without a mount-time state write.
 */
export function usePrimaryModifierKey() {
  return useSyncExternalStore(
    subscribeToNothing,
    detectPrimaryModifier,
    getModifierOnServer,
  );
}
