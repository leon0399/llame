import {
  applySelectorSuffix,
  parsePathScheme,
  resolveEndRelativeSelector,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

import { type ChatJob } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { artifactLineCount, artifactText } from '../tools/artifacts/lines';
import { renderListing } from '../tools/listing-window';
import { nativeErrorResult, selectInMemoryText } from '../tools/text-selection';
import { type ToolContext, type ToolResult } from '../tools/types';
import { ChatJobsRepository } from './chat-jobs.repository';
import { retryRunTransaction } from '../runs/run-transaction';
import {
  formatJobLocator,
  JOB_SCHEME,
  jobArtifactLocatorOf,
  parseJobLocatorText,
  type JobLocator,
} from './job-locator';
import { workerDeadAfterSeconds } from './worker-liveness';

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

  return retryRunTransaction(() =>
    context.tenantDb.runAs(context.userId, async (db) => {
      const jobs = new ChatJobsRepository(db);

      await jobs.settleOnDeadWorkers(
        context.chatId,
        context.userId,
        context.workerDeadAfterSeconds ??
          workerDeadAfterSeconds(BUILT_IN_DEFAULTS),
      );

      return locator === undefined
        ? listJobs(context, jobs, selector)
        : readLocator(context, { db, jobs }, locator, selector);
    }),
  );
}

async function listJobs(
  context: ToolContext,
  jobs: ChatJobsRepository,
  selector: string | undefined,
): Promise<ToolResult> {
  const rows = await jobs.listByChat(context.chatId, context.userId);

  const entries = rows.map(
    (job) =>
      `${formatJobLocator(job.executor, job.seq)} (${job.state}, ${job.startedAt.toISOString()})`,
  );

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
    locator.executor,
    locator.seq,
  );

  if (job === undefined) return notFoundResult();

  const path = formatJobLocator(locator.executor, locator.seq, locator.output);

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

/**
 * The text of one output. A job that stored an artifact keeps the whole output
 * there; every other job keeps its increments. A part that the artifact lacks
 * falls back to the increments.
 */
async function storedOutput(
  context: ToolContext,
  { db, jobs }: JobStore,
  job: ChatJob,
  output: string,
): Promise<string> {
  if (job.artifactId !== null) {
    const part = await new ArtifactsRepository(db).readPart(
      context.chatId,
      job.executor,
      job.seq,
      output,
    );

    if (part !== undefined) return part.content.toString('utf8');
  }

  return (await jobs.readOutput(context.userId, job.id, output)).toString(
    'utf8',
  );
}

/** One `<name>: <value>` line for each field of the record. */
function recordLines(job: ChatJob): Array<string> {
  const end = job.settledAt ?? new Date();

  const lines = [
    `executor: ${job.executor}`,
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

  if (result?.outcomeUnknown === true) {
    lines.push('outcome: unknown (the worker of this job stopped)');
  }

  const artifact = jobArtifactLocatorOf(job);

  if (artifact !== undefined) lines.push(`artifact: ${artifact}`);

  return lines;
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

const listingRefusal = (): ToolResult => ({
  status: 'error',
  type: 'invalid_selector',
  message:
    'A job listing or record accepts a single :N-M, :N+K, :N-, or :-K range; comma ranges, :raw, and :outline are not supported.',
});

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
