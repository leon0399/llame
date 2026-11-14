import { and, desc, eq, sql } from 'drizzle-orm';
import { runEvents, runs, type RunEvent } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

export class NativeReceiptsRepository {
  constructor(private readonly db: Db) {}

  /** The newest native.result for one tool call, without treating a bare
   * native.attempt as a committed receipt. Used to reconcile an ambiguous
   * promotion-transaction acknowledgement without inventing an outcome. */
  async findNativeResult(
    runId: string,
    userId: string,
    toolCallId: string,
  ): Promise<RunEvent | undefined> {
    const [row] = await this.db
      .select()
      .from(runEvents)
      .innerJoin(runs, eq(runEvents.runId, runs.id))
      .where(
        and(
          eq(runEvents.runId, runId),
          eq(runs.userId, userId),
          eq(runEvents.eventType, 'native.result'),
          sql`${runEvents.payload}->>'toolCallId' = ${toolCallId}`,
        ),
      )
      .orderBy(desc(runEvents.sequence))
      .limit(1);

    return row?.run_events;
  }

  /** Whether one call has the native.attempt that authorizes recovery. */
  async hasNativeAttempt(
    runId: string,
    userId: string,
    toolCallId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .innerJoin(runs, eq(runEvents.runId, runs.id))
      .where(
        and(
          eq(runEvents.runId, runId),
          eq(runs.userId, userId),
          eq(runEvents.eventType, 'native.attempt'),
          sql`${runEvents.payload}->>'toolCallId' = ${toolCallId}`,
        ),
      )
      .limit(1);

    return row !== undefined;
  }
}
