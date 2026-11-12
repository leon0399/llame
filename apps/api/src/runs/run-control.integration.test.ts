/**
 * Run control across processes (run-steering D6, run-cancellation): two Nest
 * application contexts on one database, each with its own abort registry —
 * the API side consumes no `runs`, the worker side does. A cancellation
 * recorded through the API context must stop the Run the worker context
 * executes, with the channel as the only link between them.
 *
 * Requires TEST_DATABASE_URL; throws at load instead of skipping.
 */

import { sql } from 'drizzle-orm';
import { RunWaitService } from './run-wait.service';

import { MessagesRepository } from '../chats/chats-repository';
import { createRunForMessage } from '../chats/run-creation';
import { ChatsService } from '../chats/chats.service';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { waitFor } from '../testing/support';
import { RunAbortRegistry } from './run-abort-registry';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import {
  bootWorkerHarness,
  createUser,
  seedAndDispatchRun,
  type WorkerHarness,
} from './worker-harness';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'expired'];

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'run-control.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}

vi.setConfig({ testTimeout: 60_000 });

describe('run control across processes', () => {
  let worker: WorkerHarness;
  let api: WorkerHarness;
  let workerRegistry: RunAbortRegistry;
  let apiRegistry: RunAbortRegistry;
  let userId: string;

  beforeAll(async () => {
    worker = await bootWorkerHarness();
    api = await bootWorkerHarness({ runsConcurrency: null });
    workerRegistry = worker.moduleRef.get(RunAbortRegistry, { strict: false });
    apiRegistry = api.moduleRef.get(RunAbortRegistry, { strict: false });
    userId = await createUser(worker.db, 'run-control');
  });

  afterAll(async () => {
    await api.close();
    await worker.close();
  });

  const runOf = (runId: string) =>
    api.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(runId, userId),
    );

  /** A Run the worker context has claimed and is blocked on a model request. */
  async function hangingRun() {
    const modelId = `run-control-${crypto.randomUUID()}`;
    worker.models.register(modelId, { kind: 'hang' });
    const seed = await seedAndDispatchRun(worker, { userId, modelId });
    await waitFor(
      async () => {
        const events = await api.tenantDb.runAs(userId, (tx) =>
          new RunEventsRepository(tx).listByRunId(seed.runId, userId),
        );

        return events.some((event) => event.eventType === 'model.requested')
          ? true
          : undefined;
      },
      20_000,
      'the model request to be recorded',
    );
    expect(workerRegistry.ownerOf(seed.runId)).toBe(userId);
    expect(apiRegistry.ownerOf(seed.runId)).toBeUndefined();

    return seed;
  }

  const executingInWorker = (runId: string) =>
    workerRegistry.executing().some((entry) => entry.runId === runId);

  const settled = (runId: string) =>
    waitFor(
      async () => {
        const run = await runOf(runId);

        return run &&
          TERMINAL_STATUSES.includes(run.status) &&
          !executingInWorker(runId)
          ? run
          : undefined;
      },
      20_000,
      'the Run to settle and leave the worker',
    );

  it('A cancellation reaches a worker in another process', async () => {
    const seed = await hangingRun();

    // The API context records the cancellation, as `PATCH /runs/:id` does.
    await api.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).requestCancel(seed.runId, userId),
    );

    const run = await settled(seed.runId);
    expect(run.status).toBe('cancelled');
  });

  it('A lost signal still cancels the Run', async () => {
    const seed = await hangingRun();

    // Record the cancellation without the notification: the signal is lost.
    await api.tenantDb.runAs(userId, (tx) =>
      tx.execute(
        sql`update runs set cancel_requested_at = now() where id = ${seed.runId}`,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(executingInWorker(seed.runId)).toBe(true);

    // The worker's listener connection drops and reconnects; the re-read of
    // the Runs it executes finds the recorded cancellation.
    await worker.db.execute(
      sql`select pg_terminate_backend(pid) from pg_stat_activity
          where pid <> pg_backend_pid() and datname = current_database()
          and query ilike 'listen%llame_run_control%'`,
    );

    const run = await settled(seed.runId);
    expect(run.status).toBe('cancelled');
  });

  it('chat deletion reaches a worker in another process', async () => {
    const seed = await hangingRun();

    const chats = new ChatsService(
      api.tenantDb,
      noopReindexDispatch(),
      noopEmbedDispatch(),
      noopQueryEmbedder(),
      api.moduleRef.get(RunWaitService),
    );

    await expect(chats.deleteChat(userId, seed.chatId)).resolves.toBe(true);

    await waitFor(
      () => (executingInWorker(seed.runId) ? undefined : true),
      20_000,
      'the deleted chat’s Run to leave the worker',
    );
  });

  it('a superseded Run is stopped in another process', async () => {
    const seed = await hangingRun();

    // A retry of the same message supersedes the Run in the API context.
    await api.tenantDb.runAs(userId, async (tx) => {
      const [message] = await new MessagesRepository(tx).findByChatId(
        seed.chatId,
        userId,
      );

      await createRunForMessage(
        tx,
        {
          userId,
          chatId: seed.chatId,
          modelId: 'unused',
          effort: undefined,
          permissionMode: 'default',
          targetRunId: crypto.randomUUID(),
        },
        message,
      );
    });

    const run = await settled(seed.runId);
    expect(run.status).toBe('cancelled');
  });

  it('a notification without a recorded cancellation does not stop the Run', async () => {
    const seed = await hangingRun();
    // The payload is a pointer; the listener acts only on a recorded state.
    await worker.db.execute(
      sql`select pg_notify('llame_run_control', ${JSON.stringify({ runId: seed.runId, kind: 'cancel' })})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(executingInWorker(seed.runId)).toBe(true);

    await api.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).requestCancel(seed.runId, userId),
    );
    await settled(seed.runId);
  });
});
