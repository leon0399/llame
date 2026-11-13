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
import { BASH_SETTLEMENT_GRACE_MS, managedBashContext } from './bash-limits';
import { artifactMaxBytes } from './artifacts/spill';
import { toToolResult } from './bash-result';
import { spillBashResult } from './bash-spill';
import { type ToolContext, type ToolResult } from './types';

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
  // The call never spawns once its Run aborts, or once the fence has taken
  // longer than the move window after the bound: the slot is freed at once.
  const gate = new AbortController();

  const closeGate = () => {
    gate.abort();
    slot.release();
  };

  let timer: NodeJS.Timeout | undefined;

  const onMove = () => {
    const remaining =
      context.moveDeadlineAt === undefined
        ? BASH_SETTLEMENT_GRACE_MS
        : context.moveDeadlineAt - performance.now();

    if (remaining <= 0) closeGate();
    else timer = setTimeout(closeGate, remaining);
  };

  context.abortSignal?.addEventListener('abort', closeGate, { once: true });
  context.moveSignal?.addEventListener('abort', onMove, { once: true });

  if (context.abortSignal?.aborted) closeGate();
  else if (context.moveSignal?.aborted) onMove();

  try {
    started = await fenceAndSpawn(context, input, cwd, gate.signal);

    if ('handle' in started) void started.handle.settled.finally(slot.release);

    return started;
  } finally {
    clearTimeout(timer);
    context.abortSignal?.removeEventListener('abort', closeGate);
    context.moveSignal?.removeEventListener('abort', onMove);

    if (started === undefined || 'result' in started) slot.release();
  }
}

async function fenceAndSpawn(
  context: AsyncContext,
  input: BashInput,
  cwd: string,
  gate: AbortSignal,
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

  const expired =
    context.moveDeadlineAt !== undefined &&
    performance.now() >= context.moveDeadlineAt;

  const started =
    gate.aborted || expired
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
            unlimited: input.unlimited === true,
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

/** One `native.result` for each call: the first writer wins. */
function onceRecorder(
  context: AsyncContext,
): (result: ToolResult) => Promise<ToolResult> {
  let claimed = false;

  return (result) => {
    if (claimed) return Promise.resolve(result);
    claimed = true;

    return recordResult(context, result);
  };
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
  const record = onceRecorder(context);

  return record(await foregroundResult(context, started, input, record));
}

async function foregroundResult(
  context: AsyncContext,
  started: { readonly handle: ManagedBashHandle; readonly startedAt: Date },
  input: BashInput,
  record: (result: ToolResult) => Promise<ToolResult>,
): Promise<ToolResult> {
  const { handle } = started;

  const { promise: trigger, resolve } = Promise.withResolvers<
    'move' | 'abort'
  >();

  const abort = context.abortSignal;
  const bound = context.moveSignal;
  const onAbort = () => resolve('abort');
  const onMove = () => resolve('move');

  // The Run abort is registered first, so it wins when both have fired.
  for (const [signal, fire] of [
    [abort, onAbort],
    [bound, onMove],
  ] as const) {
    if (signal?.aborted === true) fire();
    else signal?.addEventListener('abort', fire, { once: true });
  }

  try {
    const first = await Promise.race([
      handle.settled.then((result) => ({ result })),
      trigger,
    ]);

    if (first === 'move')
      return await moveInWindow(context, started, input, record);

    if (first === 'abort') await handle.stop('run');

    return await spillBashResult(
      context,
      first === 'abort' ? await handle.settled : first.result,
    );
  } finally {
    abort?.removeEventListener('abort', onAbort);
    bound?.removeEventListener('abort', onMove);
  }
}

/**
 * The promotion and its `native.result` share one window. A move that fails
 * inside it carries its stop proof; one that is not recorded inside it leaves
 * an ordinary job and one unknown result. The command is never signalled for a
 * pending promotion, and a late settlement appends nothing more.
 */
async function moveInWindow(
  context: AsyncContext,
  started: { readonly handle: ManagedBashHandle; readonly startedAt: Date },
  input: BashInput,
  record: (result: ToolResult) => Promise<ToolResult>,
): Promise<ToolResult> {
  let expired = false;

  const moved = promoteCommand(context, started.handle, input, {
    startedAt: started.startedAt,
    cause: 'time',
  }).then((result) => (expired ? result : record(result)));

  const { promise: late, resolve: onLate } = Promise.withResolvers<undefined>();

  const timer = setTimeout(() => {
    expired = true;
    onLate(undefined);
  }, BASH_SETTLEMENT_GRACE_MS);

  try {
    const timely = await Promise.race([moved, late]);

    if (timely !== undefined) return timely;
    // A late failure stops the command inside the registry; it cannot replace
    // the unknown result the caller records now.
    moved.catch(() => undefined);

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
