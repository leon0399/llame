"use client";

import { useState, useSyncExternalStore } from "react";

import {
  drawGreeting,
  greetingName,
  type Greeting,
  type GreetingRolls,
} from "@/lib/greeting";
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

const newRolls = (): GreetingRolls => ({
  line: Math.random(),
  rarity: Math.random(),
  question: Math.random(),
});

/** Under the greeting: the rarity of a rare draw, else the question, else
 *  an empty line that keeps the height. Epic and legendary draws shimmer. */
function GreetingSubline({ drawn }: { drawn: Greeting | null }) {
  const rarity = drawn?.rarity ?? null;
  const shimmers = rarity?.tier === "epic" || rarity?.tier === "legendary";

  return (
    <p className="text-center text-sm text-muted-foreground">
      {rarity ? (
        <span className={shimmers ? "shimmer motion-reduce:shimmer-none" : ""}>
          {`${rarity.tier[0].toUpperCase()}${rarity.tier.slice(1)} greeting · 1 in ${rarity.odds.toLocaleString("en-US")}`}
        </span>
      ) : (
        (drawn?.question ?? "\u00a0")
      )}
    </p>
  );
}

/** A greeting above the new-chat composer, drawn once per visit from the
 *  hour's, weekday's or date's lines, sometimes a rare one (`lib/greeting`).
 *  Clicking it draws another. Both lines keep their height while the hour
 *  and name resolve, so the composer does not jump. */
export function NewChatGreeting() {
  const hourKey = useLocalHourKey();
  const [rolls, setRolls] = useState(newRolls);
  const personalization = usePersonalizationQuery();
  const me = useMe();
  const settled = !personalization.isPending && !me.isPending;
  const name = greetingName(personalization.data?.preferredName, me.data?.name);

  const date = hourKey === null ? null : dateOfHourKey(hourKey);

  const drawn =
    date === null || !settled ? null : drawGreeting(date, name, rolls);

  const redraw = () => {
    if (date === null) return;

    // A few tries for a different line; a one-line day keeps its line.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const next = newRolls();

      if (drawGreeting(date, name, next).text !== drawn?.text) {
        setRolls(next);

        return;
      }
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h1
        aria-hidden={drawn === null}
        className="text-center text-2xl font-medium tracking-tight text-balance md:text-3xl"
      >
        {drawn ? (
          // A quiet extra: clicking the greeting draws another.
          <button type="button" className="cursor-default" onClick={redraw}>
            {drawn.text}
          </button>
        ) : (
          "\u00a0"
        )}
      </h1>
      <GreetingSubline drawn={drawn} />
    </div>
  );
}
