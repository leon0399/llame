"use client";

import { CircleStopIcon } from "lucide-react";

import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { SidebarMenu, SidebarMenuItem } from "@workspace/ui/components/sidebar";
import type { ChatJobResponse } from "@/lib/api/generated/models";
import {
  isLiveChatJob,
  useChatJobs,
  useStopChatJobs,
} from "@/lib/services/jobs/queries";

import type { SectionView } from "./section-list";

const JOB_STATES: Record<ChatJobResponse["state"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
  lost: "Lost",
};

export function useJobsSection(chatId: string, enabled: boolean): SectionView {
  const jobsQuery = useChatJobs(chatId, enabled);
  const stopJobs = useStopChatJobs();
  const jobs = jobsQuery.data?.items ?? [];
  const liveCount = jobs.filter(isLiveChatJob).length;

  return {
    title: "Jobs",
    summary:
      jobs.length === 0
        ? "No jobs"
        : liveCount === 1
          ? "1 live job"
          : `${liveCount} live jobs`,
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
      />
    ),
  };
}

export function JobsSectionView({
  jobs,
  loading = false,
  error,
  stopError,
  stoppingIds = [],
  stopping = false,
  onStop,
}: {
  jobs: ReadonlyArray<ChatJobResponse>;
  loading?: boolean;
  error?: string;
  stopError?: string;
  stoppingIds?: ReadonlyArray<string>;
  stopping?: boolean;
  onStop: (jobIds: Array<string>) => void;
}) {
  const liveJobs = jobs.filter(isLiveChatJob);
  const settledJobs = jobs.filter((job) => !isLiveChatJob(job));

  if (loading) return <JobsLoading />;

  if (error) return <JobsLoadError error={error} />;

  return (
    <div className="flex flex-col gap-1 px-2 pb-2">
      {stopError && <JobsStopError error={stopError} />}
      <StopAllButton jobs={liveJobs} stopping={stopping} onStop={onStop} />
      <JobList
        jobs={[...liveJobs, ...settledJobs]}
        stopping={stopping}
        stoppingIds={stoppingIds}
        onStop={onStop}
      />
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
      className="self-start"
      disabled={stopping}
      onClick={() => onStop(jobs.map(({ id }) => id))}
    >
      <CircleStopIcon data-icon="inline-start" />
      Stop all
    </Button>
  );
}

function JobList({
  jobs,
  stopping,
  stoppingIds,
  onStop,
}: {
  jobs: ReadonlyArray<ChatJobResponse>;
  stopping: boolean;
  stoppingIds: ReadonlyArray<string>;
  onStop: (jobIds: Array<string>) => void;
}) {
  if (jobs.length === 0) {
    return <p className="px-2 py-1 text-sm text-muted-foreground">No jobs</p>;
  }

  return (
    <SidebarMenu>
      {jobs.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          stopping={stopping}
          pending={stoppingIds.includes(job.id)}
          onStop={onStop}
        />
      ))}
    </SidebarMenu>
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

function JobRow({
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
  const live = isLiveChatJob(job);

  return (
    <SidebarMenuItem>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {job.locator}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {JOB_STATES[job.state]}
          </span>
        </div>
        {live && (
          <Button
            aria-label={`Stop ${job.locator}`}
            variant="ghost"
            size="icon-sm"
            disabled={stopping}
            onClick={() => onStop([job.id])}
          >
            <CircleStopIcon aria-hidden="true" />
          </Button>
        )}
        {pending && <span className="sr-only">Stopping</span>}
      </div>
    </SidebarMenuItem>
  );
}
