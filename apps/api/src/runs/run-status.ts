import { notInArray } from 'drizzle-orm';
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
