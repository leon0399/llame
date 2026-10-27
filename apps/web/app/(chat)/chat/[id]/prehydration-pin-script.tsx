"use client";

import { useSyncExternalStore } from "react";
import { PREHYDRATION_PIN_SCRIPT } from "@/lib/services/chat/prehydration-pin";

const subscribeToNothing = () => () => {};

/**
 * The pre-hydration pin (#187) only matters in server-rendered HTML: React
 * never executes a script it creates on the client. Rendering it there — a
 * client navigation between chats, or a client re-render after an SSR error —
 * only makes React warn about an inert tag, so the script renders on the
 * server and during hydration, then unmounts. Removing the element does not
 * stop the pin it started; ChatLoadOlder retires that.
 */
export function PrehydrationPinScript() {
  const serverRendered = useSyncExternalStore(
    subscribeToNothing,
    () => false,
    () => true,
  );
  if (!serverRendered) return null;

  return (
    /* safe-html: PREHYDRATION_PIN_SCRIPT is a module-level constant string
       literal in lib/services/chat/prehydration-pin.ts. It interpolates
       nothing — no chat id, no message, no parameter. */
    <script dangerouslySetInnerHTML={{ __html: PREHYDRATION_PIN_SCRIPT }} />
  );
}
