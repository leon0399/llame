/**
 * Per-request reasoning effort — persistence and execution (add-reasoning-effort).
 *
 * Uses the composite worker harness (worker-harness.ts) so the assertions run
 * against the real executor over a real queue and a real database, not a
 * hand-built double of either.
 *
 * What matters here is the property that separates a persisted effort from a
 * re-resolved one: the worker sends the value the run STORED, whatever the
 * catalog says by the time it executes. A test that only sent a valid level
 * and saw it arrive would pass just as happily against an implementation that
 * looked the default up at pickup, which is precisely what the design forbids.
 *
 * TEST_DATABASE_URL-gated — skipped otherwise. worker-harness.ts
 * self-provisions POSTGRES_URL from TEST_DATABASE_URL.
 */

import { RunsRepository } from './runs-repository';
import { waitFor } from '../testing/support';
import {
  bootWorkerHarness,
  createUser,
  seedAndDispatchRun,
  type WorkerHarness,
} from './worker-harness';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

vi.setConfig({ testTimeout: 60_000 });

describeIfDb('Reasoning effort — persisted, then executed verbatim', () => {
  let harness: WorkerHarness;
  let userId: string;

  beforeAll(async () => {
    harness = await bootWorkerHarness({ runsConcurrency: 1 });
    userId = await createUser(harness.db, 'effort');
  });

  afterAll(async () => {
    await harness.close();
  });

  const runRow = (runId: string) =>
    harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(runId, userId),
    );

  /** Seed + dispatch a run at `effort`, wait for terminal, return what the model client saw. */
  async function execute(modelId: string, effort?: string) {
    harness.models.register(modelId, { kind: 'complete', text: 'ok' });
    const { runId } = await seedAndDispatchRun(harness, {
      userId,
      modelId,
      ...(effort !== undefined && { effort }),
    });
    await waitFor(
      async () => {
        const run = await runRow(runId);
        return run?.status === 'completed' ? run : undefined;
      },
      20_000,
      `run ${runId} to complete`,
    );
    return {
      runId,
      sent: harness.models.streamCalls.filter((c) => c.modelId === modelId),
    };
  }

  // Padded on purpose: one test then covers the whole round trip AND proves
  // neither the column nor the executor trims a token llame never constrains.
  it('stores the effort concretely and sends exactly that value', async () => {
    const modelId = `effort-stored-${Date.now()}`;
    const { runId, sent } = await execute(modelId, ' Very-High_2 ');

    expect((await runRow(runId))?.effort).toBe(' Very-High_2 ');
    expect(sent).toEqual([{ modelId, effort: ' Very-High_2 ' }]);
  });

  it('sends no effort at all for a run that stored none', async () => {
    const modelId = `effort-absent-${Date.now()}`;
    const { runId, sent } = await execute(modelId);

    expect((await runRow(runId))?.effort).toBeNull();
    expect(sent).toEqual([{ modelId, effort: undefined }]);
  });

  // A level meaning "do not reason" must reach the provider. Dropping it would
  // silently restore the provider's own default, which is the opposite of what
  // the owner asked for.
  it('sends a disabling level rather than treating it as no selection', async () => {
    const modelId = `effort-none-${Date.now()}`;
    const { sent } = await execute(modelId, 'none');

    expect(sent).toEqual([{ modelId, effort: 'none' }]);
  });

  // The receipt property: execution never re-resolves or re-validates against
  // the catalog, so a level the operator has since withdrawn — or one no model
  // ever declared — still executes as stored.
  it('sends a stored level the current catalog would reject', async () => {
    const modelId = `effort-withdrawn-${Date.now()}`;
    const { runId, sent } = await execute(modelId, 'retired-level');

    expect((await runRow(runId))?.effort).toBe('retired-level');
    expect(sent).toEqual([{ modelId, effort: 'retired-level' }]);
  });
});
