/**
 * Run creation of an accepted turn: the Run row, its `run.created` event, and
 * — for a follow-up Run — the `run.continued` parts its event log starts
 * from. Shared by a chat send and a follow-up request, so every Run of a Turn
 * is created the same way.
 */

import { ConflictException } from '@nestjs/common';

import { type Message, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { isInflightUniqueViolation } from './inflight-unique-violation';
import { notifyRunControl } from '../runs/run-control';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { type PermissionMode } from '../tools/permissions/permission-mode';

/** What every follow-up Run records about the Run it acts on. */
type FollowUpRunIdentity = {
  sourceRunId: string;
  /** Whether the replaced reply already recorded usage. */
  replacesUsage: boolean;
};

/**
 * The follow-up identity of a Run that admission creates. A Continue Run also
 * records the parts its event log starts from; a Regenerate Run records whether
 * it owes the turn its notice, because it replaces the reply instead of
 * continuing it (turn-actions D4, D9).
 */
export type FollowUpRunInput =
  | (FollowUpRunIdentity & {
      action: 'continue';
      /**
       * The reply's parts through its last settled tool part, each kept call
       * carrying the step it belongs to (turn-actions D6, D11).
       */
      keptParts: Array<unknown>;
    })
  | (FollowUpRunIdentity & { action: 'regenerate'; notice: boolean });

/** The Run columns a resolved selection fills, for every Run creator. */
export type RunSelection = {
  /** The model that serves the Run's first segment. */
  modelId: string;
  /** What the owner (or the derived creator) resolved; `@role` or an exact id. */
  selector: string;
  /** The effort the first segment sends; absent means "send none". */
  effort: string | undefined;
  /** The Chat selection revision this Run read, or null when it had none. */
  selectionRevision: number | null;
  permissionMode: PermissionMode;
};

/** The Run columns one resolved selection fills, `selectedEffort` included. */
export type RunSelectionFields = RunSelection & {
  selectedEffort: string | undefined;
};

/**
 * The selection columns of one Run. Every creator of this file and the
 * admission paths around it spread this, so `selectedEffort` starts equal to
 * the served effort and no creator can drop or reorder the columns.
 */
export function runSelectionFields(
  selection: RunSelection,
): RunSelectionFields {
  return {
    modelId: selection.modelId,
    selector: selection.selector,
    effort: selection.effort,
    selectedEffort: selection.effort,
    selectionRevision: selection.selectionRevision,
    permissionMode: selection.permissionMode,
  };
}

export type CreateRunForMessageInput = RunSelection & {
  /** The selection's effort; defaults to the served effort when absent. */
  selectedEffort?: string | undefined;
  userId: string;
  chatId: string;
  targetRunId: string;
  /**
   * Present when a follow-up request creates the Run: the action, the earlier
   * Run it acts on, and the parts its event log starts with.
   */
  followUp?: FollowUpRunInput;
  /**
   * The follow-up identity of a Run whose reply it does NOT continue from the
   * event log: Continue on next candidate starts an ordinary first segment on
   * the switch's host message, so it records the action and its source Run
   * without `run.continued` or `replacesUsage` (design D7).
   */
  followUpAction?: 'continue' | 'regenerate';
  origin?: Run['origin'];
  sourceRunId?: string;
};

/**
 * The Run row, atomically with canceling any (defensively impossible, but
 * legacy-data-tolerant) stale active runs on this same message, and the
 * `run.created` event. A follow-up Run appends `run.continued` with the parts
 * its event log starts from, right after `run.created`. No snapshot is bound —
 * the worker resolves prompt/catalog at execution time.
 */
export async function createRunForMessage(
  tx: Db,
  input: CreateRunForMessageInput,
  userMessage: Message,
): Promise<{ run: Run }> {
  const runsRepo = new RunsRepository(tx);
  const eventsRepo = new RunEventsRepository(tx);

  const superseded = await runsRepo.cancelActiveRunsForMessage(
    userMessage.id,
    input.userId,
  );

  for (const stale of superseded) {
    await eventsRepo.append(stale.id, 'run.cancelled', {
      reason: 'superseded by retry',
    });
    // On commit, so the process executing the stale Run stops its model call.
    await notifyRunControl(tx, { runId: stale.id, kind: 'cancel' });
  }

  const run = await createRunRow(tx, input, userMessage);
  const followUp = input.followUp;
  await eventsRepo.append(run.id, 'run.created', {
    chatId: input.chatId,
    messageId: userMessage.id,
    // The dispatch resets the reply, hiding the usage it replaced, so the
    // finalization has to know an earlier usage existed (turn-actions D11).
    ...(followUp?.replacesUsage === true && { replacesUsage: true }),
    // The dispatch transaction stores the notice on the triggering user
    // message, and a retry of this Run keeps what its first dispatch stored
    // (turn-actions D9).
    ...(followUp?.action === 'regenerate' &&
      followUp.notice && { notice: true }),
  });

  if (followUp?.action === 'continue') {
    await eventsRepo.append(run.id, 'run.continued', {
      sourceRunId: followUp.sourceRunId,
      // The kept parts carry both the step each call belongs to and the
      // result the live loop sent, so the event stores one source (D11). A
      // source Run recorded before step numbers existed has its kept parts
      // numbered by admission.
      parts: followUp.keptParts,
    });
  }

  return { run };
}

/** What a `/compact` Run records; every field the selection resolved. */
export type CompactionRunInput = {
  id: string;
  chatId: string;
  userId: string;
  modelId: string;
  selector: string;
  effort?: string;
  selectedEffort?: string;
  selectionRevision?: number | null;
  permissionMode?: PermissionMode;
  origin?: Run['origin'];
  focus: string | null;
};

export async function createCompactionRun(
  tx: Db,
  input: CompactionRunInput,
): Promise<Run> {
  const run = await createCompactionRunRow(tx, input);

  await new RunEventsRepository(tx).append(run.id, 'run.created', {
    chatId: input.chatId,
    messageId: null,
    compaction: { focus: input.focus },
  });

  return run;
}

/** The compaction Run's row in its own savepoint, mapped to the 409 it causes. */
async function createCompactionRunRow(
  tx: Db,
  input: CompactionRunInput,
): Promise<Run> {
  try {
    return await tx.transaction((inner) =>
      new RunsRepository(inner).create({
        id: input.id,
        chatId: input.chatId,
        messageId: null,
        userId: input.userId,
        modelId: input.modelId,
        selector: input.selector,
        effort: input.effort,
        selectedEffort: input.selectedEffort,
        selectionRevision: input.selectionRevision ?? undefined,
        permissionMode: input.permissionMode,
        origin: input.origin ?? 'owner',
        kind: 'compaction',
      }),
    );
  } catch (error) {
    if (isInflightUniqueViolation(error)) {
      throw new ConflictException(
        'Another run is already in flight for this chat',
      );
    }

    throw error;
  }
}

/**
 * The Run row itself, in a savepoint (nested tx) so the single-flight unique
 * violation it may raise cannot poison the outer admission transaction —
 * `clearActiveRunSlot` still needs it live.
 */
async function createRunRow(
  tx: Db,
  input: CreateRunForMessageInput,
  userMessage: Message,
): Promise<Run> {
  try {
    return await tx.transaction((inner) =>
      new RunsRepository(inner).create({
        id: input.targetRunId,
        chatId: input.chatId,
        messageId: userMessage.id,
        userId: input.userId,
        modelId: input.modelId,
        selector: input.selector,
        effort: input.effort,
        selectedEffort: input.selectedEffort,
        selectionRevision: input.selectionRevision ?? undefined,
        permissionMode: input.permissionMode,
        origin: input.origin ?? 'owner',
        followUpAction: input.followUpAction ?? input.followUp?.action,
        sourceRunId: input.sourceRunId ?? input.followUp?.sourceRunId,
      }),
    );
  } catch (error) {
    if (isInflightUniqueViolation(error)) {
      throw new ConflictException(
        'Another run is already in flight for this chat',
      );
    }

    throw error;
  }
}
