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
import { RunEventsRepository } from './runs-repository';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';

/**
 * The two facts admission records in `run.created` and a later writer reads
 * back: whether the reply it replaced had usage (D11), and whether it owes the
 * turn the Regenerate notice (D9).
 */
export async function readCreatedFlags(
  tx: Db,
  runId: string,
  userId: string,
): Promise<{ replacesUsage: boolean; notice: boolean }> {
  const created = await new RunEventsRepository(tx).findFirstByType(
    runId,
    userId,
    'run.created',
  );
  const payload = created?.payload;
  const record = isRecord(payload) ? payload : {};
  return {
    replacesUsage: record['replacesUsage'] === true,
    notice: record['notice'] === true,
  };
}

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
 * `run.started`; a delivery records the attempt of its segment.
 */
async function currentSegmentAttempts(
  tx: Db,
  runId: string,
  userId: string,
): Promise<ReadonlySet<string> | undefined> {
  const log = await new RunEventsRepository(tx).listByRunId(runId, userId, {
    eventTypes: ['run.started', 'run.delivered'],
  });
  const delivered = log.findLastIndex(
    ({ eventType }) => eventType === 'run.delivered',
  );
  if (delivered === -1) return undefined;
  const attempts = new Set<string>();
  for (const { payload } of log.slice(delivered)) {
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
 * after it, read from the event sequence so that a clock step cannot reorder
 * them. The follow-up
 * replacement flag belongs to the first segment, which is the only one that
 * answers the follow-up's message. A steer delivery closes the reply while the
 * Run is live, so the terminal-status condition does not apply to it
 * (run-steering D4).
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
  const segmentAttempts = await currentSegmentAttempts(tx, runId, userId);
  const receipts = (
    await new SystemPromptReceiptsRepository(tx).findByOwnedRun(runId, userId)
  ).filter(
    ({ attemptId }) =>
      segmentAttempts === undefined || segmentAttempts.has(attemptId),
  );
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
    !receipts.some(({ attemptId }) => attemptId !== input.attemptId) &&
    !replacedUsage;
}
