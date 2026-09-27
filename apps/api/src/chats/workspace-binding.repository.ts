import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { chats, runEvents, runs } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type WorkspaceDetachReason } from './workspace-binding';

type WorkspaceChatState = {
  workspaceRoot: string | null;
  workspaceExecutorId: string | null;
  workspaceGeneration: number;
};

/**
 * Owner-scoped Workspace binding state and its delivery fence.
 *
 * Callers construct this repository with the transaction supplied by
 * TenantDbService.runAs. Enter, exit, and detach deliberately keep the Run
 * lock, worker binding, and Chat mutation in that transaction so a caller
 * cannot observe or commit only part of a Workspace transition.
 */
export class WorkspaceBindingRepository {
  constructor(private readonly db: Db) {}

  async isCurrentDelivery(input: {
    runId: string;
    ownerUserId: string;
    deliverySequence: number | undefined;
  }): Promise<boolean> {
    if (input.deliverySequence === undefined) return false;
    const [run] = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.id, input.runId), eq(runs.userId, input.ownerUserId)))
      .limit(1);
    if (run === undefined) return false;
    return (
      (await this.latestStartedSequence(input.runId)) === input.deliverySequence
    );
  }

  async enter(input: {
    chatId: string;
    ownerUserId: string;
    runId: string;
    deliverySequence: number | undefined;
    executorId: string;
    root: string;
  }): Promise<
    | {
        status: 'bound' | 'switched' | 'unchanged';
        previousRoot: string | null;
        generation: number;
      }
    | { status: 'fence_lost' }
  > {
    if (
      !(await this.fenceRun(
        input.runId,
        input.ownerUserId,
        input.deliverySequence,
        input.executorId,
      ))
    ) {
      return { status: 'fence_lost' };
    }

    const current = await this.lockChat(input.chatId, input.ownerUserId);
    if (current === undefined) return { status: 'fence_lost' };

    const unchanged = this.unchangedEnter(current, input);
    if (unchanged !== undefined) return unchanged;

    const updated = await this.bindChat(input);
    if (updated === undefined) return { status: 'fence_lost' };
    return {
      status: current.workspaceRoot === null ? 'bound' : 'switched',
      previousRoot: current.workspaceRoot,
      generation: updated.workspaceGeneration,
    };
  }

  async exit(input: {
    chatId: string;
    ownerUserId: string;
    runId: string;
    deliverySequence: number;
    executorId: string;
  }): Promise<
    | { status: 'cleared'; previousRoot: string; generation: number }
    | { status: 'unbound' }
    | { status: 'fence_lost' }
  > {
    if (
      !(await this.fenceRun(
        input.runId,
        input.ownerUserId,
        input.deliverySequence,
        input.executorId,
      ))
    ) {
      return { status: 'fence_lost' };
    }

    const current = await this.lockChat(input.chatId, input.ownerUserId);
    if (current === undefined) return { status: 'fence_lost' };
    if (current.workspaceRoot === null) return { status: 'unbound' };

    const updated = await this.clearChat(input);
    if (updated === undefined) return { status: 'fence_lost' };
    return {
      status: 'cleared',
      previousRoot: current.workspaceRoot,
      generation: updated.workspaceGeneration,
    };
  }

  async detach(input: {
    chatId: string;
    ownerUserId: string;
    runId: string;
    deliverySequence: number;
    expectedGeneration: number;
    reason: WorkspaceDetachReason;
  }): Promise<'detached' | 'stale' | 'fence_lost'> {
    if (
      !(await this.fenceRun(
        input.runId,
        input.ownerUserId,
        input.deliverySequence,
      ))
    ) {
      return 'fence_lost';
    }

    const current = await this.lockChat(input.chatId, input.ownerUserId);
    if (current === undefined) return 'stale';
    if (
      current.workspaceRoot === null ||
      current.workspaceGeneration !== input.expectedGeneration
    ) {
      return 'stale';
    }

    const updated = await this.detachChat(input);
    return updated === 1 ? 'detached' : 'stale';
  }

  async setTold(input: {
    chatId: string;
    ownerUserId: string;
    told: string | null;
    toldFrom: string | null;
    clearDetachReason: boolean;
  }): Promise<void> {
    await this.db
      .update(chats)
      .set({
        workspaceTold: input.told,
        workspaceToldFrom: input.toldFrom,
        ...(input.clearDetachReason && { workspaceDetachReason: null }),
      })
      .where(
        and(
          eq(chats.id, input.chatId),
          eq(chats.ownerUserId, input.ownerUserId),
        ),
      );
  }

  private unchangedEnter(
    current: WorkspaceChatState,
    input: { root: string; executorId: string },
  ):
    | {
        status: 'unchanged';
        previousRoot: string | null;
        generation: number;
      }
    | undefined {
    if (
      current.workspaceRoot !== input.root ||
      current.workspaceExecutorId !== input.executorId
    ) {
      return undefined;
    }
    return {
      status: 'unchanged',
      previousRoot: current.workspaceRoot,
      generation: current.workspaceGeneration,
    };
  }
  private async lockChat(
    chatId: string,
    ownerUserId: string,
  ): Promise<WorkspaceChatState | undefined> {
    const [current] = await this.db
      .select({
        workspaceRoot: chats.workspaceRoot,
        workspaceExecutorId: chats.workspaceExecutorId,
        workspaceGeneration: chats.workspaceGeneration,
      })
      .from(chats)
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)))
      .for('update')
      .limit(1);
    return current;
  }

  private async bindChat(input: {
    chatId: string;
    ownerUserId: string;
    executorId: string;
    root: string;
  }): Promise<{ workspaceGeneration: number } | undefined> {
    const [updated] = await this.db
      .update(chats)
      .set({
        workspaceRoot: input.root,
        workspaceExecutorId: input.executorId,
        workspaceGeneration: sql<number>`${chats.workspaceGeneration} + 1`,
        workspaceDetachReason: null,
      })
      .where(
        and(
          eq(chats.id, input.chatId),
          eq(chats.ownerUserId, input.ownerUserId),
        ),
      )
      .returning({ workspaceGeneration: chats.workspaceGeneration });
    return updated;
  }

  private async clearChat(input: {
    chatId: string;
    ownerUserId: string;
  }): Promise<{ workspaceGeneration: number } | undefined> {
    const [updated] = await this.db
      .update(chats)
      .set({
        workspaceRoot: null,
        workspaceExecutorId: null,
        workspaceGeneration: sql<number>`${chats.workspaceGeneration} + 1`,
        workspaceDetachReason: null,
      })
      .where(
        and(
          eq(chats.id, input.chatId),
          eq(chats.ownerUserId, input.ownerUserId),
        ),
      )
      .returning({ workspaceGeneration: chats.workspaceGeneration });
    return updated;
  }

  private async detachChat(input: {
    chatId: string;
    ownerUserId: string;
    expectedGeneration: number;
    reason: WorkspaceDetachReason;
  }): Promise<number> {
    const updated = await this.db
      .update(chats)
      .set({
        workspaceRoot: null,
        workspaceExecutorId: null,
        workspaceGeneration: sql<number>`${chats.workspaceGeneration} + 1`,
        workspaceDetachReason: input.reason,
      })
      .where(
        and(
          eq(chats.id, input.chatId),
          eq(chats.ownerUserId, input.ownerUserId),
          eq(chats.workspaceGeneration, input.expectedGeneration),
          isNotNull(chats.workspaceRoot),
        ),
      )
      .returning({ id: chats.id });
    return updated.length;
  }

  private async fenceRun(
    runId: string,
    ownerUserId: string,
    deliverySequence: number | undefined,
    executorId?: string,
  ): Promise<boolean> {
    const runLocked = await this.lockRun(runId, ownerUserId);
    if (!runLocked || deliverySequence === undefined) return false;
    if ((await this.latestStartedSequence(runId)) !== deliverySequence)
      return false;
    return executorId === undefined
      ? true
      : this.bindRun(runId, ownerUserId, executorId);
  }

  private async lockRun(runId: string, ownerUserId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.userId, ownerUserId)))
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

  private async bindRun(
    runId: string,
    ownerUserId: string,
    executorId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .update(runs)
      .set({ workerId: executorId })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.userId, ownerUserId),
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
}
