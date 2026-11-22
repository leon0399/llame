import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { isRecord } from '@workspace/runtime-safety';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { runs, type AwaitingQuota } from '../db/schema';
import { clearActiveRunSlot } from '../chats/chat-admission';
import { type MessagePart } from '../chats/context-builder';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { createProviderFailureItem } from '../chats/provider-failure-notice';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { recordJobSettlementNotice } from '../jobs/job-notices';
import {
  answer,
  flatten,
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';
import { RunsController } from './runs.controller';
import { RUNS_QUEUE } from './run-queues';
import { RunWaitService } from './run-wait.service';
import { retryRunTransaction } from './run-transaction';
import { createUser, seedLiveChatJob } from './worker-harness';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'quota-wait.integration.test.ts requires the integration database',
  );
}

describe('quota wait lifecycle persistence', () => {
  const queueSchema = `quota_wait_${randomUUID().replaceAll('-', '')}`;

  const fx = useSegmentsFixture('quota-wait', {
    allowedTools: [],
    runsConcurrency: null,
    queueSchema,
  });

  async function seedActiveRun(): Promise<QuotaTestRun> {
    const seeded = await fx.seed();
    const attemptId = randomUUID();
    await fx.db((tx) =>
      tx
        .update(runs)
        .set({ status: 'running_model', activeAttemptId: attemptId })
        .where(eq(runs.id, seeded.runId)),
    );

    return { ...seeded, attemptId };
  }

  type QuotaTestRun = SeededRun & { attemptId: string };

  function quotaWait(
    wakeAt = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
  ): AwaitingQuota {
    const resetsAt = new Date(
      Date.now() + 8 * 24 * 60 * 60 * 1000 - 70_000,
    ).toISOString();

    return {
      kind: 'quota',
      failureClass: 'quota_exhausted',
      resetsAt,
      wakeAt,
      resumeAt: 'request',
      waitCount: 1,
    };
  }

  async function suspend(seeded: QuotaTestRun, awaiting = quotaWait()) {
    return fx.harness.moduleRef.get(RunWaitService).suspendForQuota({
      runId: seeded.runId,
      chatId: seeded.chatId,
      userId: fx.userId,
      attemptId: seeded.attemptId,
      awaiting,
      parts: [{ type: 'text', text: 'checkpoint before failed send' }],
      steps: { 'step-1': 2 },
    });
  }

  it('attempt-fences the checkpoint and persists its exact quota job identity', async () => {
    const seeded = await seedActiveRun();
    const wrongAttempt = { ...seeded, attemptId: randomUUID() };

    await expect(suspend(wrongAttempt)).resolves.toEqual({
      kind: 'ready',
      cause: 'cancelled',
    });
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'running_model',
    });
    expect(await fx.types(seeded.runId)).not.toContain('run.suspended');

    const awaiting = quotaWait();
    await expect(suspend(seeded, awaiting)).resolves.toEqual({
      kind: 'suspended',
    });
    const run = await fx.run(seeded.runId);
    expect(run).toMatchObject({
      status: 'awaiting_quota',
      awaiting,
      wakeGeneration: 1,
      activeAttemptId: null,
    });

    if (!run?.currentJobId)
      throw new Error('Quota wait did not persist its deadline job');
    expect(await fx.harness.queue.jobState(RUNS_QUEUE, run.currentJobId)).toBe(
      'queued',
    );
    expect(
      (await fx.events(seeded.runId)).filter(
        (event) => event.eventType === 'run.suspended',
      ),
    ).toMatchObject([
      {
        eventType: 'run.suspended',
        payload: {
          kind: 'quota',
          attemptId: seeded.attemptId,
          generation: 1,
          failureClass: awaiting.failureClass,
          resetsAt: awaiting.resetsAt,
          wakeAt: awaiting.wakeAt,
          resumeAt: awaiting.resumeAt,
          waitCount: awaiting.waitCount,
          parts: [{ type: 'text', text: 'checkpoint before failed send' }],
          steps: { 'step-1': 2 },
        },
      },
    ]);

    const [{ start_after: startAfter, keep_until: keepUntil }] = z
      .tuple([
        z.object({ start_after: z.coerce.date(), keep_until: z.coerce.date() }),
      ])
      .parse(
        await fx.harness.db.execute(sql`
      SELECT start_after, keep_until FROM ${sql.identifier(queueSchema)}.job WHERE id = ${run.currentJobId}
    `),
      );

    expect(startAfter.toISOString()).toBe(awaiting.wakeAt);
    expect(keepUntil.getTime()).toBeGreaterThan(startAfter.getTime());
  });

  it('lets cancellation and the due deadline race to one resume event', async () => {
    const seeded = await seedActiveRun();
    const awaiting = quotaWait(new Date(Date.now() - 1000).toISOString());
    await suspend(seeded, awaiting);
    const waiting = await fx.run(seeded.runId);

    if (!waiting?.currentJobId)
      throw new Error('Quota wait did not persist its deadline job');

    const controller = fx.harness.moduleRef.get(RunsController, {
      strict: false,
    });

    await Promise.all([
      controller.updateRun(fx.userId, seeded.runId, { status: 'cancelled' }),
      retryRunTransaction(() =>
        fx.db((tx) =>
          fx.harness.moduleRef.get(RunWaitService).wakeInTransaction(tx, {
            runId: seeded.runId,
            userId: fx.userId,
            generation: waiting.wakeGeneration,
            cause: 'timeout',
            deadlineJobId: waiting.currentJobId!,
          }),
        ),
      ),
    ]);
    const events = await fx.events(seeded.runId);
    expect(
      events.filter((event) => event.eventType === 'run.resumed'),
    ).toHaveLength(1);
    expect(await fx.run(seeded.runId)).toMatchObject({ status: 'queued' });
  });

  it('keeps steering, interrupt, and job notices pending and rejects a plain send', async () => {
    const seeded = await seedActiveRun();
    await suspend(seeded);

    const steerIds = await fx.storeItems(
      seeded.chatId,
      ['steer'],
      'steer',
      seeded.runId,
    );

    const interruptIds = await fx.storeItems(
      seeded.chatId,
      ['interrupt'],
      'interrupt',
      seeded.runId,
    );

    const job = await fx.db((tx) =>
      seedLiveChatJob({
        tx,
        userId: fx.userId,
        modelId: seeded.modelId,
        run: seeded,
      }),
    );

    await fx.db((tx) => recordJobSettlementNotice(tx, job));

    expect(await fx.itemState(steerIds[0])).toMatchObject({
      state: 'pending',
      mode: 'steer',
    });
    expect(await fx.itemState(interruptIds[0])).toMatchObject({
      state: 'pending',
      mode: 'interrupt',
    });

    const notices = await fx.db((tx) =>
      new ChatDeliveriesRepository(tx).listPending(seeded.chatId, fx.userId),
    );

    expect(
      notices.some(
        (notice) => notice.mode === 'notice' && notice.state === 'pending',
      ),
    ).toBe(true);
    await expect(
      fx.db((tx) =>
        clearActiveRunSlot({
          tx,
          chatId: seeded.chatId,
          userId: fx.userId,
          dispatch: fx.harness.dispatch,
          instanceConfig: fx.harness.moduleRef.get(InstanceConfigService, {
            strict: false,
          }),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'awaiting_quota',
    });
  });
  it('does not expose an awaiting quota Run to another owner', async () => {
    const seeded = await seedActiveRun();
    await suspend(seeded);

    const otherUserId = await createUser(
      fx.harness.db,
      'quota-wait-other-owner',
    );

    const controller = fx.harness.moduleRef.get(RunsController, {
      strict: false,
    });

    await expect(
      controller.getRun(otherUserId, seeded.runId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * The quota wait a failed send enters after a started call
 * (continue-after-broken-send D6): the suspension is the only write that
 * names the cut, and the woken claim sends the next step from its checkpoint.
 */
describe('a quota wait after a started tool call', () => {
  const fx = useSegmentsFixture('quota-started-call', {
    allowedTools: ['read'],
    runsConcurrency: 1,
    quotaWaitMaxSeconds: 7 * 24 * 60 * 60,
    localMachine: 'quota-started-call-host',
    queueSchema: `quota_started_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
  });

  type ParkedRun = SeededRun & { attemptId: string };

  /** The checkpoint the park stores: the kept parts, then the notice. */
  function keptParts(runId: string): Array<MessagePart> {
    return [
      { type: 'text', text: 'Before the call. ', step: 0 },
      {
        type: 'tool-read',
        toolCallId: 'kept-read',
        state: 'output-available',
        input: { path: 'notes.txt' },
        output: { status: 'success', text: 'kept result' },
        outcome: 'success',
        step: 0,
      },
      createProviderFailureItem({ runId, failureClass: 'quota_exhausted' }),
    ];
  }

  /** A Run the park suspends: an active attempt that streamed the call. */
  async function activeRun(): Promise<ParkedRun> {
    const seeded = await fx.seed();
    const attemptId = randomUUID();

    await fx.db((tx) =>
      tx
        .update(runs)
        .set({ status: 'running_model', activeAttemptId: attemptId })
        .where(eq(runs.id, seeded.runId)),
    );

    return { ...seeded, attemptId };
  }

  function awaitingQuota(waitCount = 1): AwaitingQuota {
    return {
      kind: 'quota',
      failureClass: 'quota_exhausted',
      resetsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      wakeAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
      resumeAt: 'request',
      waitCount,
    };
  }

  function suspend(
    seeded: ParkedRun,
    parts: Array<MessagePart>,
    awaiting = awaitingQuota(),
  ) {
    return fx.harness.moduleRef.get(RunWaitService).suspendForQuota({
      runId: seeded.runId,
      chatId: seeded.chatId,
      userId: fx.userId,
      attemptId: seeded.attemptId,
      awaiting,
      parts,
      steps: {},
      // The kept part of the failed step is one completed step.
      stepBudgetUsed: 1,
      superseded: { fromSequence: 3, step: 0 },
    });
  }

  /** Advances only the durable wake time, then wakes the Run as its deadline job. */
  async function wakeQuota(runId: string): Promise<void> {
    const waiting = await fx.run(runId);
    const awaiting = waiting?.awaiting;

    if (
      !waiting ||
      waiting.status !== 'awaiting_quota' ||
      awaiting?.kind !== 'quota'
    ) {
      throw new Error('Expected the Run to be suspended for quota');
    }

    await fx.db((tx) =>
      tx
        .update(runs)
        .set({ awaiting: { ...awaiting, wakeAt: new Date(0).toISOString() } })
        .where(eq(runs.id, runId)),
    );
    await fx.db((tx) =>
      fx.harness.moduleRef.get(RunWaitService).wakeInTransaction(tx, {
        runId,
        userId: fx.userId,
        generation: waiting.wakeGeneration,
        cause: 'timeout',
      }),
    );
  }

  /** The prompts the woken attempt sent from here on. */
  function promptsSince(index: number) {
    return fx.harness.models.prompts
      .slice(index)
      .map((prompt) => flatten(prompt).join('\n'));
  }

  it('The kept parts of a failed send survive the wait', async () => {
    const seeded = await activeRun();
    const parts = keptParts(seeded.runId);

    await expect(suspend(seeded, parts)).resolves.toEqual({
      kind: 'suspended',
    });

    const events = await fx.events(seeded.runId);

    const suspension = events.find(
      (event) => event.eventType === 'run.suspended',
    );

    const cut = events.findIndex(
      (event) => event.eventType === 'model.superseded',
    );

    const parked = events.findIndex(
      (event) => event.eventType === 'run.suspended',
    );

    // One entry transaction stores the kept parts and the notice, and names
    // the cut before the suspension.
    expect(suspension?.payload).toMatchObject({
      kind: 'quota',
      parts,
      steps: {},
      stepBudgetUsed: 1,
    });
    expect(events[cut]?.payload).toMatchObject({
      fromSequence: 3,
      step: 0,
    });
    expect(cut).toBeGreaterThanOrEqual(0);
    expect(cut).toBeLessThan(parked);
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'awaiting_quota',
    });
  });

  it('A checkpoint holds the settled tool part', async () => {
    const seeded = await activeRun();
    const parts = keptParts(seeded.runId).slice(1);

    await suspend(seeded, parts);

    const suspension = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.suspended',
    );

    const stored =
      isRecord(suspension?.payload) &&
      Array.isArray(suspension.payload['parts'])
        ? suspension.payload['parts'].filter(isRecord)
        : [];

    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      toolCallId: 'kept-read',
      state: 'output-available',
      output: { status: 'success', text: 'kept result' },
    });
    expect(stored[1]).toMatchObject({
      type: 'data-context',
      data: { producer: 'provider-failure', form: 'notice' },
    });
  });

  it('A woken Run continues after a tool call', async () => {
    const seeded = await activeRun();
    await suspend(seeded, keptParts(seeded.runId));

    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [answer('after the wait')],
    });
    const promptsBefore = fx.harness.models.prompts.length;

    await wakeQuota(seeded.runId);
    await fx.terminal(seeded.runId);

    // The woken request is the next step: it carries the read result and the
    // notice, and it re-runs nothing.
    const prompts = promptsSince(promptsBefore);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('tool:tool-result');
    expect(prompts[0]).toContain('a usage limit');
    expect(
      JSON.stringify(fx.harness.models.prompts.slice(promptsBefore)[0]),
    ).toContain('kept result');
    const events = await fx.events(seeded.runId);
    expect(
      events.filter((event) => event.eventType === 'tool.requested'),
    ).toEqual([]);
    expect(events.map((event) => event.eventType)).toContain(
      'run.quota_recovered',
    );
    expect(await fx.run(seeded.runId)).toMatchObject({ status: 'completed' });
  });

  it('A steer during a wait after a tool call', async () => {
    const seeded = await activeRun();
    await suspend(seeded, keptParts(seeded.runId));

    const steerIds = await fx.storeItems(
      seeded.chatId,
      ['steer now'],
      'steer',
      seeded.runId,
    );

    // A steer does not wake the wait.
    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'awaiting_quota',
    });
    expect(await fx.itemState(steerIds[0])).toMatchObject({
      state: 'pending',
      mode: 'steer',
    });

    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [answer('after the wait')],
    });
    const promptsBefore = fx.harness.models.prompts.length;

    await wakeQuota(seeded.runId);
    await fx.terminal(seeded.runId);

    const prompts = promptsSince(promptsBefore);

    const events = await fx.events(seeded.runId);

    const delivered = events.findIndex(
      (event) => event.eventType === 'run.delivered',
    );

    // The steer is delivered at the boundary before the next step: the
    // delivery precedes that step's request, and the request carries the
    // steer with the kept result and the notice.
    expect(delivered).toBeGreaterThanOrEqual(0);
    expect(
      events.findIndex(
        (event, index) =>
          index > delivered && event.eventType === 'model.requested',
      ),
    ).toBeGreaterThan(delivered);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('steer now');
    expect(prompts[0]).toContain('tool:tool-result');
    expect(prompts[0]).toContain('a usage limit');
    expect(
      JSON.stringify(fx.harness.models.prompts.slice(promptsBefore)[0]),
    ).toContain('kept result');
    // The checkpoint's call is carried, never run again.
    expect(
      events.filter((event) => event.eventType === 'tool.requested'),
    ).toEqual([]);
    expect(await fx.items(seeded.chatId)).toHaveLength(0);
  });
});
