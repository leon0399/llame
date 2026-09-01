/**
 * RunsRepository and RunEventsRepository (#48) — owner-scoped access to the
 * durable run pipeline's state (SPEC §9.3–§9.4).
 *
 * Same defense-in-depth contract as the other repositories: every query filters
 * by userId in addition to RLS (`runs_owner` / run_events SELECT+INSERT
 * policies). run_events is append-only — there are deliberately no
 * update/delete methods.
 */

import { and, asc, desc, eq, gt, isNull, lt, notInArray } from 'drizzle-orm';
import {
  chats,
  messages,
  runEvents,
  runs,
  type Run,
  type RunContextItem,
  type RunEvent,
  type RunStatus,
} from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';

export class RunsRepository {
  constructor(private readonly db: Db) {}

  /** Create a queued run for a user message. */
  async create(input: {
    id?: string;
    chatId: string;
    messageId: string;
    userId: string;
    modelId: string;
    /** Resolved at accept time. Absent stores NULL: the run sends no effort. */
    effort?: string | undefined;
    modelContextSnapshotId: string;
  }): Promise<Run> {
    const values: typeof runs.$inferInsert = {
      chatId: input.chatId,
      messageId: input.messageId,
      userId: input.userId,
      modelId: input.modelId,
      modelContextSnapshotId: input.modelContextSnapshotId,
    };
    if (input.effort !== undefined) values.effort = input.effort;
    if (input.id !== undefined) values.id = input.id;

    const [created] = await this.db.insert(runs).values(values).returning();

    return created;
  }

  /**
   * Most recent durable model selection by triggering-message sequence,
   * optionally bounded to triggering messages strictly before `beforeSeq`
   * (transition compaction's source-run lookup). Status is intentionally
   * irrelevant: failed runs still establish the user's previous selection.
   * Created-at/id only break retry ties for one message; message seq remains
   * the primary conversation order.
   */
  async findMostRecentByChatMessageSequence(
    chatId: string,
    userId: string,
    options?: { beforeSeq?: number },
  ): Promise<Run | undefined> {
    const rows = await this.db
      .select({ runs })
      .from(runs)
      .innerJoin(
        messages,
        and(eq(runs.messageId, messages.id), eq(runs.chatId, messages.chatId)),
      )
      .where(
        and(
          eq(runs.chatId, chatId),
          eq(runs.userId, userId),
          ...(options?.beforeSeq !== undefined
            ? [lt(messages.seq, options.beforeSeq)]
            : []),
        ),
      )
      .orderBy(desc(messages.seq), desc(runs.createdAt), desc(runs.id))
      .limit(1);

    return rows[0]?.runs;
  }

  /** A chat's runs, oldest-first. Owner-scoped. */
  async findByChatId(chatId: string, userId: string): Promise<Array<Run>> {
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
   * Transition a run into execution and stamp startedAt. Refuses terminal or
   * cancel-requested runs: cancellation that wins the pickup/claim race must
   * never be resurrected into running_model.
   *
   * A run already at running_model IS reclaimable (durable-run-workers D7):
   * the job-queue's native worker-liveness only ever redelivers a run job
   * after its prior holder stopped signalling liveness (fetchNextJob never
   * re-selects an active job; only the heartbeat-timeout path returns one to
   * the claimable pool — see pg-boss's plans.js), so any delivery of a
   * non-terminal, non-cancel-requested run is a legitimate crash-recovery
   * claim, not a race with a still-live holder. There is no app-level
   * stale-heartbeat CAS. The rare paused-but-not-dead double delivery this
   * admits (design D7 risk) is bounded by markFinished's first-writer-wins
   * guard: at most one terminal outcome ever survives.
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
        ...(workerId !== undefined && { workerId }),
      })
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
   * Supersede prior attempts (#48 single-flight): cancel every non-terminal
   * run for a message, returning what was cancelled. A retry of a turn whose
   * previous attempt died silently frees the chat's single-flight slot in the
   * same transaction that creates the fresh run.
   */
  async cancelActiveRunsForMessage(
    messageId: string,
    userId: string,
  ): Promise<Array<Run>> {
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
  /**
   * Record what this run injected on the context rail, as rendered.
   *
   * Owner-scoped like every other write here, and idempotent: a retry rebuilds
   * the same items for a persisted-derived producer and overwrites with an
   * equal value. Never widens the run's status.
   *
   * Returns the updated row like every sibling mutator, because this column is
   * the authority for what a past run injected: an owner-scoped WHERE that
   * matched nothing would otherwise commit successfully while the authority
   * silently held no record — the exact failure the column exists to prevent.
   */
  async recordContextItems(
    runId: string,
    userId: string,
    items: Array<RunContextItem>,
  ): Promise<Run | undefined> {
    const [updated] = await this.db
      .update(runs)
      .set({ contextItems: items })
      .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
      .returning();
    return updated;
  }

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
        ...(error !== undefined && { error }),
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
 * INVARIANT: every terminal writer changes the run status in the same
 * transaction that appends the matching `run.<status>` event. Most paths use
 * `RunExecutionService.finishRun`; pre-execution worker/dispatch paths enforce
 * the same coupling directly. The SSE replay loop
 * (runs.controller.ts) relies on this to re-read the status only on passes
 * that drained events — every terminal writer, including the `runs.dead`
 * retry-exhaustion consumer (durable-run-workers D7), MUST append its matching
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
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- the run_events.payload JSONB column accepts a discriminated-union shape keyed by `eventType` (see RunEventType above); every caller (run-execution.service.ts's `enqueueEvent`) already constructs the correct literal shape before calling this -- the repository's job is the atomic INSERT, not re-validating what its caller already built.
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
  ): Promise<Array<RunEvent>> {
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

/**
 * Mark a run failed and append its `run.failed` event, in one tenant-scoped
 * transaction. Shared by every failure origin that must produce the same
 * outcome — enqueue failure (RunDispatchService) and in-flight worker failure
 * (RunsWorkerService) — so the run row and its event log can never disagree
 * about why a run ended.
 */
export async function failRunTransactionally(
  tenantDb: TenantRunner,
  job: { runId: string; userId: string },
  message: string,
): Promise<void> {
  await tenantDb.runAs(job.userId, async (tx) => {
    const failed = await new RunsRepository(tx).markFinished(
      job.runId,
      job.userId,
      'failed',
      { message },
    );
    if (failed) {
      await new RunEventsRepository(tx).append(job.runId, 'run.failed', {
        status: 'failed',
        message,
      });
    }
  });
}
