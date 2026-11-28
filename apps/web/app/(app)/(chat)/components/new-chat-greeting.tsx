"use client";

import { useState, useSyncExternalStore } from "react";

import { greeting, greetingName } from "@/lib/greeting";
import { useMe } from "@/lib/services/auth/queries";
import { usePersonalizationQuery } from "@/lib/services/personalization/queries";

const subscribeNever = () => () => {};

/** The browser's local date and hour as `y-m-d-h`, a string so the snapshot
 *  stays equal within the hour; null during SSR, whose clock and zone are
 *  the server's, so the first client render matches the server markup. */
function useLocalHourKey(): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => {
      const now = new Date();

      return [
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours(),
      ].join("-");
    },
    () => null,
  );
}

function dateOfHourKey(key: string): Date {
  const [year, month, day, hour] = key.split("-").map(Number);

  return new Date(year, month, day, hour);
}

/** A greeting above the new-chat composer, drawn once per visit from the
 *  hour's, weekday's or date's lines (`lib/greeting`). The line keeps its
 *  height while the hour and name resolve, so the composer does not jump. */
export function NewChatGreeting() {
  const hourKey = useLocalHourKey();
  // One roll per visit: the line holds while the page stays open.
  const [roll] = useState(Math.random);
  const personalization = usePersonalizationQuery();
  const me = useMe();
  const settled = !personalization.isPending && !me.isPending;

  const text =
    hourKey === null || !settled
      ? null
      : greeting(
          dateOfHourKey(hourKey),
          greetingName(personalization.data?.preferredName, me.data?.name),
          roll,
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
