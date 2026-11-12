import {
  type ManagedProcessSlot,
  type ManagedBashHandle,
  type ManagedStopResult,
} from '@workspace/bash-executor';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { JobPromotionError } from '../jobs/job-promotion-error';
import { formatJobLocator } from '../jobs/job-locator';
import { type BashInput } from './bash-target';
import { managedBashContext } from './bash-limits';
import { artifactMaxBytes } from './artifacts/spill';
import { toToolResult } from './bash-result';
import { type ToolContext, type ToolResult } from './types';

type AsyncContext = ToolContext &
  Required<Pick<ToolContext, 'runId' | 'nativeExecutorId' | 'toolCallId'>>;

const CANCELLED_BEFORE_START: ToolResult = {
  status: 'error',
  type: 'cancelled',
  message: 'Command was cancelled before start.',
};

/** Fence before spawn, then transfer both command and lifetime to the worker. */
export async function runAsyncBash(
  context: AsyncContext,
  input: BashInput,
  cwd: string,
  slot: ManagedProcessSlot,
): Promise<ToolResult> {
  let handle: ManagedBashHandle | undefined;

  try {
    if (context.bashJobs === undefined || context.jobSettings === undefined)
      return {
        status: 'error',
        type: 'executor_unavailable',
        message: 'The worker job runtime is unavailable.',
      };

    const prior = await beginAsyncCommand(context, cwd);

    if (prior) return prior;

    // The attempt is durable: record the cancelled start, as the foreground
    // path does, so a replay does not report outcome_unknown.
    if (context.abortSignal?.aborted === true)
      return await recordResult(context, CANCELLED_BEFORE_START);
    const startedAt = new Date();

    const started = context.bashJobs.start(
      { command: 'bash', args: ['-c', input.command], cwd, env: input.env },
      managedBashContext(context),
      {
        toolCallId: context.toolCallId,
        protectedValues: context.configuredCredentials,
      },
    );

    if (!('pid' in started))
      return recordResult(context, toToolResult(started));
    handle = started;
    void handle.settled.finally(slot.release);
    const result = await promoteCommand(context, handle, input, startedAt);

    return await recordResult(context, result);
  } finally {
    if (handle === undefined) slot.release();
  }
}

async function promoteCommand(
  context: AsyncContext,
  handle: ManagedBashHandle,
  input: BashInput,
  startedAt: Date,
): Promise<ToolResult> {
  const registry = context.bashJobs;
  const settings = context.jobSettings;

  if (registry === undefined || settings === undefined)
    throw new Error('Missing worker job authority');

  try {
    const job = await registry.promote(handle, {
      ownerUserId: context.userId,
      chatId: context.chatId,
      runId: context.runId,
      toolCallId: context.toolCallId,
      startedAt,
      settings,
      maxBytes: artifactMaxBytes(context),
      configuredCredentials: context.configuredCredentials,
      artifactReadable: context.artifactReadable === true,
      hostFiles: context.artifactHostFiles === true,
      unlimited: input.unlimited === true,
    });

    return toToolResult({
      status: 'success',
      backgrounded: true,
      job: formatJobLocator('bash', job.seq),
      cause: 'async',
      wallTimeMs: Date.now() - startedAt.getTime(),
    });
  } catch (error) {
    if (!(error instanceof JobPromotionError)) throw error;

    return promotionFailure(error.stopped, startedAt);
  }
}

function beginAsyncCommand(
  context: AsyncContext,
  cwd: string,
): Promise<ToolResult | undefined> {
  return context.tenantDb.runAs(context.userId, (db) =>
    new NativeFilesRepository(db).begin({
      runId: context.runId,
      userId: context.userId,
      fence: { bound: true, executorId: context.nativeExecutorId },
      deliverySequence: context.nativeDeliverySequence,
      attemptId: context.attemptId,
      toolCallId: context.toolCallId,
      operation: 'bash',
      path: cwd,
    }),
  );
}

function promotionFailure(
  stopped: ManagedStopResult,
  startedAt: Date,
): ToolResult {
  if (!stopped.proved)
    return {
      status: 'error',
      type: 'outcome_unknown',
      message:
        'The move to a job failed and the process group could not be proven empty. Inspect the workspace before another attempt.',
    };

  const result = toToolResult({
    status: 'error',
    type: 'timed_out',
    wallTimeMs: Date.now() - startedAt.getTime(),
    ...stopped,
  });

  return result.status === 'error'
    ? {
        ...result,
        message: `${result.message}\nThe move to a background job failed; the command was stopped.`,
      }
    : result;
}

async function recordResult(
  context: AsyncContext,
  result: ToolResult,
): Promise<ToolResult> {
  await context.tenantDb.runAs(context.userId, (db) =>
    new RunEventsRepository(db).append(context.runId, 'native.result', {
      toolCallId: context.toolCallId,
      result,
    }),
  );

  return result;
}
