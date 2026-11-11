import {
  renderBashText,
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
import { spillBashResult } from './bash-spill';
import { type ToolContext, type ToolResult } from './types';

/** A move that is still unrecorded this long after it started is a late move. */
const MOVE_WINDOW_MS = 750;

type AsyncContext = ToolContext &
  Required<Pick<ToolContext, 'runId' | 'nativeExecutorId' | 'toolCallId'>>;

type Move = { readonly startedAt: Date; readonly cause: 'async' | 'time' };

type Started =
  | { readonly result: ToolResult }
  | { readonly handle: ManagedBashHandle; readonly startedAt: Date };

/**
 * Fence, then spawn on the worker registry. A call whose Run was cancelled
 * before the spawn records a known `cancelled` result, never an unknown one.
 * The slot is held until the command settles, or released here if none started.
 */
async function startHostCommand(
  context: AsyncContext,
  input: BashInput,
  cwd: string,
  slot: ManagedProcessSlot,
): Promise<Started> {
  let started: Started | undefined;
  const abort = context.abortSignal;
  // An abort before the spawn frees the slot at once: the call never spawns.
  const onAbort = () => slot.release();

  abort?.addEventListener('abort', onAbort, { once: true });

  try {
    started = await fenceAndSpawn(context, input, cwd);

    if ('handle' in started) void started.handle.settled.finally(slot.release);

    return started;
  } finally {
    abort?.removeEventListener('abort', onAbort);

    if (started === undefined || 'result' in started) slot.release();
  }
}

async function fenceAndSpawn(
  context: AsyncContext,
  input: BashInput,
  cwd: string,
): Promise<Started> {
  const { bashJobs, jobSettings } = context;

  if (bashJobs === undefined || jobSettings === undefined)
    return {
      result: {
        status: 'error',
        type: 'executor_unavailable',
        message: 'The worker job runtime is unavailable.',
      },
    };

  const prior = await beginHostCommand(context, cwd);

  if (prior) return { result: prior };
  const startedAt = new Date();

  const started = context.abortSignal?.aborted
    ? ({
        status: 'error',
        type: 'cancelled',
        message: 'Command was cancelled before start.',
      } as const)
    : bashJobs.start(
        { command: 'bash', args: ['-c', input.command], cwd, env: input.env },
        managedBashContext(context),
        {
          toolCallId: context.toolCallId,
          protectedValues: context.configuredCredentials,
        },
      );

  if ('pid' in started) return { handle: started, startedAt };

  return { result: await recordResult(context, toToolResult(started)) };
}

/** `async: true`: promote at spawn and return `backgrounded`. */
export async function runAsyncBash(
  context: AsyncContext,
  input: BashInput,
  cwd: string,
  slot: ManagedProcessSlot,
): Promise<ToolResult> {
  const started = await startHostCommand(context, input, cwd, slot);

  if ('result' in started) return started.result;

  return recordResult(
    context,
    await promoteCommand(context, started.handle, input, {
      startedAt: started.startedAt,
      cause: 'async',
    }),
  );
}

async function promoteCommand(
  context: AsyncContext,
  handle: ManagedBashHandle,
  input: BashInput,
  { startedAt, cause }: Move,
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
      cause,
      wallTimeMs: Date.now() - startedAt.getTime(),
    });
  } catch (error) {
    if (!(error instanceof JobPromotionError)) throw error;

    return promotionFailure(error.stopped, startedAt);
  }
}

function beginHostCommand(
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

  return {
    status: 'error',
    type: 'timed_out',
    message: `${renderBashText({
      ...stopped,
      type: 'timed_out',
      wallTimeMs: Date.now() - startedAt.getTime(),
      cut: stopped.truncated,
    })}\nThe move to a background job failed; the command was stopped.`,
  };
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

/**
 * The foreground host call: the same fence and start as an async job, then a
 * race between the exit, the foreground bound, and the Run abort. The bound
 * moves the command; it never stops it.
 */
export async function runForegroundBash(
  context: AsyncContext,
  input: BashInput,
  cwd: string,
  slot: ManagedProcessSlot,
): Promise<ToolResult> {
  const started = await startHostCommand(context, input, cwd, slot);

  if ('result' in started) return started.result;

  return recordResult(
    context,
    await foregroundResult(context, started.handle, input, started.startedAt),
  );
}

/** The foreground bound: the lesser of the operator bound and the call timeout. */
function foregroundBoundMs(context: ToolContext): number {
  const bound = (context.bashBackgroundAfterSeconds ?? 120) * 1000;

  return Math.min(bound, context.timeoutMs ?? bound);
}

async function foregroundResult(
  context: AsyncContext,
  handle: ManagedBashHandle,
  input: BashInput,
  startedAt: Date,
): Promise<ToolResult> {
  const abort = context.abortSignal;

  const { promise: stopped, resolve: onAbort } =
    Promise.withResolvers<undefined>();

  const { promise: bound, resolve: onBound } =
    Promise.withResolvers<undefined>();

  const timer = setTimeout(
    () => onBound(undefined),
    foregroundBoundMs(context),
  );

  const aborted = () => onAbort(undefined);
  abort?.addEventListener('abort', aborted, { once: true });

  try {
    const first = await Promise.race([
      handle.settled.then((result) => ({ result })),
      bound.then(() => 'bound' as const),
      (abort?.aborted === true ? Promise.resolve(undefined) : stopped).then(
        () => 'abort' as const,
      ),
    ]);

    if (first === 'bound')
      return await moveInWindow(context, handle, input, startedAt);

    if (first === 'abort') await handle.stop('run');

    return await spillBashResult(
      context,
      first === 'abort' ? await handle.settled : first.result,
    );
  } finally {
    clearTimeout(timer);
    abort?.removeEventListener('abort', aborted);
  }
}

/**
 * Promotion has its own window. A move that fails inside it carries its stop
 * proof; one that commits after it leaves an ordinary job and one unknown
 * result. The command is never signalled for a pending promotion.
 */
async function moveInWindow(
  context: AsyncContext,
  handle: ManagedBashHandle,
  input: BashInput,
  startedAt: Date,
): Promise<ToolResult> {
  const promotion = promoteCommand(context, handle, input, {
    startedAt,
    cause: 'time',
  });

  const { promise: late, resolve: onLate } = Promise.withResolvers<undefined>();
  const timer = setTimeout(() => onLate(undefined), MOVE_WINDOW_MS);

  try {
    const timely = await Promise.race([promotion, late]);

    if (timely !== undefined) return timely;
    // A late failure stops the command inside the registry; it cannot replace
    // the unknown result this call records now.
    promotion.catch(() => undefined);

    return {
      status: 'error',
      type: 'outcome_unknown',
      message:
        'The move to a background job did not finish in time. The command may continue as a job; check its job record before another attempt. It will not be repeated automatically.',
    };
  } finally {
    clearTimeout(timer);
  }
}
