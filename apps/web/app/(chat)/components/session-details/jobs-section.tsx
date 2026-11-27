"use client";

import { useRef, useState, type ReactNode, type Ref } from "react";
import {
  ChevronRightIcon,
  CircleStopIcon,
  HistoryIcon,
  LoaderCircleIcon,
} from "lucide-react";

import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";

import { SidebarRowTitle } from "@/components/sidebar-row-title";
import type { ChatJobResponse } from "@/lib/api/generated/models";
import {
  isLiveChatJob,
  useChatJobs,
  useStopChatJobs,
} from "@/lib/services/jobs/queries";

import { FinishedJobsPanel } from "./finished-jobs-panel";
import { JobElapsedTime, jobName } from "./job-display";
import type { SectionView } from "./section-list";

/** The Jobs section, and the panel of finished jobs it can open. */
export interface JobsSectionParts {
  section: SectionView;
  /** Rendered beside the section list; null while the panel is shut. */
  finishedPanel: ReactNode;
}

function jobsSummary(running: number, finished: number): string {
  if (running > 0) return `${String(running)} running`;

  if (finished > 0) return `${String(finished)} finished`;

  return "No jobs";
}

/**
 * Whether the finished-jobs panel is open. It belongs to the Chat it was
 * opened on, so another Chat starts with it shut, and it is shut while the
 * session details are. Closing it returns focus to its control.
 */
function useFinishedPanel(chatId: string, enabled: boolean) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpenFor(null);
    triggerRef.current?.focus();
  };

  return {
    open: enabled && openFor === chatId,
    triggerRef,
    close,
    setOpen: (open: boolean) => (open ? setOpenFor(chatId) : close()),
  };
}

export function useJobsSection(
  chatId: string,
  enabled: boolean,
): JobsSectionParts {
  const jobsQuery = useChatJobs(chatId, enabled);
  const stopJobs = useStopChatJobs();
  const finishedPanel = useFinishedPanel(chatId, enabled);
  const jobs = jobsQuery.data?.items ?? [];
  const finished = jobs.filter((job) => !isLiveChatJob(job));

  return {
    section: {
      title: "Jobs",
      summary: jobsSummary(jobs.length - finished.length, finished.length),
      content: (
        <JobsSectionView
          jobs={jobs}
          loading={jobsQuery.isPending}
          error={jobsQuery.error?.message}
          stopError={stopJobs.error?.message}
          stoppingIds={
            stopJobs.isPending ? (stopJobs.variables?.jobIds ?? []) : []
          }
          stopping={stopJobs.isPending}
          onStop={(jobIds) => stopJobs.mutate({ chatId, jobIds })}
          finishedOpen={finishedPanel.open}
          finishedTriggerRef={finishedPanel.triggerRef}
          onFinishedOpenChange={finishedPanel.setOpen}
        />
      ),
    },
    finishedPanel: finishedPanel.open ? (
      <FinishedJobsPanel jobs={finished} onClose={finishedPanel.close} />
    ) : null,
  };
}

interface JobsSectionViewProps {
  jobs: ReadonlyArray<ChatJobResponse>;
  loading?: boolean;
  error?: string;
  stopError?: string;
  stoppingIds?: ReadonlyArray<string>;
  stopping?: boolean;
  onStop: (jobIds: Array<string>) => void;
  finishedOpen?: boolean;
  finishedTriggerRef?: Ref<HTMLButtonElement>;
  onFinishedOpenChange: (open: boolean) => void;
}

/**
 * The running jobs of the Chat, each with its stop control, and one control
 * that opens the finished jobs in their own panel.
 */
export function JobsSectionView({
  jobs,
  loading = false,
  error,
  stopError,
  stoppingIds = [],
  stopping = false,
  onStop,
  finishedOpen = false,
  finishedTriggerRef,
  onFinishedOpenChange,
}: JobsSectionViewProps) {
  if (loading) return <JobsLoading />;

  if (error) return <JobsLoadError error={error} />;

  const liveJobs = jobs.filter(isLiveChatJob);
  const finishedCount = jobs.length - liveJobs.length;

  return (
    <div className="flex flex-col gap-1 pb-1">
      {stopError && <JobsStopError error={stopError} />}
      <StopAllButton jobs={liveJobs} stopping={stopping} onStop={onStop} />
      <SidebarMenu>
        <RunningJobs
          jobs={liveJobs}
          emptyLabel={finishedCount === 0 ? "No jobs" : "No running jobs"}
          stopping={stopping}
          stoppingIds={stoppingIds}
          onStop={onStop}
        />
        {finishedCount === 0 ? null : (
          <FinishedToggle
            count={finishedCount}
            open={finishedOpen}
            triggerRef={finishedTriggerRef}
            onOpenChange={onFinishedOpenChange}
          />
        )}
      </SidebarMenu>
    </div>
  );
}

function StopAllButton({
  jobs,
  stopping,
  onStop,
}: {
  jobs: ReadonlyArray<ChatJobResponse>;
  stopping: boolean;
  onStop: (jobIds: Array<string>) => void;
}) {
  if (jobs.length < 2) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="mx-2 self-start"
      disabled={stopping}
      onClick={() => onStop(jobs.map(({ id }) => id))}
    >
      <CircleStopIcon data-icon="inline-start" />
      Stop all
    </Button>
  );
}

function RunningJobs({
  jobs,
  emptyLabel,
  stopping,
  stoppingIds,
  onStop,
}: {
  jobs: ReadonlyArray<ChatJobResponse>;
  emptyLabel: string;
  stopping: boolean;
  stoppingIds: ReadonlyArray<string>;
  onStop: (jobIds: Array<string>) => void;
}) {
  if (jobs.length === 0) {
    return (
      <li className="px-2 py-1 text-sm text-muted-foreground">{emptyLabel}</li>
    );
  }

  return jobs.map((job) => (
    <RunningJobRow
      key={job.id}
      job={job}
      stopping={stopping}
      pending={stoppingIds.includes(job.id)}
      onStop={onStop}
    />
  ));
}

function FinishedToggle({
  count,
  open,
  triggerRef,
  onOpenChange,
}: {
  count: number;
  open: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        ref={triggerRef}
        size="sm"
        isActive={open}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <HistoryIcon />
        <span className="flex-1">Finished</span>
        <span className="text-muted-foreground tabular-nums">{count}</span>
        <ChevronRightIcon />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function JobsLoading() {
  return (
    <output className="flex flex-col gap-2 px-2 pb-2" aria-label="Loading jobs">
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-4/5" />
    </output>
  );
}

function JobsLoadError({ error }: { error: string }) {
  return (
    <Alert variant="default" className="mx-2 mb-2">
      <AlertDescription>Couldn't load jobs. {error}</AlertDescription>
    </Alert>
  );
}

function JobsStopError({ error }: { error: string }) {
  return (
    <Alert variant="default" className="mb-1">
      <AlertDescription>Couldn't stop the job. {error}</AlertDescription>
    </Alert>
  );
}

/** The intent fades and scrolls on hover, since all of it is worth reading;
 *  a call without one leaves the job its locator. */
function RunningJobTitle({ job }: { job: ChatJobResponse }) {
  return (
    <span className="min-w-0 flex-1">
      {job.intent === null ? (
        <span className="block truncate font-mono text-xs">{job.locator}</span>
      ) : (
        <SidebarRowTitle text={job.intent} />
      )}
    </span>
  );
}

/** A running job: a spinner, its name, the time it has run, and its stop. */
function RunningJobRow({
  job,
  stopping,
  pending,
  onStop,
}: {
  job: ChatJobResponse;
  stopping: boolean;
  pending: boolean;
  onStop: (jobIds: Array<string>) => void;
}) {
  const stopRequested = pending || job.stopRequestedAt !== null;

  return (
    <SidebarMenuItem>
      <div className="flex h-8 items-center gap-2 pr-1 pl-2 text-sm">
        <LoaderCircleIcon
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
        <RunningJobTitle job={job} />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {stopRequested ? (
            "Stopping"
          ) : (
            <JobElapsedTime startedAt={job.startedAt} />
          )}
        </span>
        <Button
          aria-label={`Stop ${jobName(job)}`}
          variant="ghost"
          size="icon-xs"
          disabled={stopping || stopRequested}
          onClick={() => onStop([job.id])}
        >
          <CircleStopIcon aria-hidden="true" />
        </Button>
      </div>
    </SidebarMenuItem>
  );
}
