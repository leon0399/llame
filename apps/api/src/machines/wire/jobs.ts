import { randomBytes } from 'node:crypto';

import {
  BASH_BOUNDS,
  JobState,
  LostCause,
  OutputStream,
  type Job,
  type ProcBashResult,
} from '@workspace/machine-protocol';
import { sanitizeKnownResultAtBound } from '@workspace/bash-executor';

import { type Handler } from './index';

const OUTPUT_LIMIT = BigInt(BASH_BOUNDS.outputBound);

export const jobsHandlers: Partial<Record<'proc.bash', Handler<'proc.bash'>>> = {
  'proc.bash': async (session, params, requestOptions) => {
    const client = session.clients.jobs;
    const jobId = randomBytes(16).toString('hex');
    const response = await client.createJob(
      {
        jobId,
        owner: params.envelope.runId ?? 'hub',
        command: params.command,
        ...(params.cwd !== undefined && { cwd: params.cwd }),
        ...(params.env !== undefined && { env: params.env }),
      },
      session.callOptions(requestOptions),
    );
    if (response.result.case === 'failure')
      return {
        status: 'error',
        type: 'unavailable',
        message: response.result.value.message,
      };

    try {
      const job = await watchForCompletion(session, jobId, requestOptions);
      return await resultForJob(session, job, params.envelope.attemptId ?? '', requestOptions);
    } catch (error) {
      try {
        await client.cancelJob(
          { requestId: jobId, jobId, owner: params.envelope.runId ?? 'hub' },
          session.callOptions(),
        );
      } catch {
        // The job remains discoverable in the daemon snapshot.
      }
      throw error;
    }
  },
};

async function watchForCompletion(
  session: Parameters<NonNullable<typeof jobsHandlers['proc.bash']>>[0],
  jobId: string,
  options: Parameters<NonNullable<typeof jobsHandlers['proc.bash']>>[2],
): Promise<Job> {
  for await (const response of session.clients.jobs.watchJobs(
    {},
    session.callOptions(options),
  )) {
    if (
      response.event.case === 'job' &&
      response.event.value.id === jobId &&
      response.event.value.state !== JobState.RUNNING
    )
      return response.event.value;
  }
  throw new Error('Machine job watch ended before the job settled.');
}

async function resultForJob(
  session: Parameters<NonNullable<typeof jobsHandlers['proc.bash']>>[0],
  job: Job,
  attemptId: string,
  options: Parameters<NonNullable<typeof jobsHandlers['proc.bash']>>[2],
): Promise<ProcBashResult> {
  if (job.state === JobState.LOST)
    return {
      status: 'error',
      type: 'outcome_unknown',
      attemptId,
      message: `The Machine daemon lost the job (${lostCauseText(job.lostCause)}).`,
    };
  const stdout = await readOutput(session, job, OutputStream.STDOUT, options);
  const stderr = await readOutput(session, job, OutputStream.STDERR, options);
  const truncated = job.stdout?.truncated === true || job.stderr?.truncated === true;
  const wallTimeMs = elapsedMs(job);
  const result: ProcBashResult = job.state === JobState.TIMED_OUT
    ? { status: 'error', type: 'timed_out', durationMs: wallTimeMs, wallTimeMs, stdout, stderr, truncated }
    : {
        status: job.state === JobState.SUCCEEDED ? 'success' : 'error',
        exitCode: job.exitCode ?? (job.state === JobState.SUCCEEDED ? 0 : 1),
        stdout,
        stderr,
        truncated,
        wallTimeMs,
      };
  return sanitizeKnownResultAtBound(
    result,
    { kind: 'code-units', limit: BASH_BOUNDS.outputBound },
    [],
  );
}

async function readOutput(
  session: Parameters<NonNullable<typeof jobsHandlers['proc.bash']>>[0],
  job: Job,
  stream: OutputStream,
  options: Parameters<NonNullable<typeof jobsHandlers['proc.bash']>>[2],
): Promise<string> {
  const chunks: Array<Buffer> = [];
  for await (const part of session.clients.jobs.readOutput(
    { jobId: job.id, owner: job.owner, stream, offset: 0n, limit: OUTPUT_LIMIT },
    session.callOptions(options),
  )) chunks.push(Buffer.from(part.data));
  return Buffer.concat(chunks).toString('utf8');
}

function elapsedMs(job: Job): number {
  if (job.createdAt === undefined) return 0;
  const start = Number(job.createdAt.seconds) * 1000 + job.createdAt.nanos / 1_000_000;
  const end = job.endedAt === undefined
    ? Date.now()
    : Number(job.endedAt.seconds) * 1000 + job.endedAt.nanos / 1_000_000;
  return Math.max(0, end - start);
}

function lostCauseText(cause: LostCause): string {
  if (cause === LostCause.MACHINE_REBOOTED) return 'Machine rebooted';
  if (cause === LostCause.CANCEL_UNPROVED) return 'stop not proved';
  return 'daemon restarted';
}
