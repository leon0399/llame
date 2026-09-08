import { RunEventsRepository } from './runs-repository';
import { and, desc, eq, isNull, notInArray, or, sql } from 'drizzle-orm';
import { isRecord, isString, type ToolResult } from '@workspace/runtime-safety';
import { runEvents, runs } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

/** Absolute paths bind the Run to one host; a resolved locator binds nothing. */
export type NativeFenceMode =
  | { readonly bound: true; readonly executorId: string }
  | { readonly bound: false };

/** Uses the existing owner-scoped Run row and append-only event log. */
export class NativeFilesRepository {
  constructor(private readonly db: Db) {}

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
    toolCallId: string;
    operation: 'read' | 'edit' | 'write';
    path: string;
  }): Promise<ToolResult | undefined> {
    if (!(await this.lockRun(input.runId, input.userId)))
      return executorUnavailable();
    if (
      input.deliverySequence === undefined ||
      (await this.latestStartedSequence(input.runId)) !== input.deliverySequence
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

  private async lockRun(runId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
      .for('update')
      .limit(1);
    return rows.length === 1;
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
          notInArray(runs.status, [
            'completed',
            'failed',
            'cancelled',
            'expired',
          ]),
          or(isNull(runs.workerId), eq(runs.workerId, executorId)),
        ),
      )
      .returning({ id: runs.id });
    return rows.length === 1;
  }

  async hasMutation(runId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: runEvents.sequence })
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, runId),
          eq(runEvents.eventType, 'native.attempt'),
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
      if (isRecord(result) && result.status === 'success')
        return { ...result, status: 'success' };
      if (
        isRecord(result) &&
        result.status === 'error' &&
        isString(result.type) &&
        isString(result.message)
      ) {
        return { status: 'error', type: result.type, message: result.message };
      }
    }
    return {
      status: 'error',
      type: 'outcome_unknown',
      message:
        'A previous native mutation may have executed; it will not be repeated.',
    };
  }
}

function executorUnavailable(): ToolResult {
  return {
    status: 'error',
    type: 'executor_unavailable',
    message: 'This Run cannot use this native executor.',
  };
}
