import * as React from "react";

const MOBILE_BREAKPOINT = 768;

const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/** Resubscribes to the breakpoint media query, so `useSyncExternalStore` owns the mount-time read. */
function subscribeToMobileQuery(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getIsMobile() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

/** A server render has no viewport to measure, so it takes the desktop branch. */
function getIsMobileOnServer() {
  return false;
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToMobileQuery,
    getIsMobile,
    getIsMobileOnServer,
  );
}
