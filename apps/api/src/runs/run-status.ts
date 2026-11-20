import { and, eq, isNull, notInArray } from 'drizzle-orm';
import { runs, type RunStatus } from '../db/schema/chats';

/**
 * The statuses a Run never leaves. The partial unique index
 * `runs_chat_inflight_unique` in `db/schema/chats.ts` spells the same set as
 * SQL, because an index predicate cannot reference this constant; change both
 * together.
 */
export const TERMINAL_RUN_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'expired',
] as const satisfies ReadonlyArray<RunStatus>;

export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

export const WAITING_RUN_STATUSES = [
  'awaiting_jobs',
  'awaiting_quota',
] as const satisfies ReadonlyArray<RunStatus>;

export type WaitingRunStatus = (typeof WAITING_RUN_STATUSES)[number];

const waitingRunStatuses: ReadonlySet<RunStatus> = new Set(
  WAITING_RUN_STATUSES,
);

export function isWaitingRunStatus(
  status: RunStatus,
): status is WaitingRunStatus {
  return waitingRunStatuses.has(status);
}

const terminalRunStatuses: ReadonlySet<RunStatus> = new Set(
  TERMINAL_RUN_STATUSES,
);

export function isTerminalRunStatus(
  status: RunStatus,
): status is TerminalRunStatus {
  return terminalRunStatuses.has(status);
}

/** Query predicate: the Run row is not in a terminal status. */
export function nonTerminalRun() {
  return notInArray(runs.status, [...TERMINAL_RUN_STATUSES]);
}

export type MarkFinishedOptions = {
  error?: unknown;
  attemptId?: string;
  expectedQueueIdentity?: {
    currentJobId: string | null;
    wakeGeneration: number;
  };
};

export type MarkStartedOptions = {
  workerId?: string;
  attemptId?: string;
  expectedQueueIdentity?: MarkFinishedOptions['expectedQueueIdentity'];
};

type MarkFinishedUpdate = {
  status: TerminalRunStatus;
  finishedAt: Date;
  error?: unknown;
  completedAttemptId?: string;
};

export function markFinishedUpdate(
  status: TerminalRunStatus,
  options: MarkFinishedOptions | undefined,
): MarkFinishedUpdate {
  const update: MarkFinishedUpdate = {
    status,
    finishedAt: new Date(),
  };

  if (options?.error !== undefined) update.error = options.error;

  if (status === 'completed' && options?.attemptId !== undefined) {
    update.completedAttemptId = options.attemptId;
  }

  return update;
}

export function queueIdentityPredicate(
  identity: NonNullable<MarkFinishedOptions['expectedQueueIdentity']>,
) {
  return and(
    identity.currentJobId === null
      ? isNull(runs.currentJobId)
      : eq(runs.currentJobId, identity.currentJobId),
    eq(runs.wakeGeneration, identity.wakeGeneration),
  );
}

export function claimableRunPredicate(
  identity?: NonNullable<MarkFinishedOptions['expectedQueueIdentity']>,
) {
  return and(
    notInArray(runs.status, [...WAITING_RUN_STATUSES]),
    nonTerminalRun(),
    ...(identity ? [queueIdentityPredicate(identity)] : []),
  );
}

/**
 * Keep first-writer-wins and attempt fencing in one owner-scoped predicate.
 */
export function markFinishedPredicate(
  runId: string,
  userId: string,
  attemptId: string | undefined,
  expectedQueueIdentity?: MarkFinishedOptions['expectedQueueIdentity'],
) {
  return and(
    eq(runs.id, runId),
    eq(runs.userId, userId),
    isNull(runs.finishedAt),
    nonTerminalRun(),
    ...(attemptId === undefined ? [] : [eq(runs.activeAttemptId, attemptId)]),
    ...(expectedQueueIdentity
      ? [queueIdentityPredicate(expectedQueueIdentity)]
      : []),
  );
}
