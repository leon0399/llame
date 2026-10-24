import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { chats, checkouts, messages, runs, worktreeLeases } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { isMachineExecutorId } from '../machines/machine-locator';
import { NativeFilesRepository } from '../runs/native-files-repository';
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
    return new NativeFilesRepository(this.db).isCurrentDelivery({
      runId: input.runId,
      userId: input.ownerUserId,
      deliverySequence: input.deliverySequence,
    });
  }

  async enter(input: {
    chatId: string;
    ownerUserId: string;
    runId: string;
    deliverySequence: number | undefined;
    executorId: string;
    root: string;
    /**
     * The executor this transition pins the Run to, if any. An absolute host
     * path passes the local executor id, so the Run cannot later execute on
     * another host. A `machine:<name>` binding passes nothing: the Run stays
     * free to use `file:` aliases and other Machines, and no local executor is
     * required to enter a Machine Workspace at all.
     */
    bindExecutorId?: string;
  }): Promise<
    | {
        status: 'bound' | 'switched' | 'unchanged';
        previousRoot: string | null;
        generation: number;
      }
    | { status: 'fence_lost' }
  > {
    if (!(await this.fenceRun(input))) return { status: 'fence_lost' };
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
    /** The executor this exit pins the Run to, if any; a Machine binding passes none. */
    bindExecutorId?: string;
  }): Promise<
    | { status: 'cleared'; previousRoot: string; generation: number }
    | { status: 'unbound' }
    | { status: 'fence_lost' }
  > {
    if (!(await this.fenceRun(input))) return { status: 'fence_lost' };

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
    if (!(await this.fenceRun(input))) return 'fence_lost';

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
    /**
     * The Machine availability narrated with this write: only a Notice that
     * told the model and owner which way the bound Machine's availability went
     * passes one, so an ordinary snapshot leaves the recorded state alone.
     */
    available?: boolean | null;
  }): Promise<void> {
    await this.db
      .update(chats)
      .set({
        workspaceTold: input.told,
        workspaceToldFrom: input.toldFrom,
        ...(input.clearDetachReason && { workspaceDetachReason: null }),
        ...(input.available !== undefined && {
          workspaceToldAvailable: input.available,
        }),
      })
      .where(
        and(
          eq(chats.id, input.chatId),
          eq(chats.ownerUserId, input.ownerUserId),
        ),
      );
  }

  /**
   * The first bound root of a Chat, established by the owner's chat-creation
   * request (openspec `chat-start-location`, design D9).
   *
   * Run-free by construction: it takes the caller's transaction, which runs
   * under `runAs(owner)`, locks the Chat row, and refuses a Chat that already
   * holds a message or a Run — a create never binds after a send. The Chat must
   * be unbound, or bound to the root of its own creation lease, which is the
   * resend case; any other stored root is a conflict. It never takes a
   * synthetic Run and never writes an unscoped update.
   */
  async bindAtCreation(input: {
    chatId: string;
    ownerUserId: string;
    executorId: string;
    root: string;
  }): Promise<
    | { status: 'bound'; generation: number }
    | { status: 'conflict' | 'not_found' }
  > {
    const current = await this.lockChat(input.chatId, input.ownerUserId);
    if (current === undefined) return { status: 'not_found' };
    if (await this.holdsMessageOrRun(input)) return { status: 'conflict' };
    if (
      current.workspaceRoot !== null &&
      !(await this.isItsOwnCreationRoot(input))
    ) {
      return { status: 'conflict' };
    }

    const updated = await this.bindChat(input);
    if (updated === undefined) return { status: 'not_found' };
    return { status: 'bound', generation: updated.workspaceGeneration };
  }

  /** Whether the Chat already carries a message or a Run. */
  private async holdsMessageOrRun(input: {
    chatId: string;
    ownerUserId: string;
  }): Promise<boolean> {
    const [message] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.chatId, input.chatId))
      .limit(1);
    if (message !== undefined) return true;
    const [run] = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(eq(runs.chatId, input.chatId), eq(runs.userId, input.ownerUserId)),
      )
      .limit(1);
    return run !== undefined;
  }

  /**
   * Whether the Chat is bound to the root of a Worktree this Chat's own
   * creation lease names. A lease is written in the same transaction as the
   * worktree checkout and its binding, so a stored root with no such lease was
   * established by something other than creation.
   */
  private async isItsOwnCreationRoot(input: {
    chatId: string;
    ownerUserId: string;
    root: string;
  }): Promise<boolean> {
    const [lease] = await this.db
      .select({ id: worktreeLeases.id })
      .from(worktreeLeases)
      .innerJoin(
        checkouts,
        and(
          eq(checkouts.ownerUserId, worktreeLeases.ownerUserId),
          eq(checkouts.id, worktreeLeases.checkoutId),
        ),
      )
      .where(
        and(
          eq(worktreeLeases.ownerUserId, input.ownerUserId),
          eq(worktreeLeases.chatId, input.chatId),
          eq(checkouts.path, input.root),
        ),
      )
      .limit(1);
    return lease !== undefined;
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
        // Entering a Machine Workspace proves it reachable — the entry's own
        // `fs.stat` went through it — so the availability the next Run
        // compares against is "available". A local binding narrates no
        // availability at all and clears any earlier Machine state.
        workspaceToldAvailable: isMachineExecutorId(input.executorId)
          ? true
          : null,
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
        // No binding narrates no availability; a later Machine Workspace
        // starts from "nothing told" again.
        workspaceToldAvailable: null,
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
        // The detach notice is the whole narration of this transition; the
        // binding it described is gone with it.
        workspaceToldAvailable: null,
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

  private async fenceRun(input: {
    runId: string;
    ownerUserId: string;
    deliverySequence: number | undefined;
    /** The executor to pin the Run to; absent leaves the Run unbound. */
    bindExecutorId?: string;
  }): Promise<boolean> {
    const native = new NativeFilesRepository(this.db);
    if (
      !(await native.isCurrentDelivery({
        runId: input.runId,
        userId: input.ownerUserId,
        deliverySequence: input.deliverySequence,
      }))
    ) {
      return false;
    }
    return input.bindExecutorId === undefined
      ? true
      : native.bind(input.runId, input.ownerUserId, input.bindExecutorId);
  }
}
