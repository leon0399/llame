/**
 * RunsRepository and RunEventsRepository (#48) — owner-scoped access to the
 * durable run pipeline's state (SPEC §9.3–§9.4).
 *
 * Same defense-in-depth contract as the other repositories: every query filters
 * by userId in addition to RLS (`runs_owner` / run_events SELECT+INSERT
 * policies). run_events is append-only — there are deliberately no
 * update/delete methods.
 */

import { and, asc, eq, gt, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import {
  runEvents,
  runs,
  type Run,
  type RunEvent,
  type RunStatus,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';

export class RunsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Create a queued run for a user message, persisting its effective-config
   * snapshot (#46, SPEC §6.4).
   */
  async create(input: {
    chatId: string;
    messageId: string;
    userId: string;
    configSnapshot?: unknown;
  }): Promise<Run> {
    const [created] = await this.db
      .insert(runs)
      .values({
        chatId: input.chatId,
        messageId: input.messageId,
        userId: input.userId,
        ...(input.configSnapshot !== undefined
          ? { configSnapshot: input.configSnapshot }
          : {}),
      })
      .returning();

    return created;
  }

  /** A chat's runs, oldest-first. Owner-scoped. */
  async findByChatId(chatId: string, userId: string): Promise<Run[]> {
    return this.db
      .select()
      .from(runs)
      .where(and(eq(runs.chatId, chatId), eq(runs.userId, userId)))
      .orderBy(asc(runs.createdAt));
  }

  /**
   * The chat's active (non-terminal) run, if any — well-defined because the
   * per-chat single-flight index admits at most one. Owner-scoped.
   */
  async findActiveByChatId(
    chatId: string,
    userId: string,
  ): Promise<Run | undefined> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.chatId, chatId),
          eq(runs.userId, userId),
          notInArray(runs.status, [
            'completed',
            'failed',
            'cancelled',
            'expired',
          ]),
        ),
      )
      .limit(1);

    return rows[0];
  }

  /** Find one run, owner-scoped. */
  async findById(runId: string, userId: string): Promise<Run | undefined> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
      .limit(1);

    return rows[0];
  }

  /**
   * Transition a run into execution and stamp startedAt + first heartbeat.
   * Refuses terminal runs (same immutability as markFinished): a run cancelled
   * or superseded while queued must never be resurrected into running_model.
   *
   * Also refuses a run that is ALREADY running_model — unless the caller opts
   * into crash recovery via reclaimStaleMs AND the run's last sign of life is
   * older than that window. The check-and-claim is one UPDATE (with the claim
   * stamping a fresh heartbeat), so two consumers racing to reclaim the same
   * stale run can never both win — the loser's WHERE no longer matches. This
   * is what prevents a duplicate concurrent model call for one run when a
   * heartbeat write merely lagged (#48 review).
   */
  async markStarted(
    runId: string,
    userId: string,
    options?: { workerId?: string; reclaimStaleMs?: number },
  ): Promise<Run | undefined> {
    const workerId = options?.workerId;
    const notLiveRunning =
      options?.reclaimStaleMs !== undefined
        ? or(
            ne(runs.status, 'running_model'),
            sql`COALESCE(${runs.heartbeatAt}, ${runs.startedAt}, ${runs.createdAt}) < now() - make_interval(secs => ${options.reclaimStaleMs / 1000})`,
          )
        : ne(runs.status, 'running_model');

    const [updated] = await this.db
      .update(runs)
      .set({
        status: 'running_model' satisfies RunStatus,
        startedAt: new Date(),
        heartbeatAt: new Date(),
        ...(workerId !== undefined ? { workerId } : {}),
      })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.userId, userId),
          notLiveRunning,
          notInArray(runs.status, [
            'completed',
            'failed',
            'cancelled',
            'expired',
          ]),
        ),
      )
      .returning();

    return updated;
  }

  /**
   * Supersede prior attempts (#48 single-flight): cancel every non-terminal
   * run for a message, returning what was cancelled. A retry of a turn whose
   * previous attempt died silently frees the chat's single-flight slot in the
   * same transaction that creates the fresh run.
   */
  async cancelActiveRunsForMessage(
    messageId: string,
    userId: string,
  ): Promise<Run[]> {
    return this.db
      .update(runs)
      .set({ status: 'cancelled' satisfies RunStatus, finishedAt: new Date() })
      .where(
        and(
          eq(runs.messageId, messageId),
          eq(runs.userId, userId),
          notInArray(runs.status, [
            'completed',
            'failed',
            'cancelled',
            'expired',
          ]),
        ),
      )
      .returning();
  }

  /** Liveness stamp (#48) — the executing worker calls this on an interval. */
  async touchHeartbeat(runId: string, userId: string): Promise<void> {
    await this.db
      .update(runs)
      .set({ heartbeatAt: new Date() })
      .where(and(eq(runs.id, runId), eq(runs.userId, userId)));
  }

  /**
   * Request cancellation (#48): stamps cancel_requested_at atomically, only on
   * a run that is not already terminal and not already cancel-requested.
   * Returns the updated run, or undefined when the guard (or scope) missed —
   * the caller disambiguates terminal vs. missing with a follow-up read.
   */
  async requestCancel(runId: string, userId: string): Promise<Run | undefined> {
    const [updated] = await this.db
      .update(runs)
      .set({ cancelRequestedAt: new Date() })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.userId, userId),
          isNull(runs.cancelRequestedAt),
          notInArray(runs.status, [
            'completed',
            'failed',
            'cancelled',
            'expired',
          ]),
        ),
      )
      .returning();

    return updated;
  }

  /**
   * Transition a run to a terminal status and stamp finishedAt. Terminal
   * states are immutable: the WHERE excludes already-finished runs, so a late
   * stream callback cannot overwrite expired/cancelled (first writer wins).
   * Returns undefined when the run was already terminal (or not owned).
   */
  async markFinished(
    runId: string,
    userId: string,
    status: Extract<
      RunStatus,
      'completed' | 'failed' | 'cancelled' | 'expired'
    >,
    error?: unknown,
  ): Promise<Run | undefined> {
    const [updated] = await this.db
      .update(runs)
      .set({
        status,
        finishedAt: new Date(),
        ...(error !== undefined ? { error } : {}),
      })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.userId, userId),
          isNull(runs.finishedAt),
          notInArray(runs.status, [
            'completed',
            'failed',
            'cancelled',
            'expired',
          ]),
        ),
      )
      .returning();

    return updated;
  }
}

/**
 * The run lifecycle vocabulary (SPEC §9.4). Typed so a misspelled event can't
 * silently enter the authoritative append-only log.
 *
 * INVARIANT: a run's status only becomes terminal in the same transaction
 * that appends the matching `run.<status>` event (see finalizeRun in
 * chat-loop.service.ts, the sole terminal writer). The SSE replay loop
 * (runs.controller.ts) relies on this to re-read the status only on passes
 * that drained events — a future status-only terminal writer (e.g. the
 * deadman expiry sweep) MUST append its terminal event (`run.expired`) in the
 * same transaction, or that loop idles until its connection cap.
 */
export type RunEventType =
  | 'run.created'
  | 'run.started'
  | 'model.requested'
  | 'model.delta'
  | 'model.completed'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'run.expired';

export class RunEventsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Append one event. Write ownership is enforced by RLS (the INSERT policy's
   * WITH CHECK: the run must belong to the current tenant); no read-back
   * pre-check — the insert is atomic.
   */
  async append(
    runId: string,
    eventType: RunEventType,
    payload?: unknown,
  ): Promise<RunEvent> {
    const [created] = await this.db
      .insert(runEvents)
      .values({ runId, eventType, payload })
      .returning();

    return created;
  }

  /**
   * Cursor read for replay (SPEC §9.4): events for a run, sequence-ascending,
   * strictly after `afterSequence` when given. Owner-scoped via join to runs.
   */
  async listByRunId(
    runId: string,
    userId: string,
    options?: { afterSequence?: number },
  ): Promise<RunEvent[]> {
    const predicates = [eq(runEvents.runId, runId), eq(runs.userId, userId)];

    if (options?.afterSequence !== undefined) {
      predicates.push(gt(runEvents.sequence, options.afterSequence));
    }

    const rows = await this.db
      .select()
      .from(runEvents)
      .innerJoin(runs, eq(runEvents.runId, runs.id))
      .where(and(...predicates))
      .orderBy(asc(runEvents.sequence));

    return rows.map((r) => r.run_events);
  }
}
