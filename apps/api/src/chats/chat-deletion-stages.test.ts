import { drizzle } from 'drizzle-orm/postgres-js';
import { ServiceUnavailableException } from '@nestjs/common';
import { JobState, LostCause } from '@workspace/machine-protocol';
import type { Chat, ChatJob } from '../db/schema';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import type { MachineSession } from '../machines/machine-session';
import { RunsRepository } from '../runs/runs-repository';
import { ChatsRepository } from './chats-repository';
import {
  prepareChatDeletion,
  stopAndReleaseJob,
} from './chat-deletion-stages';

type DeletionConnector = NonNullable<Parameters<typeof stopAndReleaseJob>[1]>;

const job: ChatJob = {
  id: 'job-1',
  chatId: 'chat-1',
  ownerUserId: 'owner-1',
  kind: 'bash',
  seq: 1,
  state: 'running',
  delivery: 'background',
  stoppedBy: null,
  runId: 'run-1',
  toolCallId: 'call-1',
  machineName: 'host-a',
  daemonInstanceId: crypto.randomUUID(),
  daemonJobId: crypto.randomUUID().replaceAll('-', ''),
  startedAt: new Date(),
  settledAt: null,
  deadlineAt: null,
  stopRequestedAt: null,
  stopRequestedBy: null,
  result: null,
  outputs: ['stdout', 'stderr'],
  artifactId: null,
  artifactReadable: true,
  settings: { selector: 'test-model', permissionMode: 'default' },
};

function connector(
  client: Pick<MachineSession['jobsClient'], 'cancelJob' | 'deleteJob'>,
): DeletionConnector {
  return {
    jobsClient: () =>
      Promise.resolve({
        client: {
          ...client,
          createJob: vi.fn(),
          getJob: vi.fn(),
          listJobs: vi.fn(),
          watchJobs: vi.fn(),
          readOutput: vi.fn(),
        },
        callOptions: () => ({}),
      }),
  };
}

const chat: Chat = {
  id: 'chat-1',
  ownerUserId: 'owner-1',
  title: null,
  visibility: 'private',
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null,
  projectId: null,
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
  workspaceRoot: null,
  workspaceExecutorId: null,
  workspaceGeneration: 0,
  artifactSeq: 0,
  workspaceTold: null,
  workspaceToldFrom: null,
  workspaceToldAvailable: null,
  workspaceDetachReason: null,
  modelSelection: null,
};

describe('stopAndReleaseJob', () => {
  it('does not release a job when cancellation settles as unproved lost', async () => {
    const cancelJob = vi.fn().mockResolvedValue({
      job: { state: JobState.LOST, lostCause: LostCause.CANCEL_UNPROVED },
    });

    const deleteJob = vi.fn();

    await expect(
      stopAndReleaseJob(job, connector({ cancelJob, deleteJob })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(deleteJob).not.toHaveBeenCalled();
  });

  it('releases settled daemon records without trying to cancel them', async () => {
    const cancelJob = vi.fn();
    const deleteJob = vi.fn().mockResolvedValue({});

    await expect(
      stopAndReleaseJob(
        { ...job, state: 'succeeded' },
        connector({ cancelJob, deleteJob }),
      ),
    ).resolves.toBeUndefined();

    expect(cancelJob).not.toHaveBeenCalled();
    expect(deleteJob).toHaveBeenCalledOnce();
  });

  it('keeps a previously unproved stop blocking later deletion attempts', async () => {
    const cancelJob = vi.fn();
    const deleteJob = vi.fn();

    await expect(
      stopAndReleaseJob(
        {
          ...job,
          state: 'lost',
          result: { outcomeUnknown: true, cause: 'stop_unproved' },
        },
        connector({ cancelJob, deleteJob }),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(cancelJob).not.toHaveBeenCalled();
    expect(deleteJob).not.toHaveBeenCalled();
  });
});

describe('prepareChatDeletion', () => {
  it('refuses deletion while the durable native attempt can still deliver CreateJob', async () => {
    vi.spyOn(RunsRepository.prototype, 'findActiveByChatId').mockResolvedValue(
      undefined,
    );
    vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(chat);
    vi.spyOn(ChatJobsRepository.prototype, 'listBindingsByChat').mockResolvedValue([
      job,
    ]);

    const hasCreatingAttempt = vi
      .spyOn(ChatJobsRepository.prototype, 'hasCreatingAttempt')
      .mockResolvedValue(true);

    const db = drizzle.mock();

    await expect(
      prepareChatDeletion(db, job.ownerUserId, job.chatId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(hasCreatingAttempt).toHaveBeenCalledWith(
      job.chatId,
      job.ownerUserId,
      job.id,
    );
  });
});
