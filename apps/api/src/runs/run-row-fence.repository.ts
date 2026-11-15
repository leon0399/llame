import { and, eq, isNull } from 'drizzle-orm';

import { runs, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { nonTerminalRun } from './run-status';

/** Owner-scoped row locks shared by delivery, host promotion, and recovery. */
export class RunRowFenceRepository {
  constructor(private readonly db: Db) {}

  /** The Run-first fence for steering delivery, followed by the Chat lock. */
  async lockForDelivery(
    runId: string,
    userId: string,
    attemptId: string,
  ): Promise<Run | undefined> {
    const [locked] = await this.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.userId, userId),
          eq(runs.activeAttemptId, attemptId),
          nonTerminalRun(),
        ),
      )
      .for('update');

    return locked;
  }

  /**
   * Lock an active, uncancelled Run before publishing a host job. Callers take
   * the Chat lock first and retain this fence through the receipt commit.
   */
  async lockHostPromotion(
    runId: string,
    userId: string,
    attemptId: string,
  ): Promise<Run | undefined> {
    const [locked] = await this.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.userId, userId),
          eq(runs.activeAttemptId, attemptId),
          isNull(runs.cancelRequestedAt),
          nonTerminalRun(),
        ),
      )
      .for('update')
      .limit(1);

    return locked;
  }

  /**
   * Lock the owner's current nonterminal Run for recovery. A cancel request
   * fences new promotion but must not prevent the receipt from being settled.
   */
  async lockHostPromotionRecovery(
    runId: string,
    userId: string,
    attemptId: string,
  ): Promise<Run | undefined> {
    const [locked] = await this.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.userId, userId),
          eq(runs.activeAttemptId, attemptId),
          nonTerminalRun(),
        ),
      )
      .for('update')
      .limit(1);

    return locked;
  }
}
