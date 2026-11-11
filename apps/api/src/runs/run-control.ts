import { isRecord, isString } from '@workspace/runtime-safety';
import { sql } from 'drizzle-orm';

import { type Db } from '../db/tenant-db.service';

/** The Postgres channel that carries Run control to the process executing a Run. */
export const RUN_CONTROL_CHANNEL = 'llame_run_control';

export const RUN_CONTROL_LISTENER = Symbol('RUN_CONTROL_LISTENER');

export type RunControlKind = 'cancel' | 'interrupt';

export type RunControlMessage =
  | { runId: string; kind: RunControlKind }
  | { jobId: string; kind: 'job-stop' };

/**
 * Sends one control pointer. Called in the transaction that records the
 * change, so Postgres delivers it on commit only; the payload names the Run
 * and never carries state, so the receiver confirms the recorded state itself.
 */
export async function notifyRunControl(
  tx: Db,
  message: RunControlMessage,
): Promise<void> {
  await tx.execute(
    sql`select pg_notify(${RUN_CONTROL_CHANNEL}, ${JSON.stringify(message)})`,
  );
}

export function parseRunControl(raw: string): RunControlMessage | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;
  const { runId, kind } = parsed;

  if (kind === 'job-stop' && isString(parsed.jobId))
    return { jobId: parsed.jobId, kind };

  if (!isString(runId)) return undefined;

  return kind === 'cancel' || kind === 'interrupt'
    ? { runId, kind }
    : undefined;
}
