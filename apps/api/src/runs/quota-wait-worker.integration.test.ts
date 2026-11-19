import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '@workspace/runtime-safety';
import { eq, sql } from 'drizzle-orm';

import { runs, runEvents } from '../db/schema';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ProviderFailure } from '../models/provider-failure/provider-failure';
import { waitFor } from '../testing/support';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RunWaitService } from './run-wait.service';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedRun,
  type WorkerHarness,
} from './worker-harness';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'quota-wait-worker.integration.test.ts requires the integration database',
  );
}

describe('quota wait worker acceptance', () => {
  let harness: WorkerHarness;
  let userId: string;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'quota-wait-worker-'));
    await writeFile(
      join(directory, 'readable.txt'),
      'QUOTA_WORKER_READ_PAYLOAD\n',
    );
    harness = await bootWorkerHarness({
      queueSchema: `quota_worker_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      runsConcurrency: 1,
      quotaWaitMaxSeconds: 7 * 24 * 60 * 60,
      timeoutSeconds: 1800,
      allowedTools: ['read'],
      nativeExecutorId: 'quota-wait-worker-host',
    });
    userId = await createUser(harness.db, `quota-worker-${randomUUID()}`);
  });

  afterAll(async () => {
    await harness.close();
    await rm(directory, { recursive: true, force: true });
  });

  const db = <T>(work: Parameters<typeof harness.tenantDb.runAs<T>>[1]) =>
    harness.tenantDb.runAs(userId, work);

  const run = (runId: string) =>
    db((tx) => new RunsRepository(tx).findById(runId, userId));

  const events = (runId: string) =>
    db((tx) => new RunEventsRepository(tx).listByRunId(runId, userId));

  const terminal = (runId: string) =>
    waitFor(
      async () => {
        const found = await run(runId);

        return found &&
          ['completed', 'failed', 'cancelled', 'expired'].includes(found.status)
          ? found
          : undefined;
      },
      30_000,
      `Run ${runId} to settle`,
    );

  async function dispatch(
    seeded: Awaited<ReturnType<typeof seedRun>>,
    modelId: string,
  ) {
    await dispatchRun({
      queue: harness.queue,
      ...seeded,
      userId,
      modelId,
    });
  }

  async function wakeQuota(runId: string): Promise<void> {
    const waiting = await run(runId);

    if (
      !waiting ||
      waiting.status !== 'awaiting_quota' ||
      waiting.awaiting?.kind !== 'quota'
    ) {
      throw new Error('Expected the Run to be suspended for quota');
    }

    const awaiting = waiting.awaiting;

    // Advance only the durable logical wake time; the real timeout waker still
    // publishes the current-generation job that the worker must claim.
    await db((tx) =>
      tx
        .update(runs)
        .set({
          awaiting: {
            ...awaiting,
            wakeAt: new Date(0).toISOString(),
          },
        })
        .where(eq(runs.id, runId)),
    );
    await db((tx) =>
      harness.moduleRef.get(RunWaitService).wakeInTransaction(tx, {
        runId,
        userId,
        generation: waiting.wakeGeneration,
        cause: 'timeout',
      }),
    );
  }

  it('frees the sole worker for another Chat while retaining the suspended Run identity', async () => {
    const firstModel = `quota-worker-first-${randomUUID()}`;
    const secondModel = `quota-worker-second-${randomUUID()}`;
    let secondRequestStarted = false;

    harness.models.register(firstModel, {
      kind: 'step-script',
      steps: [[{ type: 'text', id: 'unused', text: 'must not stream' }]],
      beforeStep: () => {
        throw new ProviderFailure('weekly quota exhausted', {
          code: 'quota_exhausted',
          resetsAt: Date.now() + 24 * 60 * 60 * 1000,
        });
      },
    });
    harness.models.register(secondModel, {
      kind: 'step-script',
      steps: [
        [{ type: 'text', id: 'other-chat', text: 'other chat completed' }],
      ],
      beforeStep: () => {
        secondRequestStarted = true;
      },
    });

    const waiting = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId: firstModel,
      text: 'wait for quota',
    });

    const next = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId: secondModel,
      text: 'run on the freed worker',
    });

    await dispatch(waiting, firstModel);
    await dispatch(next, secondModel);

    await waitFor(
      async () => {
        const [waitingRun, nextRun] = await Promise.all([
          run(waiting.runId),
          run(next.runId),
        ]);

        return waitingRun?.status === 'awaiting_quota' &&
          nextRun?.status === 'completed'
          ? true
          : undefined;
      },
      30_000,
      'the quota wait and the other Chat to complete on the sole worker',
    );

    expect(secondRequestStarted).toBe(true);
    expect(await run(waiting.runId)).toMatchObject({
      id: waiting.runId,
      chatId: waiting.chatId,
      status: 'awaiting_quota',
      awaiting: { kind: 'quota' },
    });
    expect(
      (await events(waiting.runId)).map((event) => event.eventType),
    ).toContain('run.suspended');
    expect(
      (await events(waiting.runId)).map((event) => event.eventType),
    ).not.toContain('run.completed');
  });

  it('resumes the same model and effort from stored steps, then delivers a pending steer at the recovered boundary', async () => {
    const modelId = `quota-worker-steer-${randomUUID()}`;
    let failSecondRequest = true;
    harness.models.register(modelId, {
      kind: 'step-script',
      steps: [
        [
          { type: 'text', id: 'first-boundary', text: 'first segment answer' },
          {
            type: 'tool-call',
            toolCallId: 'quota-initial-read',
            toolName: 'read',
            input: { path: join(directory, 'readable.txt') },
          },
        ],
        [{ type: 'text', id: 'failed-request', text: 'must not stream' }],
      ],
      beforeStep: (stepIndex) => {
        if (stepIndex === 1 && failSecondRequest) {
          failSecondRequest = false;
          throw new ProviderFailure('weekly quota exhausted', {
            code: 'quota_exhausted',
            resetsAt: Date.now() + 24 * 60 * 60 * 1000,
          });
        }
      },
    });

    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      effort: 'high',
      text: 'continue this request after reset',
    });

    await dispatch(seeded, modelId);
    await waitFor(
      async () =>
        (await run(seeded.runId))?.status === 'awaiting_quota' || undefined,
      30_000,
      'the Run to suspend after the typed quota failure',
    );

    const suspension = (await events(seeded.runId)).find(
      (event) => event.eventType === 'run.suspended',
    );

    const parts = isRecord(suspension?.payload)
      ? suspension.payload['parts']
      : undefined;

    expect(
      Array.isArray(parts) &&
        parts.some(
          (part) =>
            isRecord(part) &&
            part['type'] === 'text' &&
            part['text'] === 'first segment answer',
        ),
    ).toBe(true);

    const initialRead = (await events(seeded.runId)).find(
      (event) =>
        event.eventType === 'tool.completed' &&
        isRecord(event.payload) &&
        event.payload['toolCallId'] === 'quota-initial-read',
    );

    expect(initialRead?.payload).toMatchObject({
      toolName: 'read',
      output: {
        status: 'success',
      },
    });

    const readOutput = isRecord(initialRead?.payload)
      ? initialRead.payload['output']
      : undefined;

    expect(isRecord(readOutput) ? readOutput['content'] : undefined).toContain(
      'QUOTA_WORKER_READ_PAYLOAD',
    );

    await db((tx) =>
      new ChatDeliveriesRepository(tx).insertPending({
        id: randomUUID(),
        chatId: seeded.chatId,
        ownerUserId: userId,
        mode: 'steer',
        parts: [{ type: 'text', text: 'include this pending steer' }],
        settings: { modelId: 'ignored-steer-model', permissionMode: 'default' },
      }),
    );

    const pendingBeforeWake = await db((tx) =>
      new ChatDeliveriesRepository(tx).listPending(seeded.chatId, userId),
    );

    expect(pendingBeforeWake).toHaveLength(1);

    const callsBeforeWake = harness.models.streamCalls.length;
    harness.models.register(modelId, {
      kind: 'step-script',
      steps: [
        [
          {
            type: 'tool-call',
            toolCallId: 'quota-recovery-read',
            toolName: 'read',
            input: { path: join(directory, 'readable.txt') },
          },
        ],
        [{ type: 'text', id: 'steer-answer', text: 'answer after steer' }],
      ],
    });
    await wakeQuota(seeded.runId);
    await terminal(seeded.runId);

    const resumedCalls = harness.models.streamCalls.slice(callsBeforeWake);
    expect(resumedCalls.length).toBeGreaterThan(0);
    expect(
      resumedCalls.every(
        (call) => call.modelId === modelId && call.effort === 'high',
      ),
    ).toBe(true);
    expect(
      (await events(seeded.runId)).map((event) => event.eventType),
    ).toEqual(
      expect.arrayContaining([
        'run.suspended',
        'run.resumed',
        'run.quota_recovered',
        'run.delivered',
        'run.completed',
      ]),
    );

    const allEvents = await events(seeded.runId);

    const recovered = allEvents.find(
      (event) => event.eventType === 'run.quota_recovered',
    );

    const recoveryRead = allEvents.find(
      (event) =>
        event.eventType === 'tool.completed' &&
        isRecord(event.payload) &&
        event.payload['toolCallId'] === 'quota-recovery-read',
    );

    const delivery = allEvents.find(
      (event) => event.eventType === 'run.delivered',
    );

    expect(recovered).toBeDefined();
    expect(recoveryRead?.payload).toMatchObject({
      toolName: 'read',
      output: { status: 'success' },
    });
    expect(delivery).toBeDefined();
    expect(recoveryRead!.sequence).toBeLessThan(recovered!.sequence);
    expect(recoveryRead!.sequence).toBeLessThan(delivery!.sequence);
    expect(await run(seeded.runId)).toMatchObject({
      id: seeded.runId,
      status: 'completed',
      modelId,
      effort: 'high',
    });
    expect(
      await db((tx) =>
        new ChatDeliveriesRepository(tx).listPending(seeded.chatId, userId),
      ),
    ).toHaveLength(0);
  });

  it('excludes a two-day quota suspension from the 1800-second execution budget', async () => {
    const modelId = `quota-worker-budget-${randomUUID()}`;
    let failFirstRequest = true;
    harness.models.register(modelId, {
      kind: 'step-script',
      steps: [
        [
          {
            type: 'text',
            id: 'budget-answer',
            text: 'executed after the wait',
          },
        ],
      ],
      beforeStep: () => {
        if (failFirstRequest) {
          failFirstRequest = false;
          throw new ProviderFailure('weekly quota exhausted', {
            code: 'quota_exhausted',
            resetsAt: Date.now() + 2 * 24 * 60 * 60 * 1000,
          });
        }
      },
    });

    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      text: 'remain runnable after the two-day wait',
    });

    await dispatch(seeded, modelId);
    await waitFor(
      async () =>
        (await run(seeded.runId))?.status === 'awaiting_quota' || undefined,
      30_000,
      'the Run to enter its quota wait',
    );

    const runEventsNow = await events(seeded.runId);

    const started = runEventsNow.find(
      (event) => event.eventType === 'run.started',
    );

    const suspended = runEventsNow.find(
      (event) => event.eventType === 'run.suspended',
    );

    if (!started || !suspended)
      throw new Error('Expected start and suspension events');
    const suspendedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const startedAt = new Date(suspendedAt.getTime() - 600_000);

    // Tenants cannot update the append-only log. This owner-only fixture
    // transaction restores FORCE before commit; failure rolls back its DDL.
    await harness.db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE run_events NO FORCE ROW LEVEL SECURITY`);

      const agedSuspension = await tx
        .update(runEvents)
        .set({ createdAt: suspendedAt })
        .where(eq(runEvents.sequence, suspended.sequence))
        .returning({ createdAt: runEvents.createdAt });

      const agedStart = await tx
        .update(runEvents)
        .set({ createdAt: startedAt })
        .where(eq(runEvents.sequence, started.sequence))
        .returning({ createdAt: runEvents.createdAt });

      expect(agedSuspension).toEqual([{ createdAt: suspendedAt }]);
      expect(agedStart).toEqual([{ createdAt: startedAt }]);
      await tx.execute(sql`ALTER TABLE run_events FORCE ROW LEVEL SECURITY`);
    });
    await wakeQuota(seeded.runId);
    const resumed = await terminal(seeded.runId);

    expect(resumed).toMatchObject({ id: seeded.runId, status: 'completed' });
    expect(
      (await events(seeded.runId)).map((event) => event.eventType),
    ).toContain('run.completed');
    expect(
      harness.models.streamCalls.some((call) => call.modelId === modelId),
    ).toBe(true);
  });

  it('fails typed quota errors without parking when the reset exceeds the cap or is missing', async () => {
    for (const resetsAt of [Date.now() + 20 * 24 * 60 * 60 * 1000, undefined]) {
      const modelId = `quota-worker-unwaitable-${randomUUID()}`;
      harness.models.register(modelId, {
        kind: 'step-script',
        steps: [[{ type: 'text', id: 'unused', text: 'no answer' }]],
        beforeStep: () => {
          throw new ProviderFailure('quota unavailable', {
            code: 'quota_exhausted',
            ...(resetsAt !== undefined && { resetsAt }),
          });
        },
      });

      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId,
        text: 'fail without a usable wait',
      });

      await dispatch(seeded, modelId);
      const failed = await terminal(seeded.runId);

      expect(failed).toMatchObject({ id: seeded.runId, status: 'failed' });
      expect(failed?.error).toMatchObject({ code: 'quota_exhausted' });

      const runEventTypes = (await events(seeded.runId)).map(
        (event) => event.eventType,
      );

      expect(runEventTypes).toContain('run.failed');
      expect(runEventTypes).not.toContain('run.suspended');
      expect(failed?.status).not.toBe('awaiting_quota');
    }
  });
});
