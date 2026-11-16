import { drizzle } from 'drizzle-orm/postgres-js';

import type { Run } from '../db/schema';
import { asDouble } from '../testing/support';
import { completeCompactionRun } from './compaction-run-completion';
import { RunsRepository } from './runs-repository';

it('does not publish a returned summary when cancellation wins before commit', async () => {
  const db = drizzle.mock();
  vi.spyOn(RunsRepository.prototype, 'updateForAttempt').mockResolvedValue(
    asDouble<Run>({ id: 'run-1' }),
  );
  vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(
    asDouble<Run>({
      id: 'run-1',
      cancelRequestedAt: new Date(),
    }),
  );

  const operations = {
    transaction: async <T>(work: (tx: typeof db) => Promise<T>) => work(db),
    retry: async <T>(work: () => Promise<T>) => work(),
    resolveDigest: vi.fn().mockResolvedValue({}),
    publishCheckpoint: vi.fn(),
    finish: vi.fn().mockResolvedValue({ outcome: 'won' }),
    startIdleNotice: vi.fn(),
    dispatchPromoted: vi.fn(),
  };

  await completeCompactionRun(
    {
      runId: 'run-1',
      chatId: 'chat-1',
      userId: 'owner-1',
      attemptId: 'attempt-1',
      expectedQueueIdentity: { currentJobId: null, wakeGeneration: 0 },
      summary: { uptoSeq: 2, summary: 'already returned', usage: {} },
    },
    operations,
  );

  expect(operations.publishCheckpoint).not.toHaveBeenCalled();
  expect(operations.finish).toHaveBeenCalledWith(
    db,
    expect.objectContaining({ status: 'cancelled' }),
  );
});
