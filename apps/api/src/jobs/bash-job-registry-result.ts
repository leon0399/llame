import { type CallOptions, type Client } from '@connectrpc/connect';
import {
  BASH_BOUNDS,
  JobState,
  MachineProtocolError,
  LostCause,
  OutputStream,
  JobService,
  type Job,
  type ProcBashResult,
} from '@workspace/machine-protocol';
import {
  type BashKnownResult,
  type BashTimedOutResult,
  sanitizeKnownResultAtBound,
  type ManagedOutput,
} from '../tools/bash-contract';
import { type ChatJob } from '../db/schema';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import type { MachineRequestOptions } from '../machines/machine-session';
import { mapMachineRefusal } from '../machines/machine-session-errors';

type JobsClient = Client<typeof JobService>;

type JobsCallOptions = (options?: MachineRequestOptions) => CallOptions;

type JobStreams =
  | {
      kind: 'complete';
      stdout: string;
      stderr: string;
      stdoutTruncated: boolean;
      stderrTruncated: boolean;
    }
  | { kind: 'missing'; result: ProcBashResult };

export async function readBashJobResult(deps: {
  config: InstanceConfigReader;
  client: JobsClient;
  callOptions: JobsCallOptions;
  row: ChatJob;
  job: Job;
  credentials: ReadonlyArray<string>;
}): Promise<{ result: ProcBashResult; output: ManagedOutput | null }> {
  const streams = await readJobStreams(deps);

  if (streams.kind === 'missing')
    return { result: streams.result, output: null };

  const { row, job, credentials } = deps;

  return {
    result: modelResult(job, streams, row, credentials),
    output: retainedArtifactOutput({
      config: deps.config,
      job,
      stdout: streams.stdout,
      stderr: streams.stderr,
      stdoutTruncated: streams.stdoutTruncated,
      stderrTruncated: streams.stderrTruncated,
      credentials,
    }),
  };
}

async function readJobStreams(input: {
  config: InstanceConfigReader;
  client: JobsClient;
  callOptions: JobsCallOptions;
  row: ChatJob;
  job: Job;
}): Promise<JobStreams> {
  const { row, job } = input;

  try {
    return { kind: 'complete', ...(await readOutputStreams(input)) };
  } catch (error) {
    const refusal = mapMachineRefusal(row.machineName, error, true);

    if (
      !(refusal instanceof MachineProtocolError) ||
      refusal.code !== 'machine_job_not_found'
    )
      throw refusal;

    if (job.state === JobState.LOST)
      return {
        kind: 'missing',
        result: unknownResult(row, job, 'Captured output is unavailable.'),
      };

    return {
      kind: 'missing',
      result: {
        status: 'error',
        type: 'unavailable',
        message:
          'The Machine daemon no longer has captured output for this job; its output is unavailable.',
      },
    };
  }
}

function modelResult(
  job: Job,
  streams: Extract<JobStreams, { kind: 'complete' }>,
  row: ChatJob,
  credentials: ReadonlyArray<string>,
): ProcBashResult {
  const sanitized = sanitizeKnownResultAtBound(
    resultFromJob(job, streams.stdout, streams.stderr),
    { kind: 'code-units', limit: BASH_BOUNDS.outputBound },
    credentials,
    {
      stdout: { endedByLlame: streams.stdoutTruncated },
      stderr: { endedByLlame: streams.stderrTruncated },
    },
  );

  return job.state === JobState.LOST ? unknownResult(row, job) : sanitized;
}

function retainedArtifactOutput(input: {
  config: InstanceConfigReader;
  job: Job;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  credentials: ReadonlyArray<string>;
}): ManagedOutput {
  const {
    config,
    job,
    stdout,
    stderr,
    stdoutTruncated,
    stderrTruncated,
    credentials,
  } = input;

  const sanitized = sanitizeKnownResultAtBound(
    resultFromJob(job, stdout, stderr),
    {
      kind: 'code-units',
      limit: config.config.tools.artifacts.maxBytes,
    },
    credentials,
    {
      stdout: { endedByLlame: stdoutTruncated },
      stderr: { endedByLlame: stderrTruncated },
    },
  );

  return {
    stdout: sanitized.stdout,
    stderr: sanitized.stderr,
    truncated: sanitized.truncated || stdoutTruncated || stderrTruncated,
    truncatedStreams: {
      stdout: stdoutTruncated || job.stdout?.truncated === true,
      stderr: stderrTruncated || job.stderr?.truncated === true,
    },
  };
}

async function readOutputStreams(input: {
  config: InstanceConfigReader;
  client: JobsClient;
  callOptions: JobsCallOptions;
  row: ChatJob;
  job: Job;
}) {
  const { config, client, callOptions, row, job } = input;

  const stdoutOutput = await readOutput({
    config,
    client,
    callOptions,
    row,
    stream: OutputStream.STDOUT,
  });

  const stderrOutput = await readOutput({
    config,
    client,
    callOptions,
    row,
    stream: OutputStream.STDERR,
  });

  const stdout = stdoutOutput.text;
  const stderr = stderrOutput.text;

  return {
    stdout,
    stderr,
    stdoutTruncated:
      job.stdout?.truncated === true ||
      stdoutOutput.truncated ||
      BigInt(Buffer.byteLength(stdout)) < (job.stdout?.bytes ?? 0n),
    stderrTruncated:
      job.stderr?.truncated === true ||
      stderrOutput.truncated ||
      BigInt(Buffer.byteLength(stderr)) < (job.stderr?.bytes ?? 0n),
  };
}

function unknownResult(row: ChatJob, job: Job, detail = ''): ProcBashResult {
  return {
    status: 'error',
    type: 'outcome_unknown',
    attemptId: row.runId,
    message: `The Machine daemon lost the job (${lostCauseText(job.lostCause)}).${detail === '' ? '' : ` ${detail}`}`,
  };
}

function resultFromJob(
  job: Job,
  stdout: string,
  stderr: string,
): BashKnownResult | BashTimedOutResult {
  const wallTimeMs = elapsedMs(job);

  const truncated =
    job.stdout?.truncated === true || job.stderr?.truncated === true;

  return job.state === JobState.TIMED_OUT
    ? {
        status: 'error',
        type: 'timed_out',
        durationMs: wallTimeMs,
        wallTimeMs,
        stdout,
        stderr,
        truncated,
      }
    : {
        status: job.state === JobState.SUCCEEDED ? 'success' : 'error',
        exitCode: job.exitCode ?? (job.state === JobState.SUCCEEDED ? 0 : 1),
        stdout,
        stderr,
        truncated,
        wallTimeMs,
      };
}

async function readOutput(input: {
  config: InstanceConfigReader;
  client: JobsClient;
  callOptions: JobsCallOptions;
  row: ChatJob;
  stream: OutputStream;
}): Promise<{ text: string; truncated: boolean }> {
  const { config, client, callOptions, row, stream } = input;
  const maxBytes = config.config.tools.artifacts.maxBytes;
  const chunks: Array<Buffer> = [];
  let bytes = 0;
  let expectedOffset = 0n;
  let truncated = false;

  for await (const part of client.readOutput(
    {
      jobId: row.daemonJobId,
      owner: row.ownerUserId,
      stream,
      offset: 0n,
      limit: BigInt(maxBytes),
    },
    callOptions(),
  )) {
    if (part.offset !== expectedOffset)
      throw new Error('Machine job output contains a gap or overlapping chunk');
    expectedOffset += BigInt(part.data.byteLength);
    const available = maxBytes - bytes;

    if (available <= 0) {
      truncated = true;
      break;
    }

    const chunk = Buffer.from(part.data).subarray(0, available);
    chunks.push(chunk);
    bytes += chunk.byteLength;
    truncated ||= part.data.byteLength > available;
  }

  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

function lostCauseText(cause: LostCause): string {
  if (cause === LostCause.MACHINE_REBOOTED) return 'Machine rebooted';

  if (cause === LostCause.CANCEL_UNPROVED) return 'stop not proved';

  return 'daemon restarted';
}

function elapsedMs(job: Job): number {
  if (job.createdAt === undefined) return 0;

  const started =
    Number(job.createdAt.seconds) * 1000 + job.createdAt.nanos / 1_000_000;

  const ended =
    job.endedAt === undefined
      ? Date.now()
      : Number(job.endedAt.seconds) * 1000 + job.endedAt.nanos / 1_000_000;

  return Math.max(0, ended - started);
}
