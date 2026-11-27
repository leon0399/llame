"use client";

import { useEffect, useId, useRef, useState } from "react";
import { format } from "date-fns";
import {
  BanIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  CircleXIcon,
  TimerOffIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";

import { topBarClasses } from "@/app/shell/top-bar";
import { IconButtonTooltip } from "@/components/icon-button-tooltip";
import type {
  ChatJobOutputPart,
  ChatJobResponse,
  ChatJobResponseStoppedBy,
} from "@/lib/api/generated/models";
import { useChatJobOutput } from "@/lib/services/jobs/queries";

import { jobName, jobRunTime } from "./job-display";

const OUTCOME_ICONS: Record<ChatJobResponse["state"], LucideIcon> = {
  running: CircleHelpIcon,
  succeeded: CheckIcon,
  failed: CircleXIcon,
  cancelled: BanIcon,
  timed_out: TimerOffIcon,
  lost: CircleHelpIcon,
};

const OUTCOMES: Record<ChatJobResponse["state"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
  lost: "Lost",
};

const STOPPERS: Record<NonNullable<ChatJobResponseStoppedBy>, string> = {
  owner: "Stopped by you",
  assistant: "Stopped by the assistant",
  worker: "Stopped by the worker",
};

/** The outcome in words, with the exit detail that qualifies it. */
function outcomeOf(job: ChatJobResponse): string {
  const label =
    job.state === "cancelled" && job.stoppedBy !== null
      ? STOPPERS[job.stoppedBy]
      : OUTCOMES[job.state];

  const detail = job.outcomeUnknown
    ? "outcome unknown"
    : job.exitCode !== null
      ? `exit ${String(job.exitCode)}`
      : job.signal;

  return detail === null ? label : `${label} · ${detail}`;
}

/** The command as the job ran it, prompt-prefixed as a terminal shows it. */
function JobCommand({ command }: { command: string | null }) {
  return (
    <pre className="px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
      {command === null ? (
        <span className="text-muted-foreground">Command not recorded</span>
      ) : (
        `$ ${command}`
      )}
    </pre>
  );
}

/** stdout first, then stderr under its own caption; empty streams drop out. */
function JobOutputText({ outputs }: { outputs: Array<ChatJobOutputPart> }) {
  const streams = outputs.filter((part) => part.content.length > 0);

  if (streams.length === 0) return <OutputNote>No output</OutputNote>;

  return (
    <div className="max-h-64 overflow-auto px-2.5 py-2 font-mono text-xs">
      {streams.some((part) => part.cut) ? (
        <p className="pb-1 font-sans text-muted-foreground">
          Showing the last 64 KiB
        </p>
      ) : null}
      {streams.map((part) => (
        <div key={part.name}>
          {part.name === "stdout" ? null : (
            <p className="pt-1 font-sans text-muted-foreground">{part.name}</p>
          )}
          <pre className="whitespace-pre">{part.content}</pre>
        </div>
      ))}
    </div>
  );
}

function OutputNote({ children }: { children: string }) {
  return (
    <p className="px-2.5 py-2 text-xs text-muted-foreground">{children}</p>
  );
}

/** The stored output, read the first time the row opens. */
function JobOutput({ job, open }: { job: ChatJobResponse; open: boolean }) {
  const query = useChatJobOutput(job.chatId, job.id, open);

  if (query.isPending) {
    return (
      <output
        className="flex flex-col gap-1.5 px-2.5 py-2"
        aria-label="Loading output"
      >
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </output>
    );
  }

  if (query.isError) return <OutputNote>Couldn't load the output</OutputNote>;

  if (query.data.status === "unavailable") {
    return <OutputNote>Output was not stored</OutputNote>;
  }

  return <JobOutputText outputs={query.data.outputs} />;
}

/** Outcome, start time, locator, and any stream cut when it was stored. */
function JobFooter({ job }: { job: ChatJobResponse }) {
  return (
    <p className="flex flex-wrap gap-x-2 px-2.5 py-2 text-xs text-muted-foreground">
      <span className={cn(job.state === "failed" && "text-destructive")}>
        {outcomeOf(job)}
      </span>
      <time dateTime={job.startedAt}>
        {format(new Date(job.startedAt), "MMM d, HH:mm:ss")}
      </time>
      <span className="font-mono">{job.locator}</span>
      {job.truncated.length === 0 ? null : (
        <span>{job.truncated.join(", ")} cut at the output bound</span>
      )}
    </p>
  );
}

/** What the collapsed row shows: the job's name, run time, and outcome. */
function FinishedJobSummary({ job }: { job: ChatJobResponse }) {
  const Icon = OUTCOME_ICONS[job.state];

  return (
    <>
      <ChevronRightIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 in-data-panel-open:rotate-90 motion-reduce:transition-none"
      />
      <span
        className={cn(
          "min-w-0 flex-1",
          job.intent === null && "font-mono text-xs leading-5",
        )}
      >
        {jobName(job)}
      </span>
      <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
        {jobRunTime(job)}
        <span className={cn(job.state === "failed" && "text-destructive")}>
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        <span className="sr-only">{OUTCOMES[job.state]}</span>
      </span>
    </>
  );
}

/** A finished job: its name row, and when open, what it ran and printed. */
function FinishedJobRow({ job }: { job: ChatJobResponse }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg bg-muted">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          render={(props) => (
            <button
              {...props}
              type="button"
              className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          )}
        >
          <FinishedJobSummary job={job} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y divide-border">
            <JobCommand command={job.command} />
            <JobOutput job={job} open={open} />
            <JobFooter job={job} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function FinishedJobList({ jobs }: { jobs: ReadonlyArray<ChatJobResponse> }) {
  if (jobs.length === 0) {
    return (
      <p className="px-2 py-1 text-sm text-muted-foreground">
        No finished jobs
      </p>
    );
  }

  // The latest settlement first: the job that just ended is the one asked about.
  const newestFirst = [...jobs].sort(
    (a, b) => Date.parse(b.settledAt ?? "") - Date.parse(a.settledAt ?? ""),
  );

  return (
    <ul className="flex flex-col gap-1">
      {newestFirst.map((job) => (
        <FinishedJobRow key={job.id} job={job} />
      ))}
    </ul>
  );
}

/**
 * Focus moves into the panel when it opens, so keyboard users land where it
 * appeared, and Escape inside it closes it. The caller returns focus to the
 * control that opened it.
 */
function usePanelFocus(onClose: () => void) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => ref.current?.focus(), []);

  useEffect(() => {
    const panel = ref.current;

    if (!panel) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      // The composer's Escape stops the Run; this one only closes the panel.
      event.stopPropagation();
      onClose();
    };

    panel.addEventListener("keydown", onKeyDown);

    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return ref;
}

/**
 * The settled jobs of the open Chat, in a panel that opens beside session
 * details on desktop and over them on mobile.
 */
export function FinishedJobsPanel({
  jobs,
  onClose,
}: {
  jobs: ReadonlyArray<ChatJobResponse>;
  onClose: () => void;
}) {
  const headingId = useId();
  const ref = usePanelFocus(onClose);

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="absolute inset-y-0 z-10 flex w-full flex-col border-sidebar-border bg-background text-foreground outline-none max-md:inset-x-0 md:right-full md:w-80 md:border-l motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-200"
    >
      <div className={cn(topBarClasses, "justify-between gap-2 pr-2 pl-4")}>
        <h2 id={headingId} className="flex items-baseline gap-2 text-sm">
          <span className="font-semibold">Finished jobs</span>
          <span className="text-muted-foreground tabular-nums">
            {jobs.length}
          </span>
        </h2>
        <IconButtonTooltip
          label="Close finished jobs"
          size="icon-sm"
          side="bottom"
          align="end"
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </IconButtonTooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <FinishedJobList jobs={jobs} />
      </div>
    </aside>
  );
}
