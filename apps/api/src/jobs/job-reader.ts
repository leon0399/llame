import {
  applySelectorSuffix,
  parsePathScheme,
  resolveEndRelativeSelector,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

import {
  BASH_BOUNDS,
  BYTES_CHUNK_BYTES,
  OutputStream,
} from '@workspace/machine-protocol';
import {
  sanitizeKnownResultAtBound,
  type BashKnownResult,
} from '@workspace/bash-executor';
import { type CallOptions, type Client } from '@connectrpc/connect';
import { JobService } from '@workspace/machine-protocol';

import { type Db } from '../db/tenant-db.service';
import { type ChatJob } from '../db/schema';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { artifactLineCount, artifactText } from '../tools/artifacts/lines';
import {
  BARE_NUMBER_NOTE,
  LISTING_RANGE_FORMS,
  renderListing,
  type ListingRefusal,
} from '../tools/listing-window';
import { nativeErrorResult, selectInMemoryText } from '../tools/text-selection';
import { type ToolContext, type ToolResult } from '../tools/types';
import { ChatJobsRepository } from './chat-jobs.repository';
import {
  formatJobLocator,
  JOB_SCHEME,
  jobArtifactLocatorOf,
  parseJobLocatorText,
  type JobLocator,
} from './job-locator';

type JobsClient = Client<typeof JobService>;

const BARE_LOCATOR = `${JOB_SCHEME}://`;

/**
 * The `job://` reader (background-jobs). It routes before local path
 * resolution, needs no native executor, and reads one Chat's jobs through the
 * Chat-owner RLS identity. A read is a touch: a running job of a dead worker
 * settles as `lost` before the read answers, and its stored output stays
 * readable. A bare locator lists the Chat's jobs, a record locator returns the
 * job record, and an output locator returns the stored text of that output.
 */
export async function readJob(
  context: ToolContext,
  operation: 'read' | 'edit' | 'write',
  submitted: string,
): Promise<ToolResult> {
  if (operation !== 'read') {
    return {
      status: 'error',
      type: 'invalid_path',
      message: 'Job locators are read-only; edit and write cannot target them.',
    };
  }

  const { path, selector } = splitSelectorSuffix(submitted);
  const scheme = parsePathScheme(path);
  const bare = scheme?.scheme === JOB_SCHEME && scheme.rest === '';
  const locator = bare ? undefined : parseJobLocatorText(path);

  if (!bare && locator === undefined) return invalidLocatorResult();

  context.abortSignal?.throwIfAborted();

  return context.tenantDb.runAs(context.userId, async (db) => {
    const jobs = new ChatJobsRepository(db);

    return locator === undefined
      ? listJobs(context, jobs, selector)
      : readLocator(context, { db, jobs }, locator, selector);
  });
}

async function listJobs(
  context: ToolContext,
  jobs: ChatJobsRepository,
  selector: string | undefined,
): Promise<ToolResult> {
  const rows = await jobs.listByChat(context.chatId, context.userId);
  const machineStatus = await context.machineStatus?.list(context.userId);

  const reachable = new Map(
    machineStatus?.map((machine) => [
      machine.name,
      machine.status === 'online',
    ]),
  );

  const entries = rows.map((job) => {
    const state =
      job.state === 'running' && reachable.get(job.machineName) === false
        ? 'unknown'
        : job.state;

    return `${formatJobLocator(job.kind, job.seq)} (${state}, ${job.startedAt.toISOString()})`;
  });

  return renderListing(BARE_LOCATOR, entries, selector, {
    emptyContent: `${BARE_LOCATOR}: empty\n`,
    refuse: listingRefusal,
  });
}

/** The owner-scoped handles of one read transaction. */
type JobStore = { readonly db: Db; readonly jobs: ChatJobsRepository };

async function readLocator(
  context: ToolContext,
  store: JobStore,
  locator: JobLocator,
  selector: string | undefined,
): Promise<ToolResult> {
  const job = await store.jobs.findByLocator(
    context.chatId,
    context.userId,
    locator.kind,
    locator.seq,
  );

  if (job === undefined) return notFoundResult();

  const path = formatJobLocator(locator.kind, locator.seq, locator.output);

  if (locator.output === undefined) {
    return renderListing(path, recordLines(job), selector, {
      emptyContent: '',
      refuse: listingRefusal,
    });
  }

  if (!job.outputs.includes(locator.output)) return notFoundResult();

  const stored = await storedOutput(context, store, job, locator.output);

  return readText(path, stored, selector);
}

/** Read a settled artifact or a running daemon stream from byte offset zero. */
async function storedOutput(
  context: ToolContext,
  { db }: JobStore,
  job: ChatJob,
  output: string,
): Promise<string> {
  if (job.state === 'running') return readRunningOutput(context, job, output);

  if (job.artifactId === null) return 'output unavailable right now';

  const part = await new ArtifactsRepository(db).readPart(
    context.chatId,
    job.kind,
    job.seq,
    output,
  );

  return part?.content.toString('utf8') ?? 'output unavailable right now';
}

async function readRunningOutput(
  context: ToolContext,
  job: ChatJob,
  output: string,
): Promise<string> {
  if (context.machines === undefined) return 'output unavailable right now';

  try {
    const { client, callOptions } = await context.machines.jobsClient(
      job.machineName,
    );

    return await readRunningOutputChunks({
      client,
      callOptions: callOptions(),
      owner: context.userId,
      jobId: job.daemonJobId,
      output,
      credentials: context.configuredCredentials,
    });
  } catch {
    return 'output unavailable right now';
  }
}

async function readRunningOutputChunks({
  client,
  callOptions,
  owner,
  jobId,
  output,
  credentials,
}: {
  readonly client: JobsClient;
  readonly callOptions: CallOptions;
  readonly owner: string;
  readonly jobId: string;
  readonly output: string;
  readonly credentials: ReadonlyArray<string>;
}): Promise<string> {
  const chunks: Array<Buffer> = [];
  let offset = 0n;
  let remaining = BigInt(BASH_BOUNDS.outputBound * 4);

  while (remaining > 0n) {
    const read = await appendOutputChunks(
      client,
      callOptions,
      {
        jobId,
        owner,
        stream: output === 'stdout' ? OutputStream.STDOUT : OutputStream.STDERR,
        offset,
        limit:
          remaining < BigInt(BYTES_CHUNK_BYTES)
            ? remaining
            : BigInt(BYTES_CHUNK_BYTES),
      },
      chunks,
    );

    if (read === 0n) break;
    offset += read;
    remaining -= read;
  }

  return sanitizeLiveOutput(
    Buffer.concat(chunks).toString('utf8'),
    credentials,
  );
}

async function appendOutputChunks(
  client: JobsClient,
  callOptions: CallOptions,
  request: Parameters<JobsClient['readOutput']>[0],
  chunks: Array<Buffer>,
): Promise<bigint> {
  let read = 0n;

  for await (const part of client.readOutput(request, callOptions)) {
    chunks.push(Buffer.from(part.data));
    read += BigInt(part.data.length);
  }

  return read;
}

function sanitizeLiveOutput(
  raw: string,
  credentials: ReadonlyArray<string>,
): string {
  const result: BashKnownResult = {
    status: 'success',
    exitCode: 0,
    stdout: raw,
    stderr: '',
    truncated: false,
    wallTimeMs: 0,
  };

  return sanitizeKnownResultAtBound(
    result,
    { kind: 'code-units', limit: BASH_BOUNDS.outputBound },
    credentials,
    {
      stdout: { endedByLlame: true },
      stderr: { endedByLlame: true },
    },
  ).stdout;
}

function recordLines(job: ChatJob): Array<string> {
  const end = job.settledAt ?? new Date();

  const lines = [
    `kind: ${job.kind}`,
    `state: ${job.state}`,
    `started_at: ${job.startedAt.toISOString()}`,
    `elapsed: ${((end.getTime() - job.startedAt.getTime()) / 1000).toFixed(1)} s`,
    `outputs: ${job.outputs.join(', ')}`,
  ];

  if (job.settledAt !== null) {
    lines.push(`settled_at: ${job.settledAt.toISOString()}`);
  }

  if (job.stoppedBy !== null) lines.push(`stopped_by: ${job.stoppedBy}`);

  if (job.state === 'running' && job.stopRequestedBy !== null) {
    lines.push(`stop_requested_by: ${job.stopRequestedBy}`);
  }

  const { result } = job;

  if (result?.exitCode !== undefined && result.exitCode !== null) {
    lines.push(`exit_code: ${result.exitCode}`);
  }

  if (result?.signal !== undefined && result.signal !== null) {
    lines.push(`signal: ${result.signal}`);
  }

  const cut = job.outputs.filter(
    (output) => result?.truncated?.[output] === true,
  );

  if (cut.length > 0) lines.push(`truncated: ${cut.join(', ')}`);

  appendJobOutcome(lines, job);

  const artifact = jobArtifactLocatorOf(job);

  if (artifact !== undefined) lines.push(`artifact: ${artifact}`);

  return lines;
}

function appendJobOutcome(lines: Array<string>, job: ChatJob): void {
  const { result } = job;

  if (result?.outcomeUnknown !== true) return;

  const causeText =
    result.cause === 'daemon_restarted'
      ? 'the Machine daemon restarted'
      : result.cause === 'machine_rebooted'
        ? 'the Machine rebooted'
        : result.cause === 'stop_unproved'
          ? 'the stop was not proved'
          : 'the Machine daemon restarted';

  lines.push(`outcome: unknown (${causeText})`);
}

/** A stored output's text, numbered as the artifact reader numbers it. */
async function readText(
  path: string,
  source: string,
  selector: string | undefined,
): Promise<ToolResult> {
  try {
    const lineCount = artifactLineCount(source);
    const target = applySelectorSuffix(path, selector);

    return await selectInMemoryText({
      target: resolveEndRelativeSelector(target, lineCount),
      text: artifactText(source),
      lineCount,
      mediaType: 'text/plain',
    });
  } catch (error) {
    const refused = nativeErrorResult(error);

    if (refused !== undefined) return refused;
    throw error;
  }
}

const JOB_LISTING_REFUSAL = `A job listing or record accepts ${LISTING_RANGE_FORMS}; comma ranges, :raw, and :outline are not supported. ${BARE_NUMBER_NOTE}`;

/** The job's wording of a refusal. A selector the applier judged itself keeps
 *  the applier's text, so a misplaced unit letter shows its own hint. */
function listingRefusal(refusal: ListingRefusal): ToolResult {
  const message =
    refusal.kind === 'invalid' ? refusal.message : JOB_LISTING_REFUSAL;

  return { status: 'error', type: 'invalid_selector', message };
}

function invalidLocatorResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_path',
    message:
      'A job locator is job://<executor>-<n>, optionally followed by /<output>, or job:// for the list.',
  };
}

function notFoundResult(): ToolResult {
  return {
    status: 'error',
    type: 'not_found',
    message: 'The job or output is not found in this Chat.',
  };
}
