/**
 * Post-claim cancellation settlement (#139, run-cancellation) — what a Run
 * persists when the cancellation lands after a worker has claimed it, in the
 * process executing it.
 *
 * Uses the composite worker harness (worker-harness.ts): a REAL pg-boss `runs`
 * queue, a live RunsWorkerService driving RunExecutionService, and a model
 * client scripted per Run by modelId. Cancellation goes through the same two
 * steps the PATCH endpoint takes — record it on the Run, then abort the
 * controller the executing worker registered — so these tests exercise the
 * production settlement path rather than a hand-aborted signal.
 *
 * TEST_DATABASE_URL-gated, like every other *.integration.test.ts here.
 */

import { RunAbortRegistry } from './run-abort-registry';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import {
  bootWorkerHarness,
  createUser,
  seedAndDispatchRun,
  type WorkerHarness,
} from './worker-harness';
import { MessagesRepository } from '../chats/chats-repository';
import { PersonalizationService } from '../personalization/personalization.service';
import { waitFor } from '../testing/support';
import { isRecord } from '@workspace/runtime-safety';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'expired'];

const describeIfDb = process.env['TEST_DATABASE_URL']
  ? describe
  : describe.skip;

vi.setConfig({ testTimeout: 60_000 });

describeIfDb('post-claim cancellation settlement', () => {
  let harness: WorkerHarness;
  let aborts: RunAbortRegistry;
  let personalization: PersonalizationService;
  let userId: string;

  beforeAll(async () => {
    harness = await bootWorkerHarness();
    aborts = harness.moduleRef.get(RunAbortRegistry, { strict: false });
    personalization = harness.moduleRef.get(PersonalizationService, {
      strict: false,
    });
    userId = await createUser(harness.db, 'cancellation');
  });

  afterAll(async () => {
    await harness.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const runStatus = (runId: string) =>
    harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(runId, userId),
    );

  const eventTypesOf = async (runId: string) => {
    const events = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId),
    );
    return events.map((event) => event.eventType);
  };

  const assistantMessages = async (chatId: string) => {
    const messages = await harness.tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    return messages.filter((message) => message.role === 'assistant');
  };

  /** The owner's cancellation, exactly as `PATCH /runs/:id` performs it. */
  async function requestCancellation(runId: string) {
    const requested = await harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).requestCancel(runId, userId),
    );
    return {
      requested,
      aborted: requested !== undefined && aborts.abort(runId),
    };
  }

  const settledRun = (runId: string, what: string) =>
    waitFor(
      async () => {
        const run = await runStatus(runId);
        return run && TERMINAL_STATUSES.includes(run.status) ? run : undefined;
      },
      20_000,
      what,
    );

  it('a cancellation during attempt preparation makes no model request and persists no assistant message', async () => {
    const modelId = `cancel-preparing-${crypto.randomUUID()}`;
    harness.models.register(modelId, {
      kind: 'complete',
      text: 'never requested',
    });
    const streamCallsBefore = harness.models.streamCalls.length;

    // `resolvePromptUser` is called by attempt preparation — after the claim
    // recorded `run.started`, and before `model.requested` can exist. Cancel
    // from inside it, so the cancellation provably lands in that window.
    const spy = vi.spyOn(personalization, 'resolvePromptUser');
    let cancellation:
      | Awaited<ReturnType<typeof requestCancellation>>
      | undefined;
    const seed = await seedAndDispatchRun(harness, { userId, modelId });
    spy.mockImplementation(async (ownerUserId) => {
      // Restored first, so preparation continues through the real resolver and
      // a second attempt would not cancel itself.
      spy.mockRestore();
      cancellation = await requestCancellation(seed.runId);
      return personalization.resolvePromptUser(ownerUserId);
    });

    const settled = await settledRun(
      seed.runId,
      'the preparing Run to settle after the cancellation',
    );
    expect(settled.status).toBe('cancelled');
    expect(cancellation?.aborted).toBe(true);

    // No further model request: the attempt never reached `model.requested`,
    // and the scripted client was never asked to stream. The log opens at
    // `run.started` because the harness seeds the Run row directly, where the
    // accepting API would have appended `run.created` first.
    const eventTypes = await eventTypesOf(seed.runId);
    expect(eventTypes).toEqual(['run.started', 'run.cancelled']);
    expect(harness.models.streamCalls).toHaveLength(streamCallsBefore);
    expect(await assistantMessages(seed.chatId)).toEqual([]);
  });

  it('a cancellation after model.requested with no output persists a turn with no parts', async () => {
    const modelId = `cancel-requested-${crypto.randomUUID()}`;
    // A hang only ever ends by abort, so no output can race the cancellation.
    harness.models.register(modelId, { kind: 'hang' });

    const seed = await seedAndDispatchRun(harness, { userId, modelId });
    await waitFor(
      async () =>
        (await eventTypesOf(seed.runId)).includes('model.requested')
          ? true
          : undefined,
      20_000,
      'the model request to be recorded',
    );

    const cancellation = await requestCancellation(seed.runId);
    expect(cancellation.requested).toBeDefined();
    expect(cancellation.aborted).toBe(true);

    const settled = await settledRun(
      seed.runId,
      'the in-flight Run to settle after the cancellation',
    );
    expect(settled.status).toBe('cancelled');

    // The turn the abort persists carries the output observed before it —
    // here none, so no parts (chats-messages.integration.test.ts:776-821 pins
    // the same shape through the HTTP surface).
    const assistants = await waitFor(
      async () => {
        const messages = await assistantMessages(seed.chatId);
        return messages.length > 0 ? messages : undefined;
      },
      20_000,
      'the aborted assistant turn to be readable',
    );
    expect(assistants).toHaveLength(1);
    expect(assistants[0].parts).toEqual([]);
    expect(isRecord(assistants[0].usage) && assistants[0].usage.status).toBe(
      'aborted',
    );

    const eventTypes = await eventTypesOf(seed.runId);
    expect(eventTypes).toContain('model.requested');
    expect(eventTypes).not.toContain('model.delta');
    expect(eventTypes.at(-1)).toBe('run.cancelled');
  });

  it('a Run that completed first stays completed and records no cancellation', async () => {
    const modelId = `cancel-after-complete-${crypto.randomUUID()}`;
    harness.models.register(modelId, {
      kind: 'complete',
      text: 'answered before the stop',
    });

    const seed = await seedAndDispatchRun(harness, { userId, modelId });
    await settledRun(seed.runId, 'the Run to complete');

    const cancellation = await requestCancellation(seed.runId);
    expect(cancellation.requested).toBeUndefined();
    expect(cancellation.aborted).toBe(false);

    const unchanged = await runStatus(seed.runId);
    expect(unchanged?.status).toBe('completed');
    expect(unchanged?.cancelRequestedAt).toBeNull();
    expect(await eventTypesOf(seed.runId)).not.toContain('run.cancelled');

    const assistants = await assistantMessages(seed.chatId);
    expect(assistants).toHaveLength(1);
    expect(assistants[0].parts).toEqual([
      { type: 'text', text: 'answered before the stop' },
    ]);
  });
});
