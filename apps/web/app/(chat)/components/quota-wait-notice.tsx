"use client";

import { memo, useEffect, useState, useSyncExternalStore } from "react";
import { formatDuration } from "date-fns";
import { ArrowRightIcon } from "lucide-react";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import {
  nextCandidateLabel,
  type NamedNextCandidate,
} from "@/lib/services/models/next-candidate";

const HOUR_MS = 3_600_000;

const LONG_COUNTDOWN_UNITS: Array<"days" | "hours" | "minutes"> = [
  "days",
  "hours",
  "minutes",
];

const SHORT_COUNTDOWN_UNITS: Array<"minutes" | "seconds"> = [
  "minutes",
  "seconds",
];

const subscribeToNothing = () => () => {};

const LocalTime = memo(function LocalTime({
  timestamp,
}: {
  timestamp: string | number;
}) {
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const date = new Date(timestamp);

  return (
    <time dateTime={date.toISOString()}>
      {hydrated ? date.toLocaleString() : date.toISOString()}
    </time>
  );
});

function quotaCountdown(remainingMs: number): string {
  const seconds = Math.ceil(remainingMs / 1000);

  return formatDuration(
    {
      days: Math.floor(seconds / 86_400),
      hours: Math.floor((seconds % 86_400) / 3600),
      minutes: Math.floor((seconds % 3600) / 60),
      seconds: seconds % 60,
    },
    {
      format:
        remainingMs >= HOUR_MS ? LONG_COUNTDOWN_UNITS : SHORT_COUNTDOWN_UNITS,
    },
  );
}

function QuotaWaitCountdown({ wakeAt }: { wakeAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  const wake = Date.parse(wakeAt);
  const remaining = wake - now;

  useEffect(() => {
    if (now >= wake) return;

    const untilWake = wake - Date.now();
    const interval = untilWake > HOUR_MS ? 60_000 : 1000;

    const untilFasterTicks =
      untilWake > HOUR_MS ? untilWake - HOUR_MS : untilWake;

    const delay = Math.min(interval, untilFasterTicks);
    const timer = setTimeout(() => setNow(Date.now()), delay);

    return () => clearTimeout(timer);
  }, [now, wake]);

  return (
    <span suppressHydrationWarning>
      {remaining <= 0 ? (
        "Sending again…"
      ) : (
        <>
          Sends again at <LocalTime timestamp={wakeAt} /> · in{" "}
          {quotaCountdown(remaining)}
        </>
      )}
    </span>
  );
}

export function QuotaResetTime({ resetsAt }: { resetsAt: string | number }) {
  return (
    <span>
      Resets at <LocalTime timestamp={resetsAt} />
    </span>
  );
}

type QuotaWaitNoticeProps = {
  quota: NonNullable<ChatLatestRunResponse["quotaWait"]>;
  modelName: string;
  onStop: () => void;
  pendingStop: boolean;
  /** The next candidate of the waiting Run's role, or null when the action
   *  does not apply (exact selector, last candidate, compaction Run). */
  nextCandidate: NamedNextCandidate | null;
  onNextCandidate: () => void;
  pendingNextCandidate: boolean;
};

type QuotaWaitActionsProps = Pick<
  QuotaWaitNoticeProps,
  "onStop" | "pendingStop" | "onNextCandidate" | "pendingNextCandidate"
> & { nextCandidate: NamedNextCandidate | null };

function QuotaWaitActions({
  nextCandidate,
  onNextCandidate,
  pendingNextCandidate,
  onStop,
  pendingStop,
}: QuotaWaitActionsProps) {
  return (
    <CardAction>
      {nextCandidate !== null && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pendingNextCandidate}
          onClick={onNextCandidate}
        >
          <ArrowRightIcon aria-hidden="true" />
          {nextCandidateLabel(nextCandidate)}
        </Button>
      )}
      {pendingStop ? (
        <output>Stopping…</output>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Stop waiting for quota reset"
          onClick={onStop}
        >
          Stop
        </Button>
      )}
    </CardAction>
  );
}

export function QuotaWaitNotice({
  quota,
  modelName,
  onStop,
  pendingStop,
  nextCandidate,
  onNextCandidate,
  pendingNextCandidate,
}: QuotaWaitNoticeProps) {
  return (
    <section aria-label="Provider quota wait" className="mb-2">
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            {modelName}{" "}
            {quota.failureClass === "quota_exhausted"
              ? "usage limit reached"
              : "rate limit reached"}
          </CardTitle>
          <CardDescription>
            <QuotaResetTime resetsAt={quota.resetsAt} />
            <br />
            <QuotaWaitCountdown wakeAt={quota.wakeAt} />
          </CardDescription>
          <QuotaWaitActions
            nextCandidate={nextCandidate}
            onNextCandidate={onNextCandidate}
            pendingNextCandidate={pendingNextCandidate}
            onStop={onStop}
            pendingStop={pendingStop}
          />
        </CardHeader>
      </Card>
    </section>
  );
}
