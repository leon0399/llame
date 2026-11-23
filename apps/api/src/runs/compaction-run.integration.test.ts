import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { ProviderFailure } from '../models/provider-failure/provider-failure';
import { CompactionService } from '../compaction/compaction.service';
import { ModelsService } from '../models/models.service';
import type { ModelClient } from '../models/model-client';
import { MessagesRepository } from '../chats/messages-repository';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { settleBashJob } from '../jobs/bash-job-store';
import { workerInstances, runs, type ChatJob } from '../db/schema';
import { RunWaitService } from './run-wait.service';
import { JobNoticeRunService } from './job-notice-run.service';
import { TenantDbService } from '../db/tenant-db.service';
import { asDouble, waitFor } from '../testing/support';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import {
  bootWorkerHarness,
  createUser,
  seedRun,
  type WorkerHarness,
} from './worker-harness';
import { startItemRun } from './queue-promotion';

async function completeSourceTurn(
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

async function waitForRun(
  harness: WorkerHarness,
  userId: string,
  runId: string,
  status: 'completed' | 'cancelled' | 'failed',
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

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'compaction-run.integration.test.ts requires the integration database',
  );
}

describe('Compaction Run execution', () => {
  let harness: WorkerHarness;
  let userId: string;
  let queueSchema: string;

  beforeAll(async () => {
    queueSchema = `llame_t_compact_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    harness = await bootWorkerHarness({ runsConcurrency: 1, queueSchema });
    userId = await createUser(harness.db, `compaction-${randomUUID()}`);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('publishes a checkpoint without a reply and the next turn reads only the checkpoint', async () => {
    const turnModel = `compact-turn-${randomUUID()}`;
    const compactionModel = `compact-owner-${randomUUID()}`;
    const originalText = 'old user history that must be summarized';
    const summaryText = 'persisted operational summary';

    harness.models.register(turnModel, {
      kind: 'complete',
      text: 'completed source answer',
    });
    harness.models.register(compactionModel, {
      kind: 'complete',
      text: summaryText,
    });

    const source = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId: turnModel,
      text: originalText,
    });

    await harness.dispatch.dispatch({
      runId: source.runId,
      chatId: source.chatId,
      userId,
      modelId: turnModel,
      userMessage: source.userMessage,
    });
    await waitForRun(harness, userId, source.runId, 'completed');

    const compactRun = await createCompactionRun(
      harness.tenantDb,
      source.chatId,
      userId,
      compactionModel,
    );

    await harness.dispatch.dispatch({
      runId: compactRun.id,
      chatId: source.chatId,
      userId,
      modelId: compactionModel,
    });
    await waitForRun(harness, userId, compactRun.id, 'completed');

    const persisted = await harness.tenantDb.runAs(userId, async (tx) => ({
      run: await new RunsRepository(tx).findById(compactRun.id, userId),
      messages: await new MessagesRepository(tx).findByChatId(
        source.chatId,
        userId,
      ),
    }));

    const checkpoint = persisted.messages.find(
      (message) => message.role === 'checkpoint',
    );

    expect(persisted.run).toMatchObject({
      kind: 'compaction',
      messageId: null,
      status: 'completed',
    });
    expect(checkpoint?.parts[0]).toMatchObject({
      data: { payload: { summary: summaryText } },
    });
    expect(
      persisted.messages.filter((message) => message.role === 'assistant'),
    ).toHaveLength(1);

    const next = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId: turnModel,
      chatId: source.chatId,
      text: 'continue after compaction',
    });

    await harness.dispatch.dispatch({
      runId: next.runId,
      chatId: next.chatId,
      userId,
      modelId: turnModel,
      userMessage: next.userMessage,
    });
    await waitForRun(harness, userId, next.runId, 'completed');

    const lastPrompt = harness.models.prompts.at(-1);
    const serializedPrompt = JSON.stringify(lastPrompt);

    expect(serializedPrompt).toContain(summaryText);
    expect(serializedPrompt).not.toContain(originalText);
  });

  it('holds a result during a compaction Run and starts its idle-Chat notice Run at completion', async () => {
    const turnModel = `compact-notice-turn-${randomUUID()}`;
    const compactModel = `compact-notice-run-${randomUUID()}`;

    harness.models.register(turnModel, {
      kind: 'complete',
      text: 'turn answer',
    });
    harness.models.register(compactModel, {
      kind: 'complete',
      text: 'notice-test-summary',
      delayMs: 300,
    });

    const source = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId: turnModel,
      text: 'notice source turn',
    });

    await harness.dispatch.dispatch({
      runId: source.runId,
      chatId: source.chatId,
      userId,
      modelId: turnModel,
      userMessage: source.userMessage,
    });
    await waitForRun(harness, userId, source.runId, 'completed');

    const compaction = await createCompactionRun(
      harness.tenantDb,
      source.chatId,
      userId,
      compactModel,
    );

    await harness.dispatch.dispatch({
      runId: compaction.id,
      chatId: source.chatId,
      userId,
      modelId: compactModel,
    });
    await waitFor(
      () =>
        harness.models.streamCalls.some(
          ({ modelId }) => modelId === compactModel,
        ) || undefined,
      15_000,
      'the compaction summary request to start',
    );

    const job = await createRunningJob({
      tenantDb: harness.tenantDb,
      chatId: source.chatId,
      ownerUserId: userId,
      runId: source.runId,
      modelId: turnModel,
    });

    await settleNoticeJob(harness, job, 'result-during-compaction');

    const held = await harness.tenantDb.runAs(userId, (tx) =>
      new ChatDeliveriesRepository(tx).listPending(source.chatId, userId),
    );

    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      producer: 'job',
      mode: 'notice',
      state: 'pending',
    });

    await waitFor(
      async () => {
        const pending = await harness.tenantDb.runAs(userId, (tx) =>
          new ChatDeliveriesRepository(tx).listPending(source.chatId, userId),
        );

        return pending.length === 0 &&
          JSON.stringify(harness.models.prompts).includes(
            'result-during-compaction',
          )
          ? true
          : undefined;
      },
      15_000,
      'the idle-Chat notice Run to adopt the held result',
    );

    expect(JSON.stringify(harness.models.prompts)).toContain(
      'result-during-compaction',
    );
  });

  it('leaves a lost job notice pending after a compaction Run', async () => {
    const turnModel = `compact-lost-turn-${randomUUID()}`;
    const compactModel = `compact-lost-run-${randomUUID()}`;
    harness.models.register(turnModel, {
      kind: 'complete',
      text: 'turn answer',
    });
    harness.models.register(compactModel, {
      kind: 'complete',
      text: 'lost-notice-summary',
      delayMs: 300,
    });

    const source = await completeSourceTurn(
      harness,
      userId,
      turnModel,
      'lost notice source',
    );

    const compaction = await createCompactionRun(
      harness.tenantDb,
      source.chatId,
      userId,
      compactModel,
    );

    await harness.dispatch.dispatch({
      runId: compaction.id,
      chatId: source.chatId,
      userId,
      modelId: compactModel,
    });
    await waitFor(
      () =>
        harness.models.streamCalls.some(
          ({ modelId }) => modelId === compactModel,
        ) || undefined,
      15_000,
      'the compaction summary request to start',
    );

    const job = await createRunningJob({
      tenantDb: harness.tenantDb,
      chatId: source.chatId,
      ownerUserId: userId,
      runId: source.runId,
      modelId: turnModel,
    });

    await settleBashJob(
      harness.tenantDb,
      job,
      {
        output: {
          stdout: 'lost job result',
          stderr: '',
          truncated: false,
          truncatedStreams: { stdout: false, stderr: false },
        },
        settlement: { state: 'lost', result: { outcomeUnknown: true } },
        offsets: { stdout: 0, stderr: 0 },
      },
      {
        maxBytes: 65_536,
        hostFiles: false,
        noticeRuns: harness.moduleRef.get(JobNoticeRunService),
      },
    );

    await waitForRun(harness, userId, compaction.id, 'completed');

    const state = await harness.tenantDb.runAs(userId, async (tx) => ({
      pending: await new ChatDeliveriesRepository(tx).listPending(
        source.chatId,
        userId,
      ),
      latest: await new RunsRepository(tx).findLatestByChatId(
        source.chatId,
        userId,
      ),
    }));

    expect(state.pending).toMatchObject([
      { producer: 'job', mode: 'notice', state: 'pending' },
    ]);
    expect(state.latest?.id).toBe(compaction.id);
  });

  it('A completed compaction Run promotes the next item', async () => {
    const model = `compact-promote-${randomUUID()}`;
    const sourceModel = `compact-promote-source-${randomUUID()}`;
    harness.models.register(sourceModel, { kind: 'complete', text: 'reply' });
    harness.models.register(model, {
      kind: 'complete',
      text: 'summary or reply',
    });

    const source = await completeSourceTurn(
      harness,
      userId,
      sourceModel,
      'source history',
    );

    const deliveryId = randomUUID();
    await harness.tenantDb.runAs(userId, (tx) =>
      new ChatDeliveriesRepository(tx).insertPending({
        id: deliveryId,
        chatId: source.chatId,
        ownerUserId: userId,
        mode: 'queue',
        parts: [{ type: 'text', text: 'queued after compaction' }],
        settings: { selector: model, permissionMode: 'default' },
      }),
    );

    const compact = await createCompactionRun(
      harness.tenantDb,
      source.chatId,
      userId,
      model,
    );

    await harness.dispatch.dispatch({
      runId: compact.id,
      chatId: source.chatId,
      userId,
      modelId: model,
    });

    const promoted = await waitFor(
      async () => {
        const delivery = await harness.tenantDb.runAs(userId, (tx) =>
          new ChatDeliveriesRepository(tx).findById(deliveryId, userId),
        );

        const run = delivery?.runId
          ? await harness.tenantDb.runAs(userId, (tx) =>
              new RunsRepository(tx).findById(delivery.runId!, userId),
            )
          : undefined;

        return delivery?.state === 'delivered' && run?.status === 'completed'
          ? run
          : undefined;
      },
      15_000,
      'the queued item to be promoted and complete',
    );

    expect(promoted).toMatchObject({ status: 'completed', kind: 'turn' });
  });
  it('Stop during a compaction', async () => {
    const model = `compact-stop-${randomUUID()}`;
    const sourceModel = `compact-stop-source-${randomUUID()}`;
    harness.models.register(sourceModel, { kind: 'complete', text: 'reply' });
    harness.models.register(model, { kind: 'hang' });

    const source = await completeSourceTurn(
      harness,
      userId,
      sourceModel,
      'source history',
    );

    const compact = await createCompactionRun(
      harness.tenantDb,
      source.chatId,
      userId,
      model,
    );

    await harness.dispatch.dispatch({
      runId: compact.id,
      chatId: source.chatId,
      userId,
      modelId: model,
    });
    await waitFor(
      () =>
        harness.models.streamCalls.some(({ modelId }) => modelId === model) ||
        undefined,
      15_000,
      'the compaction summary request to start',
    );
    await harness.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).requestCancel(compact.id, userId),
    );

    await waitForRun(harness, userId, compact.id, 'cancelled');

    const messages = await harness.tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(source.chatId, userId),
    );

    expect(
      messages.filter((message) => message.role === 'checkpoint'),
    ).toHaveLength(0);
  });
  it('settles cancelled when cancellation is recorded after the summary returns', async () => {
    const sourceModel = `compact-late-cancel-source-${randomUUID()}`;
    const compactModel = `compact-late-cancel-run-${randomUUID()}`;
    harness.models.register(sourceModel, { kind: 'complete', text: 'reply' });
    harness.models.register(compactModel, {
      kind: 'complete',
      text: 'late-cancel-summary',
    });

    const source = await completeSourceTurn(
      harness,
      userId,
      sourceModel,
      'late cancellation history',
    );

    const compact = await createCompactionRun(
      harness.tenantDb,
      source.chatId,
      userId,
      compactModel,
    );

    const compaction = asDouble<CompactionService>(
      harness.moduleRef.get(CompactionService),
    );

    const originalCompaction = new CompactionService(
      asDouble<TenantDbService>(harness.moduleRef.get(TenantDbService)),
      asDouble<ModelsService>(harness.moduleRef.get(ModelsService)),
    );

    const summarySpy = vi
      .spyOn(compaction, 'summarizeCheckpoint')
      .mockImplementation(async (input) => {
        const summary = await originalCompaction.summarizeCheckpoint(input);

        await harness.tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).requestCancel(compact.id, userId),
        );

        return summary;
      });

    await harness.dispatch.dispatch({
      runId: compact.id,
      chatId: source.chatId,
      userId,
      modelId: compactModel,
    });
    await waitForRun(harness, userId, compact.id, 'cancelled');
    summarySpy.mockRestore();

    const messages = await harness.tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(source.chatId, userId),
    );

    expect(
      messages.filter((message) => message.role === 'checkpoint'),
    ).toHaveLength(0);
  });

  it('waits and resumes the same manual compaction Run after a quota wake', async () => {
    const sourceModel = `compact-quota-source-${randomUUID()}`;
    const compactModel = `compact-quota-run-${randomUUID()}`;
    harness.models.register(sourceModel, { kind: 'complete', text: 'reply' });
    harness.models.register(compactModel, {
      kind: 'complete',
      text: 'resumed summary',
    });

    const source = await completeSourceTurn(
      harness,
      userId,
      sourceModel,
      'history requiring compaction',
    );

    const compact = await createCompactionRun(
      harness.tenantDb,
      source.chatId,
      userId,
      compactModel,
    );

    const failure = new ProviderFailure('weekly quota exhausted', {
      code: 'quota_exhausted',
      resetsAt: Date.now() + 120_000,
    });

    const client = harness.models.createClient(compactModel);
    let failFirstSummary = true;

    const clientSpy = vi
      .spyOn(harness.models, 'createClient')
      .mockImplementation((): ModelClient => ({
        ...client,
        streamText: (input) => {
          if (failFirstSummary) {
            failFirstSummary = false;
            void input.onError?.({ error: failure });
          }

          return client.streamText(input);
        },
      }));

    try {
      await harness.dispatch.dispatch({
        runId: compact.id,
        chatId: source.chatId,
        userId,
        modelId: compactModel,
      });

      const waiting = await waitFor(
        () =>
          harness.tenantDb
            .runAs(userId, (tx) =>
              new RunsRepository(tx).findById(compact.id, userId),
            )
            .then((run) =>
              run?.status === 'awaiting_quota' &&
              run.awaiting?.kind === 'quota' &&
              run.awaiting.resumeAt === 'compactionRun'
                ? run
                : undefined,
            ),
        30_000,
        'manual compaction to await quota',
      );

      expect(waiting).toMatchObject({
        id: compact.id,
        kind: 'compaction',
        chatId: source.chatId,
        userId,
        modelId: compactModel,
        messageId: null,
        awaiting: { kind: 'quota', resumeAt: 'compactionRun', waitCount: 1 },
      });

      if (waiting.awaiting?.kind !== 'quota')
        throw new Error(
          'Expected a quota wait before waking the compaction Run',
        );

      const awaiting = waiting.awaiting;

      await harness.tenantDb.runAs(userId, (tx) =>
        tx
          .update(runs)
          .set({
            awaiting: { ...awaiting, wakeAt: new Date(0).toISOString() },
          })
          .where(eq(runs.id, compact.id)),
      );
      await harness.tenantDb.runAs(userId, (tx) =>
        harness.moduleRef.get(RunWaitService).wakeInTransaction(tx, {
          runId: compact.id,
          userId,
          generation: waiting.wakeGeneration,
          cause: 'timeout',
        }),
      );
      await waitForRun(harness, userId, compact.id, 'completed');
    } finally {
      clientSpy.mockRestore();
    }

    const persisted = await harness.tenantDb.runAs(userId, async (tx) => ({
      run: await new RunsRepository(tx).findById(compact.id, userId),
      events: await new RunEventsRepository(tx).listByRunId(compact.id, userId),
    }));

    expect(persisted.run).toMatchObject({
      id: compact.id,
      kind: 'compaction',
      chatId: source.chatId,
      userId,
      modelId: compactModel,
      status: 'completed',
    });
    expect(
      persisted.events.find(
        (event) => event.eventType === 'run.quota_recovered',
      )?.payload,
    ).toMatchObject({
      generation: persisted.run?.wakeGeneration,
      resumeAt: 'compactionRun',
    });
  });

  it('persists a typed provider failure on a failed compaction Run', async () => {
    const sourceModel = `compact-auth-source-${randomUUID()}`;
    const compactModel = `compact-auth-run-${randomUUID()}`;
    harness.models.register(sourceModel, { kind: 'complete', text: 'reply' });
    harness.models.register(compactModel, {
      kind: 'complete',
      text: 'summary',
    });

    const source = await completeSourceTurn(
      harness,
      userId,
      sourceModel,
      'history requiring compaction',
    );

    const compact = await createCompactionRun(
      harness.tenantDb,
      source.chatId,
      userId,
      compactModel,
    );

    const failure = new ProviderFailure('authentication failed', {
      code: 'auth',
    });

    const client = harness.models.createClient(compactModel);

    const clientSpy = vi
      .spyOn(harness.models, 'createClient')
      .mockImplementation((): ModelClient => {
        return {
          ...client,
          streamText: (input) => {
            void input.onError?.({ error: failure });

            return client.streamText(input);
          },
        };
      });

    try {
      await harness.dispatch.dispatch({
        runId: compact.id,
        chatId: source.chatId,
        userId,
        modelId: compactModel,
      });
      await waitForRun(harness, userId, compact.id, 'failed');
    } finally {
      clientSpy.mockRestore();
    }

    const persisted = await harness.tenantDb.runAs(userId, async (tx) => ({
      run: await new RunsRepository(tx).findById(compact.id, userId),
      events: await new RunEventsRepository(tx).listByRunId(compact.id, userId),
    }));

    expect(persisted.run?.error).toMatchObject({
      message: failure.message,
      code: 'auth',
    });
    expect(
      persisted.events.find((event) => event.eventType === 'run.failed')
        ?.payload,
    ).toMatchObject({
      status: 'failed',
      message: failure.message,
      code: 'auth',
    });
  });

  it('A compaction Run survives a worker restart', async () => {
    const model = `compact-restart-${randomUUID()}`;
    const sourceModel = `compact-restart-source-${randomUUID()}`;
    harness.models.register(sourceModel, { kind: 'complete', text: 'reply' });
    harness.models.register(model, { kind: 'hang' });

    const source = await completeSourceTurn(
      harness,
      userId,
      sourceModel,
      'restart history',
    );

    const compact = await createCompactionRun(
      harness.tenantDb,
      source.chatId,
      userId,
      model,
    );

    await harness.dispatch.dispatch({
      runId: compact.id,
      chatId: source.chatId,
      userId,
      modelId: model,
    });
    await waitFor(
      () =>
        harness.models.streamCalls.some(({ modelId }) => modelId === model) ||
        undefined,
      15_000,
      'the compaction summary request to start',
    );

    await harness.close();
    harness = await bootWorkerHarness({
      runsConcurrency: 1,
      queueSchema,
      beforeInit: (models) =>
        models.register(model, {
          kind: 'complete',
          text: 'restarted summary',
        }),
    });
    await waitForRun(harness, userId, compact.id, 'completed');

    const messages = await harness.tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(source.chatId, userId),
    );

    expect(
      messages.filter((message) => message.role === 'checkpoint'),
    ).toHaveLength(1);
  });

  it('two queued compacts run in a row; the second creates no checkpoint', async () => {
    const turnModel = `compact-empty-turn-${randomUUID()}`;
    const compactionModel = `compact-empty-${randomUUID()}`;
    harness.models.register(turnModel, {
      kind: 'complete',
      text: 'source answer',
    });
    harness.models.register(compactionModel, {
      kind: 'complete',
      text: 'first summary',
    });

    const source = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId: turnModel,
      text: 'source history',
    });

    await harness.dispatch.dispatch({
      runId: source.runId,
      chatId: source.chatId,
      userId,
      modelId: turnModel,
      userMessage: source.userMessage,
    });
    await waitForRun(harness, userId, source.runId, 'completed');

    const queued = await harness.tenantDb.runAs(userId, async (tx) => {
      const deliveries = new ChatDeliveriesRepository(tx);

      return Promise.all(
        [1, 2].map((index) =>
          deliveries.insertPending({
            id: randomUUID(),
            chatId: source.chatId,
            ownerUserId: userId,
            mode: 'queue',
            parts: [{ type: 'text', text: `/compact queued ${index}` }],
            settings: {
              selector: compactionModel,
              permissionMode: 'default',
            },
          }),
        ),
      );
    });

    const [firstItem, secondItem] = queued;

    if (!firstItem || !secondItem) throw new Error('Expected queued compacts.');

    const first = await harness.tenantDb.runAs(userId, (tx) =>
      startItemRun(tx, firstItem, {
        selector: compactionModel,
        modelId: compactionModel,
        effort: undefined,
        permissionMode: 'default',
        selectionRevision: null,
      }),
    );

    if (!first) throw new Error('The first queued compact did not start.');

    await harness.dispatch.dispatch(first.job);
    await waitForRun(harness, userId, first.job.runId, 'completed');

    const secondDelivery = await harness.tenantDb.runAs(userId, (tx) =>
      new ChatDeliveriesRepository(tx).findById(secondItem.id, userId),
    );

    const secondRunId = secondDelivery?.runId;

    if (!secondRunId)
      throw new Error('The second queued compact did not start.');

    await waitForRun(harness, userId, secondRunId, 'completed');

    const state = await harness.tenantDb.runAs(userId, async (tx) => ({
      second: await new RunsRepository(tx).findById(secondRunId, userId),
      messages: await new MessagesRepository(tx).findByChatId(
        source.chatId,
        userId,
      ),
    }));

    expect(state.second).toMatchObject({
      kind: 'compaction',
      status: 'completed',
    });
    expect(
      state.messages.filter((message) => message.role === 'checkpoint'),
    ).toHaveLength(1);
  });
});

async function createCompactionRun(
  tenantDb: TenantDbService,
  chatId: string,
  userId: string,
  modelId: string,
) {
  return tenantDb.runAs(userId, async (tx) => {
    const run = await new RunsRepository(tx).create({
      chatId,
      messageId: null,
      userId,
      modelId,
      kind: 'compaction',
    });

    await new RunEventsRepository(tx).append(run.id, 'run.created', {
      chatId,
      messageId: null,
      compaction: { focus: null },
    });

    return run;
  });
}

async function createRunningJob(input: {
  tenantDb: TenantDbService;
  chatId: string;
  ownerUserId: string;
  runId: string;
  modelId: string;
}): Promise<ChatJob> {
  const { tenantDb, chatId, ownerUserId, runId, modelId } = input;

  return tenantDb.runAs(ownerUserId, async (tx) => {
    const workerInstanceId = randomUUID();
    await tx.insert(workerInstances).values({ id: workerInstanceId });

    return new ChatJobsRepository(tx).insert({
      chatId,
      ownerUserId,
      executor: 'bash',
      seq: 1,
      runId,
      toolCallId: randomUUID(),
      workerInstanceId,
      outputs: ['stdout', 'stderr'],
      artifactReadable: false,
      settings: { selector: modelId, permissionMode: 'default' },
    });
  });
}

async function settleNoticeJob(
  harness: WorkerHarness,
  job: ChatJob,
  output: string,
): Promise<void> {
  await settleBashJob(
    harness.tenantDb,
    job,
    {
      output: {
        stdout: output,
        stderr: '',
        truncated: false,
        truncatedStreams: { stdout: false, stderr: false },
      },
      settlement: { state: 'succeeded', result: { exitCode: 0 } },
      offsets: { stdout: 0, stderr: 0 },
    },
    {
      maxBytes: 65_536,
      hostFiles: false,
      noticeRuns: harness.moduleRef.get(JobNoticeRunService),
    },
  );
}
