/**
 * The completeness of an assistant reply's usage (run-usage-accounting):
 * the checks that need owner-scoped Run, reply, and receipt state. The
 * terminal transaction and a steer delivery both close a reply and share them.
 */

import { isRecord, isString } from '@workspace/runtime-safety';

import {
  MessagesRepository,
  isCompletedAssistantTurn,
} from '../chats/chats-repository';
import { type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  isRunningUsage,
  type AssistantTurnTelemetry,
} from './run-reply-finalizer';
import { eventsSinceLatestDelivery } from './run-segment-queries';
import { readCreatedFlags } from './run-created-flags';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';

async function hasReplaceableAssistantUsage(
  tx: Db,
  input: {
    userId: string;
    runId: string;
    chatId: string | undefined;
    inReplyTo: string | null | undefined;
  },
): Promise<boolean> {
  const { userId, runId, chatId, inReplyTo } = input;

  if (chatId === undefined || inReplyTo === undefined || inReplyTo === null) {
    return false;
  }

  const { assistantMessage } = await new MessagesRepository(tx).findTurnState(
    chatId,
    userId,
    inReplyTo,
  );

  if (
    assistantMessage === undefined ||
    isCompletedAssistantTurn(assistantMessage)
  ) {
    return false;
  }

  // The Run's own `running` reply is its turn in progress, not an earlier
  // reply it replaces (design D3).
  const usage = assistantMessage.usage;

  return !isRunningUsage(usage) || usage.runId !== runId;
}

/**
 * The attempts of the Run's current segment, or undefined before the first
 * delivery, when every attempt belongs to it. A claim records its attempt in
 * `run.started`; a delivery records the attempt of its segment. The event
 * sequence orders them, so that a clock step cannot reorder them.
 */
async function currentSegmentAttempts(
  tx: Db,
  runId: string,
  userId: string,
): Promise<ReadonlySet<string> | undefined> {
  const { delivered, events } = await eventsSinceLatestDelivery(
    tx,
    runId,
    userId,
    { eventTypes: ['run.started'] },
  );

  if (delivered === undefined) return undefined;
  const attempts = new Set<string>();

  for (const { payload } of [delivered, ...events]) {
    if (isRecord(payload) && isString(payload['attemptId'])) {
      attempts.add(payload['attemptId']);
    }
  }

  return attempts;
}

/**
 * Finalizes `telemetry.complete` against owner-scoped Run and reply state.
 *
 * Only the attempts of the current segment count as other attempts: the one
 * the latest `run.delivered` names and every attempt that claimed the Run
 * after it. The follow-up replacement flag belongs to the first segment, which
 * is the only one that answers the follow-up's message. A steer delivery
 * closes the reply while the Run is live, so the terminal-status condition
 * does not apply to it (run-steering D4).
 */
export async function finalizeUsageCompleteness(
  tx: Db,
  input: {
    userId: string;
    runId: string;
    attemptId: string | undefined;
    run: Run | undefined;
    chatId: string | undefined;
    inReplyTo: string | null | undefined;
    telemetry: AssistantTurnTelemetry;
    closedBySteer?: boolean;
  },
): Promise<void> {
  const { userId, runId, run, telemetry } = input;

  const receipts = await new SystemPromptReceiptsRepository(tx).findByOwnedRun(
    runId,
    userId,
  );

  // The segment read matters only when a receipt names another attempt or the
  // follow-up flag below is in play.
  const others = receipts.filter(
    ({ attemptId }) => attemptId !== input.attemptId,
  );

  const segmentAttempts =
    others.length > 0 || run?.followUpAction != null
      ? await currentSegmentAttempts(tx, runId, userId)
      : undefined;

  // A follow-up Run's admission recorded whether its reply replaces one that
  // already carried usage: the dispatch reset hides that usage from the read
  // above, so the flag is the only trace of it (turn-actions D11).
  const replacedUsage =
    (await hasReplaceableAssistantUsage(tx, input)) ||
    (segmentAttempts === undefined &&
      run?.followUpAction != null &&
      (await readCreatedFlags(tx, runId, userId)).replacesUsage);

  telemetry.complete =
    telemetry.complete === true &&
    (input.closedBySteer === true || run?.status === 'completed') &&
    !others.some(({ attemptId }) => segmentAttempts?.has(attemptId) ?? true) &&
    !replacedUsage;
}
