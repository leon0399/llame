import { type CallOptions, type Client } from '@connectrpc/connect';
import {
  JobState,
  JobService,
  LostCause,
  type Job,
} from '@workspace/machine-protocol';
import { type ManagedOutput } from '@workspace/bash-executor';
import { type ChatJob } from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import type { MachineRequestOptions } from '../machines/machine-session';
import { type MachineConnector } from '../machines/machine-connector.service';
import { ChatJobsRepository } from './chat-jobs.repository';

type JobsClient = Client<typeof JobService>;

type JobsCallOptions = (options?: MachineRequestOptions) => CallOptions;

export async function observeDaemonJob(deps: {
  tenantDb: TenantRunner;
  instanceId: string;
  client: JobsClient;
  callOptions: JobsCallOptions;
  daemonJob: Job;
  foregroundJobs: ReadonlySet<string>;
  readResult: (
    client: JobsClient,
    callOptions: JobsCallOptions,
    row: ChatJob,
    job: Job,
  ) => Promise<{ output: ManagedOutput | null }>;
  settle: (
    row: ChatJob,
    job: Job,
    output: ManagedOutput | null,
    backgrounded: boolean,
  ) => Promise<void>;
  release: (
    client: JobsClient,
    callOptions: JobsCallOptions,
    row: ChatJob,
  ) => Promise<void>;
}): Promise<void> {
  const { tenantDb, instanceId, client, callOptions, daemonJob } = deps;

  const observed = await resolveObservedJob(tenantDb, daemonJob, instanceId);

  if (observed === undefined) return;
  const { row, job } = observed;

  if (await cancelIfRequested(row, job, client, callOptions)) return;

  if (job.state === JobState.RUNNING) return;

  return settleObservedJob(deps, row, job);
}

async function settleObservedJob(
  deps: {
    client: JobsClient;
    callOptions: JobsCallOptions;
    foregroundJobs: ReadonlySet<string>;
    readResult: (
      client: JobsClient,
      callOptions: JobsCallOptions,
      row: ChatJob,
      job: Job,
    ) => Promise<{ output: ManagedOutput | null }>;
    settle: (
      row: ChatJob,
      job: Job,
      output: ManagedOutput | null,
      backgrounded: boolean,
    ) => Promise<void>;
    release: (
      client: JobsClient,
      callOptions: JobsCallOptions,
      row: ChatJob,
    ) => Promise<void>;
  },
  row: ChatJob,
  job: Job,
): Promise<void> {
  const { client, callOptions, foregroundJobs } = deps;
  const { output } = await deps.readResult(client, callOptions, row, job);

  await deps.settle(row, job, output, !foregroundJobs.has(row.id));
  await deps.release(client, callOptions, row).catch(() => undefined);
}

async function resolveObservedJob(
  tenantDb: TenantRunner,
  daemonJob: Job,
  instanceId: string,
): Promise<{ row: ChatJob; job: Job } | undefined> {
  const row = await findObservedRow(tenantDb, daemonJob, instanceId);

  if (row !== undefined) return { row, job: daemonJob };

  const ownerRow = await tenantDb.runAs(daemonJob.owner, (db) =>
    new ChatJobsRepository(db).findByOwnerDaemonJob(
      daemonJob.owner,
      daemonJob.id,
    ),
  );

  if (ownerRow === undefined || ownerRow.state !== 'running') return undefined;

  return {
    row: ownerRow,
    job: {
      ...daemonJob,
      state: JobState.LOST,
      lostCause:
        ownerRow.daemonInstanceId === instanceId
          ? LostCause.DAEMON_RESTARTED
          : LostCause.MACHINE_REBOOTED,
    },
  };
}

async function findObservedRow(
  tenantDb: TenantRunner,
  daemonJob: Job,
  instanceId: string,
): Promise<ChatJob | undefined> {
  return tenantDb.runAs(daemonJob.owner, (db) =>
    new ChatJobsRepository(db).findByDaemonJob(
      daemonJob.owner,
      instanceId,
      daemonJob.id,
    ),
  );
}

async function cancelIfRequested(
  row: ChatJob,
  job: Job,
  client: JobsClient,
  callOptions: JobsCallOptions,
): Promise<boolean> {
  if (row.stopRequestedAt === null || job.state !== JobState.RUNNING)
    return false;

  try {
    await client.cancelJob(
      {
        requestId: row.daemonJobId,
        jobId: row.daemonJobId,
        owner: row.ownerUserId,
      },
      callOptions(),
    );
  } catch {
    // A reconnect will retry the durable stop request.
  }

  return true;
}

export async function listMachineJobs(deps: {
  connector: MachineConnector;
  machineName: string;
  observe: (
    instanceId: string,
    client: JobsClient,
    callOptions: JobsCallOptions,
    job: Job,
  ) => Promise<void>;
}): Promise<void> {
  const { client, callOptions, instanceId } = await deps.connector.jobsClient(
    deps.machineName,
  );

  const list = await client.listJobs({}, callOptions());

  for (const job of list.jobs)
    await deps.observe(instanceId, client, callOptions, job);
}

export async function findRunningJob(deps: {
  connector: MachineConnector;
  tenantDb: TenantRunner;
  jobId: string;
}): Promise<ChatJob | undefined> {
  for (const name of deps.connector.names()) {
    try {
      const row = await findRunningOnMachine(deps, name);

      if (row !== undefined) return row;
    } catch {
      // The request remains in chat_jobs for the next attachment.
    }
  }

  return undefined;
}

async function findRunningOnMachine(
  deps: {
    connector: MachineConnector;
    tenantDb: TenantRunner;
    jobId: string;
  },
  name: string,
): Promise<ChatJob | undefined> {
  const { client, callOptions, instanceId } =
    await deps.connector.jobsClient(name);

  const list = await client.listJobs({}, callOptions());

  for (const job of list.jobs) {
    const row = await deps.tenantDb.runAs(job.owner, (db) =>
      new ChatJobsRepository(db).findByDaemonJob(job.owner, instanceId, job.id),
    );

    if (row?.id === deps.jobId) return row;
  }

  return undefined;
}
