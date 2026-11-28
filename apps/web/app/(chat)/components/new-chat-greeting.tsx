"use client";

import { useSyncExternalStore } from "react";

import { greeting, greetingName } from "@/lib/greeting";
import { useMe } from "@/lib/services/auth/queries";
import { usePersonalizationQuery } from "@/lib/services/personalization/queries";

const subscribeNever = () => () => {};

/** The browser's local hour; null during SSR, whose clock and zone are the
 *  server's, so the first client render matches the server markup. */
function useLocalHour(): number | null {
  return useSyncExternalStore(
    subscribeNever,
    () => new Date().getHours(),
    () => null,
  );
}

/** "Good evening, Leo" above the new-chat composer. The line keeps its height
 *  while the hour and name resolve, so the composer does not jump. */
export function NewChatGreeting() {
  const hour = useLocalHour();
  const personalization = usePersonalizationQuery();
  const me = useMe();
  const settled = !personalization.isPending && !me.isPending;

  const text =
    hour === null || !settled
      ? null
      : greeting(
          hour,
          greetingName(personalization.data?.preferredName, me.data?.name),
        );

  return (
    <h1
      aria-hidden={text === null}
      className="text-center text-2xl font-medium tracking-tight text-balance md:text-3xl"
    >
      {text ?? " "}
    </h1>
  );
}
