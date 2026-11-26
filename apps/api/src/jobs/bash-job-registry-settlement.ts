import { JobState, type Job } from '@workspace/machine-protocol';
import { type ManagedOutput } from '@workspace/bash-executor';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type JobNoticeRunService } from '../runs/job-notice-run.service';
import { type RunWaitService } from '../runs/run-wait.service';
import { type TenantRunner } from '../db/tenant-db.service';
import { type ChatJob } from '../db/schema';
import { type JobSettlement } from './chat-jobs.repository';
import { settleBashJob } from './bash-job-store';
import { lostCause } from './bash-job-registry-shared';

export async function settleDaemonJob(deps: {
  tenantDb: TenantRunner;
  config: InstanceConfigReader;
  noticeRuns: Pick<JobNoticeRunService, 'startOnSettlement'>;
  runWait: Pick<RunWaitService, 'wakeForChatInTransaction'>;
  row: ChatJob;
  job: Job;
  output: ManagedOutput | null;
  backgrounded: boolean;
}): Promise<void> {
  const {
    tenantDb,
    config,
    noticeRuns,
    runWait,
    row,
    job,
    output,
    backgrounded,
  } = deps;

  const settled = settlementWithOutputAvailability(
    settlementForJob(job, row, {
      stdout: job.stdout?.truncated === true,
      stderr: job.stderr?.truncated === true,
    }),
    output === null,
  );

  await settleBashJob(
    tenantDb,
    row,
    { output, settlement: settled },
    {
      maxBytes: config.config.tools.artifacts.maxBytes,
      hostFiles: false,
      backgrounded,
      noticeRuns,
      wake: runWait,
    },
  );
}

function settlementWithOutputAvailability(
  settlement: JobSettlement,
  outputUnavailable: boolean,
): JobSettlement {
  return outputUnavailable
    ? {
        ...settlement,
        result: { ...settlement.result, outputUnavailable: true },
      }
    : settlement;
}

function settlementForJob(
  job: Job,
  row: ChatJob,
  truncatedStreams: { stdout: boolean; stderr: boolean },
): JobSettlement {
  if (job.state === JobState.LOST)
    return {
      state: 'lost',
      result: { outcomeUnknown: true, cause: lostCause(job.lostCause) },
    };

  if (job.state === JobState.TIMED_OUT)
    return {
      state: 'timed_out',
      result: {
        exitCode: job.exitCode ?? null,
        signal: job.signal ?? null,
        truncated: truncatedStreams,
      },
    };

  if (job.state === JobState.CANCELLED)
    return {
      state: 'cancelled',
      stoppedBy: row.stopRequestedBy ?? 'assistant',
      result: { exitCode: job.exitCode ?? null, signal: job.signal ?? null },
    };

  return {
    state: job.state === JobState.SUCCEEDED ? 'succeeded' : 'failed',
    result: {
      exitCode: job.exitCode ?? null,
      signal: job.signal ?? null,
      truncated: truncatedStreams,
    },
  };
}
