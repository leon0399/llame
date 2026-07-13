/**
 * RunsRepository and RunEventsRepository (#48) — owner-scoped access to the
 * durable run pipeline's state (SPEC §9.3–§9.4).
 *
 * Same defense-in-depth contract as the other repositories: every query filters
 * by userId in addition to RLS (`runs_owner` / run_events SELECT+INSERT
 * policies). run_events is append-only — there are deliberately no
 * update/delete methods.
 */

import { and, asc, eq, gt, isNull, notInArray } from 'drizzle-orm';
import {
  chats,
  runEvents,
  runs,
  type Run,
  type RunEvent,
  type RunStatus,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';

export class RunsRepository {
  constructor(private readonly db: Db) {}

  /** Create a queued run for a user message. */
  async create(input: {
    chatId: string;
    messageId: string;
    userId: string;
    modelId: string;
  }): Promise<Run> {
    const [created] = await this.db
      .insert(runs)
      .values({
        chatId: input.chatId,
        messageId: input.messageId,
        userId: input.userId,
        modelId: input.modelId,
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

  /**
   * The caller's ACTIVE (non-terminal) runs across all their chats, with each
   * run's chat title — for re-hydrating completion notifications after a page
   * reload (the in-memory tracker is wiped on reload). Owner-scoped: the
   * `runs_owner` RLS on `user_id` + the explicit `userId` filter, and the chats
   * INNER JOIN is itself owner-scoped by `chats_owner`. Independent of chat
   * visibility — a public/shared chat's run belongs to its owner, never a viewer.
   */
  async findActiveByUser(userId: string): Promise<
    Array<{
      id: string;
      chatId: string;
      chatTitle: string | null;
      status: RunStatus;
      createdAt: Date;
    }>
  > {
    return this.db
      .select({
        id: runs.id,
        chatId: runs.chatId,
        chatTitle: chats.title,
        status: runs.status,
        createdAt: runs.createdAt,
      })
      .from(runs)
      .innerJoin(chats, eq(runs.chatId, chats.id))
      .where(
        and(
          eq(runs.userId, userId),
          notInArray(runs.status, [
            'completed',
            'failed',
            'cancelled',
            'expired',
          ]),
        ),
      )
      .orderBy(asc(runs.createdAt));
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
   * Transition a run into execution and stamp startedAt. Refuses terminal
   * runs (same immutability as markFinished): a run cancelled or superseded
   * while queued must never be resurrected into running_model.
   *
   * A run already at running_model IS reclaimable (durable-run-workers D7):
   * the job-queue's native worker-liveness only ever redelivers a run job
   * after its prior holder stopped signalling liveness (fetchNextJob never
   * re-selects an active job; only the heartbeat-timeout path returns one to
   * the claimable pool — see pg-boss's plans.js), so any delivery of a
   * non-terminal run is a legitimate crash-recovery claim, not a race with a
   * still-live holder. The guard here is simply "not terminal" — no
   * app-level stale-heartbeat CAS. The rare paused-but-not-dead double
   * delivery this admits (design D7 risk) is bounded by markFinished's
   * first-writer-wins guard: at most one terminal outcome ever survives.
   */
  async markStarted(
    runId: string,
    userId: string,
    options?: { workerId?: string },
  ): Promise<Run | undefined> {
    const workerId = options?.workerId;

    const [updated] = await this.db
      .update(runs)
      .set({
        status: 'running_model' satisfies RunStatus,
        startedAt: new Date(),
        ...(workerId !== undefined ? { workerId } : {}),
      })
      .where(
        and(
          eq(runs.id, runId),
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
 * that drained events — a status-only terminal writer (e.g. the runs.dead
 * retry-exhaustion consumer, durable-run-workers D7) MUST append its
 * terminal event (`run.expired`) in the
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
  | 'run.expired'
  | 'reasoning.delta'
  // Tool-calling loop (SPEC §9.4 tool.* vocabulary): requested (model called
  // an advertised tool, or a refused/hallucinated call was recorded) ->
  // started (input validated, execute() about to run — never fires for a
  // refusal) -> completed (result, success or error). A distinct run-level
  // event marks the step cap (D5: never shoehorned into tool.completed).
  | 'tool.requested'
  | 'tool.started'
  | 'tool.completed'
  | 'run.step_cap_reached';

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
