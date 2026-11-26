import { ServiceUnavailableException } from '@nestjs/common';
import {
  JobState,
  LostCause,
  MachineProtocolError,
} from '@workspace/machine-protocol';
import type { ChatJob } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import type { MachineSession } from '../machines/machine-session';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { notifyRunControl } from '../runs/run-control';
import { RunsRepository } from '../runs/runs-repository';
import { ChatsRepository } from './chats-repository';

type JobRpcClient = MachineSession['jobsClient'];

type JobCallOptions = MachineSession['callOptions'];

type JobDeletionConnector = {
  jobsClient(
    machineName: string,
  ): Promise<{
    readonly client: JobRpcClient;
    readonly callOptions: JobCallOptions;
  }>;
};

export async function prepareChatDeletion(
  tx: Db,
  userId: string,
  chatId: string,
): Promise<Array<ChatJob> | undefined> {
  const runsRepo = new RunsRepository(tx);
  const active = await runsRepo.findActiveByChatId(chatId, userId);

  if (active) {
    await runsRepo.requestCancel(active.id, userId);
  }

  const chats = new ChatsRepository(tx);

  if (!(await chats.lock(chatId, userId))) {
    return undefined;
  }

  const jobsRepository = new ChatJobsRepository(tx);
  const jobs = await jobsRepository.listBindingsByChat(chatId, userId);

  for (const job of jobs) {
    if (job.state === 'running') {
      await notifyRunControl(tx, { kind: 'job-stop', jobId: job.id });
    }
  }

  return jobs;
}

export async function finishChatDeletion(
  tx: Db,
  userId: string,
  chatId: string,
  stoppedJobs: ReadonlyArray<ChatJob>,
): Promise<boolean> {
  const chats = new ChatsRepository(tx);

  if (!(await chats.lock(chatId, userId))) {
    return false;
  }

  const runningJobs = (
    await new ChatJobsRepository(tx).listBindingsByChat(chatId, userId)
  ).filter((job) => job.state === 'running');

  if (
    runningJobs.some((job) =>
      stoppedJobs.every((stopped) => stopped.id !== job.id),
    )
  ) {
    throw new ServiceUnavailableException(
      'A Machine job started while the Chat was being deleted.',
    );
  }

  return chats.deleteById(chatId, userId);
}

export async function stopAndReleaseJob(
  job: ChatJob,
  machines: JobDeletionConnector | undefined,
  hasCreatingAttempt: () => Promise<boolean>,
): Promise<void> {
  if (job.result?.cause === 'stop_unproved') {
    throw new ServiceUnavailableException(
      'The Machine has not confirmed that the Chat job stopped.',
    );
  }

  const session = await jobSession(machines, job.machineName);

  const request = {
    requestId: job.daemonJobId,
    jobId: job.daemonJobId,
    owner: job.ownerUserId,
  };

  const creatingAttempt = await hasCreatingAttempt();

  const missing =
    job.state === 'running' || creatingAttempt
      ? await cancelRemoteJob(session.client, request, session.callOptions())
      : false;

  if (missing && (await hasCreatingAttempt())) {
    throw new ServiceUnavailableException(
      'A Machine job start can still be delivered while the Chat is being deleted.',
    );
  }

  await releaseRemoteJob(
    session.client,
    request,
    session.callOptions(),
    missing,
  );
}


async function jobSession(
  machines: JobDeletionConnector | undefined,
  machineName: string,
) {
  if (machines === undefined) {
    throw new ServiceUnavailableException(
      'The Chat has running Machine jobs that cannot be stopped right now.',
    );
  }

  try {
    return await machines.jobsClient(machineName);
  } catch {
    throw new ServiceUnavailableException(
      'The Chat has running Machine jobs that cannot be stopped right now.',
    );
  }
}

async function cancelRemoteJob(
  client: JobRpcClient,
  request: { requestId: string; jobId: string; owner: string },
  callOptions: ReturnType<JobCallOptions>,
): Promise<boolean> {
  try {
    const stopped = await client.cancelJob(request, callOptions);

    if (
      stopped.job === undefined ||
      stopped.job.state === JobState.RUNNING ||
      (stopped.job.state === JobState.LOST &&
        stopped.job.lostCause === LostCause.CANCEL_UNPROVED)
    ) {
      throw new ServiceUnavailableException(
        'The Machine has not confirmed that the Chat job stopped.',
      );
    }

    return false;
  } catch (error) {
    if (
      error instanceof MachineProtocolError &&
      error.code === 'machine_job_not_found'
    ) {
      return true;
    }

    if (error instanceof ServiceUnavailableException) {
      throw error;
    }

    throw new ServiceUnavailableException(
      'The Chat has running Machine jobs that cannot be stopped right now.',
    );
  }
}

async function releaseRemoteJob(
  client: JobRpcClient,
  request: { requestId: string; jobId: string; owner: string },
  callOptions: ReturnType<JobCallOptions>,
  missing: boolean,
): Promise<void> {
  try {
    await client.deleteJob(request, callOptions);
  } catch (error) {
    if (
      !missing ||
      !(error instanceof MachineProtocolError) ||
      error.code !== 'machine_job_not_found'
    ) {
      throw new ServiceUnavailableException(
        'The Machine has not confirmed that the Chat job was released.',
      );
    }
  }
}
