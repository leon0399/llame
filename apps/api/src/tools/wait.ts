import { z } from 'zod';

import { neutralizeReservedDelimiters } from '@workspace/runtime-safety';
import { ChatsRepository } from '../chats/chats-repository';
import { type ChatJob } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { workerDeadAfterSeconds } from '../jobs/worker-liveness';
import {
  formatJobLocator,
  jobArtifactLocatorOf,
  parseJobLocatorText,
} from '../jobs/job-locator';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import { readJobNoticeOutputs } from '../runs/job-notice-context';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
import { type Tool, type ToolContext, type ToolResult } from './types';
import { WAIT_SUSPENSION, type WaitRequest } from './wait-suspension';

const waitInputSchema = z.strictObject({
  jobs: z.array(z.string().min(1)).min(1).max(16),
  timeout: z.number().int().min(1).max(3600).optional(),
});

type WaitInput = z.output<typeof waitInputSchema>;

const RUNNING_PROMISE =
  'The jobs continue in the background. You get a notice when one of them settles.';

export const waitTool: Tool<WaitInput> = {
  id: 'wait',
  description: loadPackagedToolDescription('wait'),
  classification: 'read_only',
  spill: 'tool',
  inputSchema: waitInputSchema,
  async execute(context: ToolContext, args: WaitInput): Promise<ToolResult> {
    const stopped = stoppedResult(context);

    if (stopped !== undefined) return stopped;

    const parsed = waitInputSchema.safeParse(args);

    if (!parsed.success) return invalidResult();

    if (!context.beginWaitCall?.()) return invalidResult();

    const locators = parsed.data.jobs.map(parseJobLocatorText);

    if (
      locators.some(
        (locator) => locator === undefined || locator.output !== undefined,
      )
    ) {
      return invalidResult();
    }

    const rows = await resolveWaitJobs(context, locators);

    const afterLookupStop = stoppedResult(context);

    if (afterLookupStop !== undefined) return afterLookupStop;

    if (!rows) return notFoundResult();

    if (!context.toolCallId || !context.onWaitRequested) {
      return {
        status: 'error',
        type: 'no_context',
        message: 'The wait could not be suspended safely.',
      };
    }

    const timeout = parsed.data.timeout ?? 3600;

    const request: WaitRequest = {
      toolCallId: context.toolCallId,
      toolInput: parsed.data,
      jobIds: rows.map(({ id }) => id),
      deadline: new Date(Date.now() + timeout * 1000).toISOString(),
    };

    const beforeSuspendStop = stoppedResult(context);

    if (beforeSuspendStop !== undefined) return beforeSuspendStop;
    context.onWaitRequested(request);

    return WAIT_SUSPENSION;
  },
};

function resolveWaitJobs(
  context: ToolContext,
  locators: ReadonlyArray<ReturnType<typeof parseJobLocatorText>>,
): Promise<Array<ChatJob> | undefined> {
  return context.tenantDb.runAs(context.userId, async (tx) => {
    if (
      !(await new ChatsRepository(tx).findById(context.chatId, context.userId))
    )
      return;

    const jobs = new ChatJobsRepository(tx);

    await jobs.settleOnDeadWorkers(
      context.chatId,
      context.userId,
      context.workerDeadAfterSeconds ??
        workerDeadAfterSeconds(BUILT_IN_DEFAULTS),
    );

    const found: Array<ChatJob> = [];

    for (const locator of locators) {
      if (locator === undefined) return;

      const job = await jobs.findByLocator(
        context.chatId,
        context.userId,
        locator.executor,
        locator.seq,
      );

      if (!job) return;

      found.push(job);
    }

    return found;
  });
}

type WaitResultEntry = {
  locator: string;
  state: ChatJob['state'];
  exitDetail?: {
    exitCode?: number | null;
    signal?: string | null;
    outcomeUnknown?: boolean;
    stoppedBy?: string;
  };
  elapsedMs?: number;
  outputs?: Array<{ name: string; text: string }>;
  artifactLocator?: string;
};

export async function buildWaitResult(
  tx: Db,
  scope: { readonly chatId: string; readonly userId: string },
  rows: ReadonlyArray<ChatJob>,
  ended: 'settled' | 'timeout' | 'interrupted',
): Promise<Extract<ToolResult, { status: 'success' }>> {
  const jobs = new ChatJobsRepository(tx);
  const artifacts = new ArtifactsRepository(tx);
  const entries: Array<WaitResultEntry> = [];

  for (const job of rows) {
    entries.push(await waitResultEntry(job, scope, jobs, artifacts));
  }

  const result: Extract<ToolResult, { status: 'success' }> = {
    status: 'success',
    ended,
    jobs: entries,
  };

  if (rows.some(({ state }) => state === 'running'))
    result.promise = RUNNING_PROMISE;

  return result;
}

async function waitResultEntry(
  job: ChatJob,
  scope: { readonly chatId: string; readonly userId: string },
  jobs: ChatJobsRepository,
  artifacts: ArtifactsRepository,
): Promise<WaitResultEntry> {
  const entry: WaitResultEntry = {
    locator: formatJobLocator(job.executor, job.seq),
    state: job.state,
  };

  if (job.state === 'running') return entry;

  const outputs = await readJobNoticeOutputs({
    chatId: scope.chatId,
    ownerUserId: scope.userId,
    job,
    jobs,
    artifacts,
  });

  const exitDetail: NonNullable<WaitResultEntry['exitDetail']> = {};

  if (job.result?.exitCode !== undefined)
    exitDetail.exitCode = job.result.exitCode;

  if (job.result?.signal !== undefined) exitDetail.signal = job.result.signal;

  if (job.result?.outcomeUnknown !== undefined)
    exitDetail.outcomeUnknown = job.result.outcomeUnknown;

  if (job.state === 'cancelled' && job.stoppedBy !== null)
    exitDetail.stoppedBy = job.stoppedBy;

  const artifactLocator = jobArtifactLocatorOf(job);

  entry.elapsedMs = Math.max(
    0,
    (job.settledAt ?? new Date()).getTime() - job.startedAt.getTime(),
  );

  if (Object.keys(exitDetail).length > 0) entry.exitDetail = exitDetail;

  entry.outputs = outputs.map(({ name, text }) => ({
    name,
    text: neutralizeReservedDelimiters(text.slice(-2000)),
  }));

  if (artifactLocator !== undefined) entry.artifactLocator = artifactLocator;

  return entry;
}

function invalidResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_input',
    message: 'The wait arguments are invalid.',
  };
}

function notFoundResult(): ToolResult {
  return {
    status: 'error',
    type: 'not_found',
    message: 'One or more jobs were not found in this Chat.',
  };
}

function cancelledResult(): ToolResult {
  return {
    status: 'error',
    type: 'cancelled',
    message: 'Tool "wait" was cancelled.',
  };
}

function stoppedResult(context: ToolContext): ToolResult | undefined {
  if (context.abortSignal?.aborted) return cancelledResult();

  if (context.timeoutSignal?.aborted) {
    return {
      status: 'error',
      type: 'timeout',
      message: 'Tool "wait" timed out.',
    };
  }

  return undefined;
}
