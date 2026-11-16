import type { Run } from '../db/schema/chats';
import type { Db } from '../db/tenant-db.service';
import type { RunJob } from './run-queues';
import { isTerminalRunStatus } from './run-status';
import type { RunsRepository } from './runs-repository';
import type { RunWaitService } from './run-wait.service';

export async function wakeAwaitingRun(
  tx: Db,
  runs: RunsRepository,
  runWait: Pick<RunWaitService, 'wakeInTransaction'>,
  job: RunJob,
): Promise<Run | undefined> {
  const wake = job.wake;

  if (!wake) return undefined;

  const woke = await runWait.wakeInTransaction(tx, {
    runId: job.runId,
    userId: job.userId,
    generation: wake.generation,
    cause: 'timeout',
    deadlineJobId: wake.jobId,
  });

  if (!woke) return undefined;

  const run = await runs.findById(job.runId, job.userId);

  return run && !isTerminalRunStatus(run.status) ? run : undefined;
}
