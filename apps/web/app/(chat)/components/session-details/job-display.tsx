"use client";

import { useEffect, useState } from "react";

import type { ChatJobResponse } from "@/lib/api/generated/models";

/** The name a job is shown under: the intent the model gave the call that
 *  started it, else its `job://` locator. */
export function jobName(job: ChatJobResponse): string {
  return job.intent ?? job.locator;
}

/** A compact duration: `42s`, `3m 07s`, `2h 05m`. */
export function formatJobDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  if (seconds < 60) return `${String(seconds)}s`;

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${String(minutes)}m ${String(seconds % 60).padStart(2, "0")}s`;
  }

  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** How long a settled job ran, from its start to its settlement. */
export function jobRunTime(job: ChatJobResponse): string | null {
  if (job.settledAt === null) return null;

  return formatJobDuration(
    Date.parse(job.settledAt) - Date.parse(job.startedAt),
  );
}

/** A running job's elapsed time, recomputed each second while mounted. */
export function JobElapsedTime({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    // Server and browser compute "now" a moment apart; the tick corrects it.
    <span suppressHydrationWarning>
      {formatJobDuration(now - Date.parse(startedAt))}
    </span>
  );
}
