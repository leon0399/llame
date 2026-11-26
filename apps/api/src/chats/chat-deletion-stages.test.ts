import { ServiceUnavailableException } from '@nestjs/common';
import { Code, ConnectError } from '@connectrpc/connect';
import {
  ErrorDetailSchema,
  ErrorReason,
  JobState,
  LostCause,
  MachineProtocolError,
} from '@workspace/machine-protocol';
import type { ChatJob } from '../db/schema';
import type { MachineSession } from '../machines/machine-session';
import { stopAndReleaseJob } from './chat-deletion-stages';

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

describe('stopAndReleaseJob', () => {
  it('does not release a job when cancellation settles as unproved lost', async () => {
    const cancelJob = vi.fn().mockResolvedValue({
      job: { state: JobState.LOST, lostCause: LostCause.CANCEL_UNPROVED },
    });

    const deleteJob = vi.fn();

    await expect(
      stopAndReleaseJob(job, connector({ cancelJob, deleteJob }), () =>
        Promise.resolve(false),
      ),
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
        () => Promise.resolve(false),
      ),
    ).resolves.toBeUndefined();

    expect(cancelJob).not.toHaveBeenCalled();
    expect(deleteJob).toHaveBeenCalledOnce();
  });

  it('treats JOB_NOT_FOUND as already released for settled jobs', async () => {
    const cancelJob = vi.fn();

    const deleteJob = vi.fn().mockRejectedValue(
      new ConnectError('unknown job', Code.NotFound, undefined, [
        {
          desc: ErrorDetailSchema,
          value: { reason: ErrorReason.JOB_NOT_FOUND },
        },
      ]),
    );

    await expect(
      stopAndReleaseJob(
        { ...job, state: 'succeeded' },
        connector({ cancelJob, deleteJob }),
        () => Promise.resolve(false),
      ),
    ).resolves.toBeUndefined();
  });

  it('does not treat JOB_NOT_FOUND as released for a running job', async () => {
    const cancelJob = vi.fn().mockResolvedValue({
      job: { state: JobState.CANCELLED },
    });

    const deleteJob = vi.fn().mockRejectedValue(
      new ConnectError('unknown job', Code.NotFound, undefined, [
        {
          desc: ErrorDetailSchema,
          value: { reason: ErrorReason.JOB_NOT_FOUND },
        },
      ]),
    );

    await expect(
      stopAndReleaseJob(job, connector({ cancelJob, deleteJob }), () =>
        Promise.resolve(false),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
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
        () => Promise.resolve(false),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(cancelJob).not.toHaveBeenCalled();
    expect(deleteJob).not.toHaveBeenCalled();
  });

  it('keeps the Chat when CreateJob can still arrive after the daemon says unknown', async () => {
    const cancelJob = vi
      .fn()
      .mockRejectedValue(
        new MachineProtocolError('machine_job_not_found', 'unknown job'),
      );

    const deleteJob = vi.fn();

    const hasCreatingAttempt = vi.fn().mockResolvedValue(true);

    await expect(
      stopAndReleaseJob(
        job,
        connector({ cancelJob, deleteJob }),
        hasCreatingAttempt,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(cancelJob).toHaveBeenCalledOnce();
    expect(hasCreatingAttempt).toHaveBeenCalledTimes(2);
    expect(deleteJob).not.toHaveBeenCalled();
  });
});
