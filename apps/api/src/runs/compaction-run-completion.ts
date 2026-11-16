import { RunsRepository } from './runs-repository';
import { type Db } from '../db/tenant-db.service';
import { type CompactionSummary } from '../compaction/compaction.service';
import { type RecencyDigestResolution } from '../chats/recency-digest.service';
import { type ResolvedMemorySettings } from '../memory/memory.service';
import {
  type FinishRunInput,
  type FinishRunResult,
} from './run-execution.service';

export type CompactionCompletionInput = {
  runId: string;
  chatId: string;
  userId: string;
  attemptId: string;
  expectedQueueIdentity: NonNullable<FinishRunInput['expectedQueueIdentity']>;
  summary: CompactionSummary | undefined;
};

type Digest = {
  shareRecentChats: ResolvedMemorySettings;
  candidate: RecencyDigestResolution | null;
};

type CompactionCompletionOperations = {
  transaction<T>(operation: (tx: Db) => Promise<T>): Promise<T>;
  retry<T>(work: () => Promise<T>): Promise<T>;
  resolveDigest(input: { userId: string; chatId: string }): Promise<Digest>;
  publishCheckpoint(
    tx: Db,
    input: CompactionCompletionInput,
    digest: Digest,
  ): Promise<void>;
  finish(tx: Db, input: FinishRunInput): Promise<FinishRunResult>;
  startIdleNotice(
    tx: Db,
    input: { chatId: string; ownerUserId: string },
  ): Promise<void>;
  dispatchPromoted(
    job: NonNullable<
      Extract<FinishRunResult, { outcome: 'won' | 'errored' }>['promoted']
    >,
  ): Promise<void>;
};

export async function completeCompactionRun(
  input: CompactionCompletionInput,
  operations: CompactionCompletionOperations,
): Promise<FinishRunResult> {
  const digest = await operations.resolveDigest(input);

  const result = await operations.retry(() =>
    operations.transaction((tx) =>
      completeInTransaction(tx, input, digest, operations),
    ),
  );

  if (result.outcome === 'won' && result.promoted !== undefined) {
    await operations.dispatchPromoted(result.promoted);
  }

  return result;
}

async function completeInTransaction(
  tx: Db,
  input: CompactionCompletionInput,
  digest: Digest,
  operations: CompactionCompletionOperations,
): Promise<FinishRunResult> {
  const runs = new RunsRepository(tx);

  const fenced = await runs.updateForAttempt(
    input.runId,
    input.userId,
    input.attemptId,
    { activeAttemptId: input.attemptId },
  );

  if (!fenced) return { outcome: 'lost' };

  const current = await runs.findById(input.runId, input.userId);

  if (current === undefined) return { outcome: 'lost' };

  const status = current.cancelRequestedAt === null ? 'completed' : 'cancelled';

  if (status === 'completed' && input.summary !== undefined) {
    await operations.publishCheckpoint(tx, input, digest);
  }

  return finishCompactionRun(tx, input, status, operations);
}

async function finishCompactionRun(
  tx: Db,
  input: CompactionCompletionInput,
  status: 'completed' | 'cancelled',
  operations: CompactionCompletionOperations,
): Promise<FinishRunResult> {
  const finish = await operations.finish(tx, {
    runId: input.runId,
    userId: input.userId,
    status,
    attemptId: input.attemptId,
    expectedQueueIdentity: input.expectedQueueIdentity,
    runPayload: { status },
    ...(status === 'cancelled' && { error: { message: 'Run was cancelled.' } }),
  });

  if (
    finish.outcome === 'won' &&
    finish.promoted === undefined &&
    status === 'completed'
  ) {
    await operations.startIdleNotice(tx, {
      chatId: input.chatId,
      ownerUserId: input.userId,
    });
  }

  return finish;
}
