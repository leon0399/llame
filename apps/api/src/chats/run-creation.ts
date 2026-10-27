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
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import type { ToolResult } from '../tools/types';

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
      /** The reply's parts through its last settled tool part. */
      keptParts: Array<unknown>;
      /** The source Run's `toolCallId -> stepNumber` map for those kept calls. */
      keptStepNumbers: Record<string, number>;
      /** The model-facing result the source Run sent the model for each kept call. */
      keptResults: Record<string, ToolResult>;
    })
  | (FollowUpRunIdentity & { action: 'regenerate'; notice: boolean });

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
      parts: followUp.keptParts,
      // Two sequential steps with no text between them stay two steps in the
      // Continue projection (turn-actions D6); a source Run recorded before
      // step numbers existed stores an empty map.
      steps: followUp.keptStepNumbers,
      results: followUp.keptResults,
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
