import { RunEventsRepository } from './runs-repository';
import { and, desc, eq, gt, isNull, max, or, sql } from 'drizzle-orm';
import {
  isRecord,
  isString,
  type ToolResult,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { runEvents, runs } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { nonTerminalRun } from './run-status';
import { isArtifactLocator } from '../tools/artifacts/locator';

/** Absolute paths bind the Run to one host; a resolved locator binds nothing. */
export type NativeFenceMode =
  | { readonly bound: true; readonly executorId: string }
  | { readonly bound: false };

/** Uses the existing owner-scoped Run row and append-only event log. */
export class NativeFilesRepository {
  constructor(private readonly db: Db) {}

  /**
   * Whether this delivery of the Run is the current one, under the Run row
   * lock. A caller that names its `attemptId` also needs it to be the Run's
   * active attempt: a delivery moves the Run to a new attempt, so a call of the
   * segment it closed cannot record anything after `run.delivered`.
   */
  async isCurrentDelivery(input: {
    runId: string;
    userId: string;
    deliverySequence: number | undefined;
    attemptId?: string;
  }): Promise<boolean> {
    if (input.deliverySequence === undefined) return false;
    const locked = await this.lockRun(input.runId, input.userId);
    if (locked === undefined) return false;
    if (
      input.attemptId !== undefined &&
      locked.activeAttemptId !== input.attemptId
    ) {
      return false;
    }
    return (
      (await this.latestStartedSequence(input.runId)) === input.deliverySequence
    );
  }

  /**
   * Binding pins the Run to one host filesystem, which an absolute path needs
   * and a `kb://` locator does not: every runs worker resolves every owner's
   * Space, so binding one would turn a queue retry elsewhere into
   * `executor_unavailable` for a target that worker can reach. The caller
   * states which it means — an omitted executor would otherwise silently
   * unbind a path that required it.
   */
  async begin(input: {
    runId: string;
    userId: string;
    fence: NativeFenceMode;
    deliverySequence: number | undefined;
    attemptId?: string;
    toolCallId: string;
    operation: 'read' | 'edit' | 'write' | 'bash' | 'mcp' | 'worktree';
    path: string;
  }): Promise<ToolResult | undefined> {
    if (
      !(await this.isCurrentDelivery({
        runId: input.runId,
        userId: input.userId,
        deliverySequence: input.deliverySequence,
        attemptId: input.attemptId,
      }))
    )
      return executorUnavailable();
    if (
      input.fence.bound &&
      !(await this.bind(input.runId, input.userId, input.fence.executorId))
    )
      return executorUnavailable();
    if (input.operation === 'read') return undefined;
    const outcome = await this.priorOutcome(input.runId, input.toolCallId);
    if (outcome) return outcome;
    await new RunEventsRepository(this.db).append(
      input.runId,
      'native.attempt',
      {
        toolCallId: input.toolCallId,
        operation: input.operation,
        path: input.path,
      },
    );
    return undefined;
  }

  private async lockRun(
    runId: string,
    userId: string,
  ): Promise<{ activeAttemptId: string | null } | undefined> {
    const [row] = await this.db
      .select({ activeAttemptId: runs.activeAttemptId })
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
      .for('update')
      .limit(1);
    return row;
  }

  private async latestStartedSequence(
    runId: string,
  ): Promise<number | undefined> {
    const [latestStarted] = await this.db
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(
        and(eq(runEvents.runId, runId), eq(runEvents.eventType, 'run.started')),
      )
      .orderBy(desc(runEvents.sequence))
      .limit(1);
    return latestStarted?.sequence;
  }

  async bind(
    runId: string,
    userId: string,
    executorId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .update(runs)
      .set({ workerId: executorId })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.userId, userId),
          isNull(runs.cancelRequestedAt),
          nonTerminalRun(),
          or(isNull(runs.workerId), eq(runs.workerId, executorId)),
        ),
      )
      .returning({ id: runs.id });
    return rows.length === 1;
  }

  /**
   * Whether the Run's current segment attempted a mutation: only the events
   * after the latest `run.delivered` count, so a settled write of an earlier
   * segment does not stop a retry (run-steering D4).
   */
  async hasMutation(runId: string): Promise<boolean> {
    const latestDelivered = this.db
      .select({ sequence: max(runEvents.sequence) })
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, runId),
          eq(runEvents.eventType, 'run.delivered'),
        ),
      );
    const rows = await this.db
      .select({ id: runEvents.sequence })
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, runId),
          eq(runEvents.eventType, 'native.attempt'),
          gt(runEvents.sequence, sql`coalesce((${latestDelivered}), 0)`),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async priorOutcome(
    runId: string,
    toolCallId: string,
  ): Promise<ToolResult | undefined> {
    const [event] = await this.db
      .select({ eventType: runEvents.eventType, payload: runEvents.payload })
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, runId),
          sql`${runEvents.payload}->>'toolCallId' = ${toolCallId}`,
          or(
            eq(runEvents.eventType, 'native.attempt'),
            eq(runEvents.eventType, 'native.result'),
          ),
        ),
      )
      .orderBy(desc(runEvents.sequence))
      .limit(1);
    if (!event) return undefined;
    if (event.eventType === 'native.result' && isRecord(event.payload)) {
      const result = event.payload.result;
      const recorded = isRecord(result) ? recordedResult(result) : undefined;
      if (recorded !== undefined) return recorded;
    }
    return {
      status: 'error',
      type: 'outcome_unknown',
      message:
        'A previous host command, mutation, or MCP operation may have executed; it will not be repeated.',
    };
  }
}

/**
 * A recorded `native.result`: the success record as stored, or the error it
 * described. A settled open call keeps the artifact locator the earlier attempt
 * stored, so the replay still names it (D4).
 */
function recordedResult(result: UnknownRecord): ToolResult | undefined {
  if (result.status === 'success') {
    const { artifact, ...rest } = result;
    return {
      ...rest,
      status: 'success',
      ...(isArtifactLocator(artifact) && { artifact }),
    };
  }
  if (result.status !== 'error') return undefined;
  if (!isString(result.type) || !isString(result.message)) return undefined;
  const artifact = result.artifact;
  return {
    status: 'error',
    type: result.type,
    message: result.message,
    ...(isArtifactLocator(artifact) && { artifact }),
  };
}

function executorUnavailable(): ToolResult {
  return {
    status: 'error',
    type: 'executor_unavailable',
    message: 'This Run cannot use this native executor.',
  };
}
