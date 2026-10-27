/**
 * RunsRepository and RunEventsRepository (#48) — owner-scoped access to the
 * durable run pipeline's state (SPEC §9.3–§9.4).
 *
 * Same defense-in-depth contract as the other repositories: every query filters
 * by userId in addition to RLS (`runs_owner` / run_events SELECT+INSERT
 * policies). run_events is append-only — there are deliberately no
 * update/delete methods.
 */
import { randomUUID } from 'node:crypto';

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  chats,
  messages,
  runEvents,
  runs,
  type FollowUpAction,
  type Run,
  type RunEvent,
  type RunStatus,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { nonTerminalRun, type TerminalRunStatus } from './run-status';
import type { PermissionMode } from '../tools/permissions/permission-mode';

/** A completed run paired with the sequence of its triggering user message. */
export type CompletedRunWithTrigger = {
  readonly run: Run;
  readonly triggeringUserSeq: number;
};

type MarkFinishedOptions = {
  error?: unknown;
  attemptId?: string;
};

type MarkFinishedUpdate = {
  status: TerminalRunStatus;
  finishedAt: Date;
  error?: unknown;
  completedAttemptId?: string;
};

function markFinishedUpdate(
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

/** A Run whose dispatch transaction ran: it wrote its availability record. */
function dispatchedRunPredicate(): SQL {
  return sql`(${isNotNull(runs.turnToolAvailability)} or ${eq(runs.status, 'completed')})`;
}

/**
 * Keep first-writer-wins and attempt fencing in one owner-scoped predicate.
 */
function markFinishedPredicate(
  runId: string,
  userId: string,
  attemptId: string | undefined,
) {
  return and(
    eq(runs.id, runId),
    eq(runs.userId, userId),
    isNull(runs.finishedAt),
    nonTerminalRun(),
    ...(attemptId === undefined ? [] : [eq(runs.activeAttemptId, attemptId)]),
  );
}

export class RunsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Create a queued run for a user message. The worker resolves
   * prompt/catalog context at execution time, so no snapshot is required.
   */
  async create(input: {
    id?: string;
    chatId: string;
    messageId: string;
    userId: string;
    modelId: string;
    /** Resolved at accept time. Absent stores NULL: the run sends no effort. */
    effort?: string | undefined;
    /** Accepted at message time; absent lets the database default to `default`. */
    permissionMode?: PermissionMode | undefined;
    /** The follow-up action that started this Run; absent for a chat send. */
    followUpAction?: FollowUpAction | undefined;
    /** The earlier Run this follow-up Run acts on; absent for a chat send. */
    sourceRunId?: string | undefined;
  }): Promise<Run> {
    const values: typeof runs.$inferInsert = {
      chatId: input.chatId,
      messageId: input.messageId,
      userId: input.userId,
      modelId: input.modelId,
    };
    if (input.effort !== undefined) values.effort = input.effort;
    if (input.permissionMode !== undefined) {
      values.permissionMode = input.permissionMode;
    }
    if (input.followUpAction !== undefined) {
      values.followUpAction = input.followUpAction;
    }
    if (input.sourceRunId !== undefined) {
      values.sourceRunId = input.sourceRunId;
    }
    if (input.id !== undefined) values.id = input.id;

    const [created] = await this.db.insert(runs).values(values).returning();

    return created;
  }

  /**
   * Most recent run by triggering-message sequence, optionally bounded to
   * triggering messages strictly before `beforeSeq` and narrowed by extra
   * predicates. Created-at/id only break retry ties for one message; message
   * seq remains the primary conversation order.
   */
  async findMostRecentByMessageSequence(
    chatId: string,
    userId: string,
    options?: { beforeSeq?: number },
    ...extra: Array<SQL>
  ): Promise<CompletedRunWithTrigger | undefined> {
    const rows = await this.db
      .select({ runs, triggeringSeq: messages.seq })
      .from(runs)
      .innerJoin(
        messages,
        and(eq(runs.messageId, messages.id), eq(runs.chatId, messages.chatId)),
      )
      .where(
        and(
          eq(runs.chatId, chatId),
          eq(runs.userId, userId),
          ...extra,
          ...(options?.beforeSeq !== undefined
            ? [lt(messages.seq, options.beforeSeq)]
            : []),
        ),
      )
      .orderBy(desc(messages.seq), desc(runs.createdAt), desc(runs.id))
      .limit(1);

    const row = rows[0];
    return row === undefined
      ? undefined
      : { run: row.runs, triggeringUserSeq: row.triggeringSeq };
  }

  /**
   * Most recent successfully completed run by triggering-message sequence, with
   * the sequence of the turn it answered. Unlike the general model-selection
   * lookup, this excludes failed runs and requires the winning attempt link
   * needed to read its system receipt. Callers key epochs and measured sizes on
   * `triggeringUserSeq` rather than on the reply's own row: a retried assistant
   * row is rewritten in place and keeps its sequence.
   */
  async findMostRecentCompletedByChatMessageSequence(
    chatId: string,
    userId: string,
    options?: { beforeSeq?: number },
  ): Promise<CompletedRunWithTrigger | undefined> {
    return this.findMostRecentByMessageSequence(
      chatId,
      userId,
      options,
      eq(runs.status, 'completed'),
      isNotNull(runs.completedAttemptId),
    );
  }

  /**
   * The completed Run that produced the newest reply before `beforeSeq`: the
   * Run that reply's usage names, or the most recent completed turn when the
   * usage names none. A reply a later Run replaced still names the Run that
   * produced the answer the model read, which is the source compaction's model
   * and receipt come from (model-system-prompts).
   */
  async findCompletedReplyRunBefore(
    chatId: string,
    userId: string,
    options: { beforeSeq: number },
  ): Promise<CompletedRunWithTrigger | undefined> {
    const namedRunId = await this.findLatestReplyRunIdBefore(
      chatId,
      userId,
      options.beforeSeq,
    );
    if (namedRunId !== undefined) {
      const named = await this.findById(namedRunId, userId);
      // The same link the sequence lookup requires: a completed Run records the
      // attempt that produced its answer, and only that Run's receipt describes
      // the context the model read.
      if (named?.status === 'completed' && named.completedAttemptId !== null) {
        const trigger = await this.findTriggerSeq(chatId, named.messageId);
        if (trigger !== undefined) {
          return { run: named, triggeringUserSeq: trigger };
        }
      }
    }
    return this.findMostRecentCompletedByChatMessageSequence(
      chatId,
      userId,
      options,
    );
  }

  /** The Run named by the newest reply's usage before `beforeSeq`. */
  private async findLatestReplyRunIdBefore(
    chatId: string,
    userId: string,
    beforeSeq: number,
  ): Promise<string | undefined> {
    const runId = sql<string>`(${messages.usage} ->> 'runId')`;
    const [row] = await this.db
      .select({ runId })
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(chats.ownerUserId, userId),
          eq(messages.role, 'assistant'),
          lt(messages.seq, beforeSeq),
          isNotNull(runId),
        ),
      )
      .orderBy(desc(messages.seq))
      .limit(1);
    return row?.runId;
  }

  /** The sequence of the triggering user message a reply answers. */
  private async findTriggerSeq(
    chatId: string,
    messageId: string | null,
  ): Promise<number | undefined> {
    if (messageId === null) return undefined;
    const [row] = await this.db
      .select({ seq: messages.seq })
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.chatId, chatId),
          eq(messages.role, 'user'),
        ),
      )
      .limit(1);
    return row?.seq;
  }

  /**
   * Most recent dispatched run by triggering-message sequence: one whose
   * dispatch transaction wrote its availability record (`[]` included), or one
   * that completed, which covers runs older than the record. A run that ended
   * before any request carries a null record and is never a baseline.
   */
  async findMostRecentDispatchedByChatMessageSequence(
    chatId: string,
    userId: string,
    options: { beforeSeq: number },
  ): Promise<CompletedRunWithTrigger | undefined> {
    return this.findMostRecentByMessageSequence(
      chatId,
      userId,
      options,
      dispatchedRunPredicate(),
    );
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
   * The most recent dispatched Run of one triggering message itself, or the
   * most recent dispatched turn before it when the message's Runs never
   * dispatched (turn-actions D8). A follow-up Run compares tool availability
   * with the earlier Run of its own message, which a sequence-bounded lookup
   * can never reach.
   */
  async findDispatchedBaselineForTurn(
    chatId: string,
    userId: string,
    turn: { messageId: string; beforeSeq: number },
  ): Promise<CompletedRunWithTrigger | undefined> {
    return (
      (await this.findMostRecentByMessageSequence(
        chatId,
        userId,
        undefined,
        dispatchedRunPredicate(),
        eq(runs.messageId, turn.messageId),
      )) ??
      (await this.findMostRecentDispatchedByChatMessageSequence(
        chatId,
        userId,
        { beforeSeq: turn.beforeSeq },
      ))
    );
  }

  /**
   * The Chat's newest Run — the Run the history read reports and the one the
   * follow-up actions judge (turn-actions D12). Owner-scoped; `createdAt` and
   * `id` break ties between Runs created in one transaction. Returns
   * undefined for a Chat with no Run.
   */
  async findLatestByChatId(
    chatId: string,
    userId: string,
  ): Promise<Run | undefined> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.chatId, chatId), eq(runs.userId, userId)))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(1);

    return rows[0];
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
        and(eq(runs.chatId, chatId), eq(runs.userId, userId), nonTerminalRun()),
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
      .where(and(eq(runs.userId, userId), nonTerminalRun()))
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
    const attemptId = randomUUID();

    const [updated] = await this.db
      .update(runs)
      .set({
        status: 'running_model' satisfies RunStatus,
        startedAt: new Date(),
        activeAttemptId: attemptId,
        ...(workerId !== undefined && { workerId }),
      })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.userId, userId),
          isNull(runs.cancelRequestedAt),
          nonTerminalRun(),
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
          nonTerminalRun(),
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
          nonTerminalRun(),
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
    status: TerminalRunStatus,
    options?: MarkFinishedOptions,
  ): Promise<Run | undefined> {
    const [updated] = await this.db
      .update(runs)
      .set(markFinishedUpdate(status, options))
      .where(markFinishedPredicate(runId, userId, options?.attemptId))
      .returning();
    return updated;
  }

  /**
   * Conditionally update a non-terminal run only when the caller's attempt
   * is still the active one. Returns the updated row, or undefined when the
   * run was reclaimed, terminal, or not owned.
   */
  async updateForAttempt(
    runId: string,
    userId: string,
    attemptId: string,
    set: Partial<typeof runs.$inferInsert>,
  ): Promise<Run | undefined> {
    const [updated] = await this.db
      .update(runs)
      .set(set)
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.userId, userId),
          eq(runs.activeAttemptId, attemptId),
          nonTerminalRun(),
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
  // The kept parts of a Continue Run: appended by admission right after
  // `run.created`, so every attempt starts from the same completed steps.
  | 'run.continued'
  | 'reasoning.delta'
  // Tool-calling loop (SPEC §9.4 tool.* vocabulary): requested (model called
  // an advertised tool, or a refused/hallucinated call was recorded) ->
  // started (input validated, execute() about to run — never fires for a
  // refusal) -> completed (result, success or error). A distinct run-level
  // event marks the step cap (D5: never shoehorned into tool.completed).
  | 'tool.requested'
  | 'tool.started'
  | 'tool.completed'
  | 'native.attempt'
  | 'native.result'
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
   * The first event of `eventType` this Run holds, or undefined. Owner-scoped
   * like every read here; used for the single `run.created` and
   * `run.continued` events a Run has.
   */
  async findFirstByType(
    runId: string,
    userId: string,
    eventType: RunEventType,
  ): Promise<RunEvent | undefined> {
    const [row] = await this.db
      .select()
      .from(runEvents)
      .innerJoin(runs, eq(runEvents.runId, runs.id))
      .where(
        and(
          eq(runEvents.runId, runId),
          eq(runs.userId, userId),
          eq(runEvents.eventType, eventType),
        ),
      )
      .orderBy(asc(runEvents.sequence))
      .limit(1);
    return row?.run_events;
  }

  /**
   * Cursor read for replay (SPEC §9.4): events for a run, sequence-ascending,
   * strictly after `afterSequence` when given. Owner-scoped via join to runs.
   */
  async listByRunId(
    runId: string,
    userId: string,
    options?: {
      afterSequence?: number;
      eventTypes?: ReadonlyArray<RunEventType>;
    },
  ): Promise<Array<RunEvent>> {
    const predicates = [eq(runEvents.runId, runId), eq(runs.userId, userId)];

    if (options?.afterSequence !== undefined) {
      predicates.push(gt(runEvents.sequence, options.afterSequence));
    }
    if (options?.eventTypes !== undefined) {
      predicates.push(inArray(runEvents.eventType, [...options.eventTypes]));
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
