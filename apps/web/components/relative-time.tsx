"use client";

import { useEffect, useState } from "react";
import { formatDistanceStrict } from "date-fns";

/** How often the label is recomputed. Seconds are the finest unit shown, so a
 *  one-second tick keeps "43 seconds ago" → "44 seconds ago" exact. */
const TICK_MS = 1000;

/**
 * A `<time>` whose relative label ("44 seconds ago", "1 minute ago") stays
 * current while it is mounted.
 */
export function RelativeTime({ date }: { date: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    // Server and browser compute "now" a moment apart; the tick corrects the
    // text, so a differing first render is expected rather than a bug.
    <time dateTime={date} suppressHydrationWarning>
      {formatDistanceStrict(new Date(date), now, { addSuffix: true })}
    </time>
  );
}
