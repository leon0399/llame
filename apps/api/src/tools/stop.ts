import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

import { type ChatJob } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import {
  formatJobLocator,
  parseJobLocatorText,
  type JobLocator,
} from '../jobs/job-locator';
import { workerDeadAfterSeconds } from '../jobs/worker-liveness';
import { notifyRunControl } from '../runs/run-control';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import { type Tool, type ToolContext, type ToolResult } from './types';

/** The stop wait shared by every job of one call (background-jobs D10). */
const STOP_WAIT_MS = 5000;
const STOP_POLL_MS = 250;

type StopInput = { jobs: Array<string> };

const NOT_FOUND: ToolResult = {
  status: 'error',
  type: 'not_found',
  message: 'A job of this call does not exist in this Chat.',
};

/**
 * Parse every locator before any read: a record locator of the current Chat
 * only, so the output form and another scheme are one invalid input.
 */
function parseLocators(
  locators: ReadonlyArray<string>,
): Array<JobLocator> | undefined {
  const parsed: Array<JobLocator> = [];

  for (const text of locators) {
    const locator = parseJobLocatorText(text);

    if (locator === undefined || locator.output !== undefined) return undefined;
    parsed.push(locator);
  }

  return parsed;
}

/**
 * Resolve every job in the owner's scope, then record the stop requests, all in
 * one transaction. One unknown or foreign job ends the call before any request:
 * the lost-on-touch settlement is all that commits.
 */
function recordRequests(
  context: ToolContext,
  locators: ReadonlyArray<JobLocator>,
): Promise<Array<ChatJob> | undefined> {
  return context.tenantDb.runAs(context.userId, async (tx: Db) => {
    const jobs = new ChatJobsRepository(tx);

    await jobs.settleOnDeadWorkers(
      context.chatId,
      context.userId,
      context.workerDeadAfterSeconds ??
        workerDeadAfterSeconds(BUILT_IN_DEFAULTS),
    );

    const rows: Array<ChatJob> = [];

    for (const { executor, seq } of locators) {
      const row = await jobs.findByLocator(
        context.chatId,
        context.userId,
        executor,
        seq,
      );

      if (row === undefined) return undefined;
      rows.push(row);
    }

    for (const row of rows) {
      if (row.state !== 'running') continue;

      const requested = await jobs.requestStop(
        context.chatId,
        context.userId,
        row.id,
        'assistant',
      );

      if (requested !== undefined)
        await notifyRunControl(tx, { kind: 'job-stop', jobId: row.id });
    }

    return rows;
  });
}

/** A settled row never changes, so only a running one is read again. */
function readRows(
  context: ToolContext,
  rows: ReadonlyArray<ChatJob>,
): Promise<Array<ChatJob>> {
  return context.tenantDb.runAs(context.userId, async (tx: Db) => {
    const jobs = new ChatJobsRepository(tx);
    const current: Array<ChatJob> = [];

    for (const row of rows) {
      current.push(
        row.state !== 'running'
          ? row
          : ((await jobs.findById(context.chatId, context.userId, row.id)) ??
              row),
      );
    }

    return current;
  });
}

/**
 * Wait for the settlements under one monotonic deadline. A job this worker
 * hosts settles through its own registry; any other job is read every 250 ms.
 * The stop request is durable, so a deadline that passes changes nothing.
 */
async function awaitSettlement(
  context: ToolContext,
  rows: ReadonlyArray<ChatJob>,
  deadline: number,
): Promise<Array<ChatJob>> {
  const registry = context.bashJobs;
  const remaining = () => Math.max(0, deadline - performance.now());
  const timer = new AbortController();

  // The registry stops a job it hosts with the stopper stored on the row, so
  // the first request wins; a job it does not host resolves at once.
  await Promise.race([
    Promise.all(
      rows.flatMap((row) =>
        row.state === 'running'
          ? [registry?.recheckJob(row.id) ?? Promise.resolve()]
          : [],
      ),
    ),
    delay(remaining(), undefined, { signal: timer.signal }),
  ])
    .catch(() => undefined)
    .finally(() => timer.abort());

  let current = await readRows(context, rows);

  while (current.some((row) => row.state === 'running') && remaining() > 0) {
    await delay(Math.min(STOP_POLL_MS, remaining()));
    current = await readRows(context, current);
  }

  return current;
}

function stopOutput(rows: ReadonlyArray<ChatJob>): ToolResult {
  return {
    status: 'success',
    jobs: rows.map((row) => ({
      job: formatJobLocator(row.executor, row.seq),
      state: row.state,
      ...(row.stoppedBy !== null && { stopped_by: row.stoppedBy }),
    })),
  };
}

export const stopTool: Tool<StopInput> = {
  id: 'stop',
  classification: 'execute_code',
  description: loadPackagedToolDescription('stop'),
  inputSchema: z.strictObject({
    jobs: z.array(z.string().min(1)).min(1).max(16),
  }),
  execute: async (context, input): Promise<ToolResult> => {
    const locators = parseLocators(input.jobs);

    if (locators === undefined)
      return {
        status: 'error',
        type: 'invalid_input',
        message:
          'Each entry of jobs must be a job locator such as job://bash-4.',
      };
    context.abortSignal?.throwIfAborted();

    // Without a trusted native host identity the tool fails closed before any read.
    if (context.nativeExecutorId === undefined)
      return {
        status: 'error',
        type: 'executor_unavailable',
        message: 'Native host authority is unavailable.',
      };

    const rows = await recordRequests(context, locators);

    if (rows === undefined) return NOT_FOUND;
    // The wait starts after the requests commit and bounds the whole call.
    const deadline = performance.now() + STOP_WAIT_MS;

    return stopOutput(await awaitSettlement(context, rows, deadline));
  },
};
