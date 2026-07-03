/**
 * RunsRepository and RunEventsRepository (#48) — owner-scoped access to the
 * durable run pipeline's state (SPEC §9.3–§9.4).
 *
 * Same defense-in-depth contract as the other repositories: every query filters
 * by userId in addition to RLS (`runs_owner` / run_events SELECT+INSERT
 * policies). run_events is append-only — there are deliberately no
 * update/delete methods.
 */

import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import {
  runEvents,
  runs,
  type Run,
  type RunEvent,
  type RunStatus,
} from '../db/schema';
import { type Db } from '../chats/chats-repository';

export class RunsRepository {
  constructor(private readonly db: Db) {}

  /** Create a queued run for a user message. */
  async create(input: {
    chatId: string;
    messageId: string;
    userId: string;
  }): Promise<Run> {
    const [created] = await this.db
      .insert(runs)
      .values({
        chatId: input.chatId,
        messageId: input.messageId,
        userId: input.userId,
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

  /** Find one run, owner-scoped. */
  async findById(runId: string, userId: string): Promise<Run | undefined> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
      .limit(1);

    return rows[0];
  }

  /** Transition a run into execution and stamp startedAt. */
  async markStarted(
    runId: string,
    userId: string,
    workerId?: string,
  ): Promise<Run | undefined> {
    const [updated] = await this.db
      .update(runs)
      .set({
        status: 'running_model' satisfies RunStatus,
        startedAt: new Date(),
        ...(workerId !== undefined ? { workerId } : {}),
      })
      .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
      .returning();

    return updated;
  }

  /** Transition a run to a terminal status and stamp finishedAt. */
  async markFinished(
    runId: string,
    userId: string,
    status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>,
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
