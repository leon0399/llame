import { waitFor } from '../testing/support';
import { type WorkerHarness, seedRun } from './worker-harness';
import { RunsRepository } from './runs-repository';

export async function completeSourceTurn(
  harness: WorkerHarness,
  userId: string,
  modelId: string,
  text: string,
) {
  const source = await seedRun({
    tenantDb: harness.tenantDb,
    userId,
    modelId,
    text,
  });

  await harness.dispatch.dispatch({ ...source, userId, modelId });
  await waitForRun(harness, userId, source.runId, 'completed');

  return source;
}

export async function waitForRun(
  harness: WorkerHarness,
  userId: string,
  runId: string,
  status: 'completed' | 'cancelled',
): Promise<void> {
  await waitFor(
    async () => {
      const run = await harness.tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(runId, userId),
      );

      return run?.status === status ? true : undefined;
    },
    15_000,
    `Run ${runId} to reach ${status}`,
  );
}
