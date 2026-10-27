/**
 * Run creation of an accepted turn: the Run row, its `run.created` event, and
 * — for a follow-up Run — the `run.continued` parts its event log starts
 * from. Shared by a chat send and a follow-up request, so every Run of a Turn
 * is created the same way.
 */

import { ConflictException } from '@nestjs/common';

import { type FollowUpAction, type Message, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { isInflightUniqueViolation } from './inflight-unique-violation';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { type PermissionMode } from '../tools/permissions/permission-mode';

/** The follow-up identity of a Run that admission creates. */
export type FollowUpRunInput = {
  action: FollowUpAction;
  sourceRunId: string;
  /** The reply's parts through its last settled tool part. */
  keptParts: Array<unknown>;
  /** Whether the replaced reply already recorded usage. */
  replacesUsage: boolean;
};

export type CreateRunForMessageInput = {
  userId: string;
  chatId: string;
  modelId: string;
  effort: string | undefined;
  permissionMode: PermissionMode;
  targetRunId: string;
  /**
   * Present when a follow-up request creates the Run: the action, the earlier
   * Run it acts on, and the parts its event log starts with.
   */
  followUp?: FollowUpRunInput;
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
): Promise<{ run: Run; supersededRunIds: Array<string> }> {
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
  }

  const run = await createRunRow(tx, input, userMessage);
  await eventsRepo.append(run.id, 'run.created', {
    chatId: input.chatId,
    messageId: userMessage.id,
    // The dispatch resets the reply, hiding the usage it replaced, so the
    // finalization has to know an earlier usage existed (turn-actions D11).
    ...(input.followUp?.replacesUsage === true && { replacesUsage: true }),
  });
  if (input.followUp) {
    await eventsRepo.append(run.id, 'run.continued', {
      sourceRunId: input.followUp.sourceRunId,
      parts: input.followUp.keptParts,
    });
  }

  return { run, supersededRunIds: superseded.map((stale) => stale.id) };
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
        effort: input.effort,
        permissionMode: input.permissionMode,
        followUpAction: input.followUp?.action,
        sourceRunId: input.followUp?.sourceRunId,
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
