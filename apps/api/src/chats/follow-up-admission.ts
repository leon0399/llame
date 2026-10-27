/**
 * The action check of a follow-up request (turn-actions D2): which earlier Run
 * a follow-up may act on, and which reply it may keep.
 *
 * Continue resumes the turn of a Run that ended without finishing, so the
 * reply it continues must be that Run's own, unfinished answer. The reply
 * check also closes the gap behind a Regenerate that failed before its
 * dispatch: that reply belongs to an older Run, and Continue must never keep
 * parts that another Run's model produced.
 */

import { ConflictException } from '@nestjs/common';

import { isRecord, isString } from '@workspace/runtime-safety';

import { type Message, type Run, type RunStatus } from '../db/schema';
import { isCompletedAssistantTurn } from './assistant-completion';

/**
 * The terminal statuses a Continue Run resumable from. A `completed` Run has
 * nothing left to continue: its turn already produced its answer.
 */
const CONTINUABLE_RUN_STATUSES: ReadonlyArray<RunStatus> = [
  'failed',
  'cancelled',
  'expired',
];

export function isContinuableRunStatus(status: RunStatus): boolean {
  return CONTINUABLE_RUN_STATUSES.includes(status);
}

/** The Run id a reply's usage names, when it names one. */
export function replyRunId(usage: unknown): string | undefined {
  if (!isRecord(usage)) return undefined;
  const runId = usage['runId'];
  return isString(runId) ? runId : undefined;
}

/**
 * The reply a Continue Run continues, or a 409: the latest Run must be
 * resumable, its reply must exist, its usage must name that Run, and its
 * usage must not be `completed`.
 */
export function continuableReply(
  latestRun: Run,
  reply: Message | undefined,
): Message {
  if (!isContinuableRunStatus(latestRun.status)) {
    throw new ConflictException(
      `A ${latestRun.status} Run cannot be continued`,
    );
  }
  if (reply === undefined) {
    throw new ConflictException('The Run that can be continued left no reply');
  }
  if (
    replyRunId(reply.usage) !== latestRun.id ||
    isCompletedAssistantTurn(reply)
  ) {
    throw new ConflictException(
      'The reply does not belong to a Run that can be continued',
    );
  }
  return reply;
}
