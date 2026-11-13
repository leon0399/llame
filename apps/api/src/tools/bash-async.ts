import {
  renderBashText,
  type ManagedProcessSlot,
  type ManagedBashHandle,
  type ManagedStopResult,
} from '@workspace/bash-executor';
import { type ChatJob } from '../db/schema';
import { type BashJobFacts } from '../jobs/bash-job-registry';
import { formatJobLocator } from '../jobs/job-locator';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { type BashInput } from './bash-target';
import {
  managedBashContext,
  messageMoveWindow,
  settlementGraceMs,
} from './bash-limits';
import { artifactMaxBytes } from './artifacts/spill';
import { toToolResult } from './bash-result';
import { loadPackagedTemplate } from '../prompts/template-engine';
import { spillBashResult } from './bash-spill';
import { type ToolContext, type ToolResult } from './types';

type AsyncContext = ToolContext &
  Required<
    Pick<ToolContext, 'runId' | 'nativeExecutorId' | 'toolCallId' | 'attemptId'>
  >;

const renderPromotionFailure = loadPackagedTemplate<{
  proved: boolean;
  timedOutText: string;
}>(__dirname, 'bash-promotion-failure');

type Move = {
  readonly startedAt: Date;
  readonly cause: 'async' | 'time' | 'message';
};

type PromotionReceipt = {
  readonly result: ToolResult;
  readonly receiptCommitted: boolean;
  readonly recoveryWon: boolean;
  readonly recordResult: boolean;
};

type ForegroundResult = {
  readonly result: ToolResult;
  readonly recordResult: boolean;
};

type SpawnGate = { readonly signal: AbortSignal; spawned: boolean };

type Started =
  | { readonly handle: ManagedBashHandle; readonly startedAt: Date }
  | { readonly result: ToolResult };

const CANCELLED_BEFORE_START = {
  status: 'error',
  type: 'cancelled',
  message: 'Command was cancelled before start.',
} as const;

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
  const controller = new AbortController();
  const gate: SpawnGate = { signal: controller.signal, spawned: false };

  const closeGate = () => {
    controller.abort();

    if (!gate.spawned) slot.release();
  };

  let timer: NodeJS.Timeout | undefined;

  const onMove = () => {
    const deadline =
      messageMoveWindow(context.moveSignal)?.deadlineAt ??
      context.moveDeadlineAt;

    const remaining = settlementGraceMs(deadline);

    if (remaining <= 0) closeGate();
    else timer = setTimeout(closeGate, remaining);
  };

  context.abortSignal?.addEventListener('abort', closeGate, { once: true });
  context.moveSignal?.addEventListener('abort', onMove, { once: true });

  if (context.abortSignal?.aborted) closeGate();
  else if (context.moveSignal?.aborted) onMove();

  try {
    started = await fenceAndSpawn(context, input, cwd, gate);

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
  gate: SpawnGate,
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

  const deadline =
    messageMoveWindow(context.moveSignal)?.deadlineAt ?? context.moveDeadlineAt;

  const expired = deadline !== undefined && performance.now() >= deadline;

  const started =
    gate.signal.aborted || expired
      ? CANCELLED_BEFORE_START
      : bashJobs.start(
          { command: 'bash', args: ['-c', input.command], cwd, env: input.env },
          managedBashContext(context),
          {
            toolCallId: context.toolCallId,
            protectedValues: context.configuredCredentials,
            unlimited: input.unlimited === true,
          },
        );

  if ('pid' in started) {
    gate.spawned = true;
    context.onHostCommandStarted?.();

    return { handle: started, startedAt };
  }

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

  const promoted = await promoteCommand(context, started.handle, input, {
    startedAt: started.startedAt,
    cause: 'async',
  });

  return promoted.recordResult
    ? recordResult(context, promoted.result)
    : promoted.result;
}

async function promoteCommand(
  context: AsyncContext,
  handle: ManagedBashHandle,
  input: BashInput,
  move: Move,
): Promise<PromotionReceipt> {
  const registry = context.bashJobs;

  if (registry === undefined) throw new Error('Missing worker job authority');

  const facts = promotionFacts(context, input, move.startedAt);
  context.onHostPromotionStarted?.();

  const promoted = await registry.promoteWithReceipt(
    handle,
    facts,
    (job) => promotionJobResult(job, move),
    (stopped) => promotionFailure(stopped, move.startedAt),
  );

  return { ...promoted, recordResult: false };
}

function promotionFacts(
  context: AsyncContext,
  input: BashInput,
  startedAt: Date,
): BashJobFacts {
  const settings = context.jobSettings;

  if (settings === undefined) throw new Error('Missing worker job settings');

  return {
    ownerUserId: context.userId,
    chatId: context.chatId,
    runId: context.runId,
    attemptId: context.attemptId,
    toolCallId: context.toolCallId,
    startedAt,
    settings,
    maxBytes: artifactMaxBytes(context),
    configuredCredentials: context.configuredCredentials,
    artifactReadable: context.artifactReadable === true,
    hostFiles: context.artifactHostFiles === true,
    unlimited: input.unlimited === true,
  };
}

function promotionJobResult(job: ChatJob, move: Move): ToolResult {
  return toToolResult({
    status: 'success',
    backgrounded: true,
    job: formatJobLocator('bash', job.seq),
    cause: move.cause,
    wallTimeMs: Date.now() - move.startedAt.getTime(),
  });
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
  const proved = stopped.proved;

  const message = renderPromotionFailure({
    proved,
    timedOutText: proved
      ? renderBashText({
          ...stopped,
          type: 'timed_out',
          wallTimeMs: Date.now() - startedAt.getTime(),
          cut: stopped.truncated,
        })
      : '',
  });

  if (!proved)
    return {
      status: 'error',
      type: 'outcome_unknown',
      message,
    };

  return {
    status: 'error',
    type: 'timed_out',
    message,
  };
}

async function recordResult(
  context: AsyncContext,
  result: ToolResult,
): Promise<ToolResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const receipt = await context.tenantDb.runAs(context.userId, (db) =>
        new NativeFilesRepository(db).recoverHostPromotion({
          runId: context.runId,
          userId: context.userId,
          attemptId: context.attemptId,
          toolCallId: context.toolCallId,
          result,
        }),
      );

      return receipt.result;
    } catch (error) {
      if (attempt === 2) throw error;
      await waitForReceiptRetry();
    }
  }
}

async function waitForReceiptRetry(): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 250);
    timer.unref();
  });
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

  const moved = await foregroundResult(context, started, input);

  return moved.recordResult
    ? recordResult(context, moved.result)
    : moved.result;
}

async function foregroundResult(
  context: AsyncContext,
  started: { readonly handle: ManagedBashHandle; readonly startedAt: Date },
  input: BashInput,
): Promise<ForegroundResult> {
  const { handle } = started;

  const { promise: trigger, resolve } = Promise.withResolvers<
    'abort' | 'move'
  >();

  const dispose = listenForegroundSignals(context, resolve);

  try {
    const first = await Promise.race([
      handle.settled.then((result) => ({ result })),
      trigger,
    ]);

    if (first === 'move') {
      const promoted = await moveInWindow(context, started, input);

      return {
        result: promoted.result,
        recordResult: promoted.recordResult,
      };
    }

    if (first === 'abort') await handle.stop('run');

    return {
      result: await spillBashResult(
        context,
        first === 'abort' ? await handle.settled : first.result,
      ),
      recordResult: true,
    };
  } finally {
    dispose();
  }
}

function listenForegroundSignals(
  context: AsyncContext,
  resolve: (signal: 'abort' | 'move') => void,
): () => void {
  const bindings = [
    [context.abortSignal, () => resolve('abort')],
    [
      context.moveSignal,
      () => {
        context.onHostPromotionStarted?.();
        resolve('move');
      },
    ],
  ] as const;

  for (const [signal, fire] of bindings) {
    if (signal?.aborted === true) fire();
    else signal?.addEventListener('abort', fire, { once: true });
  }

  return () => {
    for (const [signal, fire] of bindings)
      signal?.removeEventListener('abort', fire);
  };
}

/**
 * Promotion and the exact native.result commit in one Run-fenced transaction.
 * The move window controls when promotion starts, not how long its receipt may
 * take: while the transaction is pending, no competing unknown is recorded.
 */
async function moveInWindow(
  context: AsyncContext,
  started: { readonly handle: ManagedBashHandle; readonly startedAt: Date },
  input: BashInput,
): Promise<PromotionReceipt> {
  context.onHostPromotionStarted?.();
  const window = messageMoveWindow(context.moveSignal);

  const promoted = await promoteCommand(context, started.handle, input, {
    startedAt: started.startedAt,
    cause: window?.cause ?? 'time',
  });

  return {
    ...promoted,
    recordResult: !promoted.receiptCommitted && !promoted.recoveryWon,
  };
}
