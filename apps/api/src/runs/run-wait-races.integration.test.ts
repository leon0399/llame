import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { ChatDeliveriesService } from '../chats/chat-deliveries.service';
import { ChatsService } from '../chats/chats.service';
import { ChatLoopService } from '../chats/chat-loop.service';
import { chatJobs, runs, type ChatJob } from '../db/schema';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { JobNoticeRunService } from './job-notice-run.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { settleBashJob } from '../jobs/bash-job-store';
import { MediaService } from '../media/media.service';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { waitFor } from '../testing/support';
import {
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';
import { createUser, seedLiveChatJob } from './worker-harness';
import { RunWaitService } from './run-wait.service';
import { RUNS_QUEUE } from './run-queues';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'run-wait-races.integration.test.ts requires the integration database',
  );
}

type SeededWaitingRun = SeededRun & { attemptId: string; job: ChatJob };

describe('Run wait wake races', () => {
  const fx = useSegmentsFixture('run-wait-races', {
    allowedTools: [],
    runsConcurrency: null,
  });

  const deleteFx = useSegmentsFixture('run-wait-races-delete', {
    allowedTools: [],
  });

  afterEach(() => vi.restoreAllMocks());

  async function seedWaitingRun(fixture: typeof fx): Promise<SeededWaitingRun> {
    const seeded = await fixture.seed();
    const attemptId = randomUUID();

    const job = await fixture.db(async (tx) => {
      await tx
        .update(runs)
        .set({ status: 'running_tool', activeAttemptId: attemptId })
        .where(eq(runs.id, seeded.runId));

      return seedLiveChatJob({
        tx,
        userId: fixture.userId,
        modelId: seeded.modelId,
        run: seeded,
      });
    });

    const wait = fixture.harness.moduleRef.get(RunWaitService);
    await wait.suspend({
      runId: seeded.runId,
      chatId: seeded.chatId,
      userId: fixture.userId,
      attemptId,
      toolCallId: job.toolCallId,
      toolInput: { jobs: [job.id], timeout: 3600 },
      jobIds: [job.id],
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      parts: [{ type: 'tool-call', id: job.toolCallId }],
      steps: { [job.toolCallId]: 0 },
    });

    return { ...seeded, attemptId, job };
  }

  async function settle(
    fixture: typeof fx,
    job: ChatJob,
    noticeRuns: JobNoticeRunService,
  ) {
    await settleBashJob(
      fixture.harness.tenantDb,
      job,
      {
        output: {
          stdout: 'settled output',
          stderr: '',
          truncated: false,
          truncatedStreams: { stdout: false, stderr: false },
        },
        settlement: { state: 'succeeded', result: { exitCode: 0 } },
        offsets: { stdout: 0, stderr: 0 },
      },
      { maxBytes: 65_536, hostFiles: false, noticeRuns },
    );
  }

  it('serializes an owner steer against job settlement into one current wake', async () => {
    const seeded = await seedWaitingRun(fx);
    const runWait = fx.harness.moduleRef.get(RunWaitService);
    const instanceConfig = { config: BUILT_IN_DEFAULTS };

    const loop = new ChatLoopService(
      fx.harness.tenantDb,
      fx.harness.models,
      instanceConfig,
      { createUiMessageStreamResponse: () => new Response() },
      fx.harness.dispatch,
      new MediaService(fx.harness.tenantDb),
      runWait,
    );

    const deliveries = new ChatDeliveriesService(
      fx.harness.tenantDb,
      fx.harness.models,
      instanceConfig,
      fx.harness.dispatch,
      runWait,
    );

    const noticeRuns = fx.harness.moduleRef.get(JobNoticeRunService);
    fx.harness.models.register(seeded.modelId, { kind: 'complete' });

    const stored = await loop.createDeliveryMessage({
      chatId: seeded.chatId,
      userId: fx.userId,
      modelId: seeded.modelId,
      message: {
        id: randomUUID(),
        parts: [{ type: 'text', text: 'owner steer' }],
      },
      delivery: 'queue',
    });

    if (!('delivery' in stored)) throw new Error('Expected queued delivery');

    expect(await fx.run(seeded.runId)).toMatchObject({
      status: 'awaiting_jobs',
      wakeGeneration: 1,
    });
    expect(await fx.types(seeded.runId)).not.toContain('run.resumed');

    const foreignUserId = await createUser(
      fx.harness.db,
      'run-wait-races-foreign',
    );

    await expect(
      deliveries.changeMode(
        seeded.chatId,
        stored.delivery.id,
        'steer',
        foreignUserId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const outcomes = await Promise.allSettled([
      deliveries.changeMode(
        seeded.chatId,
        stored.delivery.id,
        'steer',
        fx.userId,
      ),
      settle(fx, seeded.job, noticeRuns),
    ]);

    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') throw outcome.reason;
    }

    const run = await fx.run(seeded.runId);

    if (!run?.currentJobId) throw new Error('Wake has no current queue job');
    expect(run.status).toBe('queued');
    expect(await fx.harness.queue.jobState(RUNS_QUEUE, run.currentJobId)).toBe(
      'queued',
    );

    const items = await fx.items(seeded.chatId);
    expect(items.map(({ producer }) => producer)).toEqual(['owner', 'job']);
    expect(items.map(({ mode }) => mode)).toEqual(['steer', 'notice']);
    expect(items.map(({ state }) => state)).toEqual(['pending', 'pending']);
    expect(items[0]?.id).toBe(stored.delivery.id);
    expect(items[1]?.senderRef).toBe(seeded.job.id);

    const wakeEvents = (await fx.events(seeded.runId)).filter(
      ({ eventType }) => eventType === 'run.resumed',
    );

    expect(wakeEvents).toHaveLength(1);
  });

  it('recovers when Chat deletion races a real job settlement and wake', async () => {
    const seeded = await seedWaitingRun(deleteFx);
    const noticeRuns = deleteFx.harness.moduleRef.get(JobNoticeRunService);
    deleteFx.harness.models.register(seeded.modelId, { kind: 'hang' });

    const chats = new ChatsService(
      deleteFx.harness.tenantDb,
      noopReindexDispatch(),
      noopEmbedDispatch(),
      noopQueryEmbedder(),
      deleteFx.harness.moduleRef.get(RunWaitService),
    );

    const waiting = await deleteFx.run(seeded.runId);

    if (!waiting?.currentJobId) throw new Error('Run did not suspend');
    const enqueue = vi.spyOn(deleteFx.harness.dispatch, 'enqueueInTransaction');

    const outcomes = await Promise.allSettled([
      chats.deleteChat(deleteFx.userId, seeded.chatId),
      settle(deleteFx, seeded.job, noticeRuns),
    ]);

    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') throw outcome.reason;
    }

    await expect(
      chats.getChatById(seeded.chatId, deleteFx.userId),
    ).resolves.toBeUndefined();
    expect(await deleteFx.run(seeded.runId)).toBeUndefined();

    const publishedWakeIds = await Promise.all(
      enqueue.mock.calls.map(async ([, job, options]) => {
        const id = options?.id ?? job.runId;

        return (await deleteFx.harness.queue.jobState(RUNS_QUEUE, id)) ===
          'absent'
          ? undefined
          : id;
      }),
    );

    const committedWakeIds = publishedWakeIds.filter(
      (id): id is string => id !== undefined,
    );

    expect(committedWakeIds.length).toBeLessThanOrEqual(1);

    // Deletion can win before wake publication. If settlement publishes first,
    // the real worker must consume its stale queue entry after deletion.
    for (const wakeId of committedWakeIds) {
      await waitFor(
        async () =>
          (await deleteFx.harness.queue.jobState(RUNS_QUEUE, wakeId)) ===
          'completed'
            ? true
            : undefined,
        20_000,
        'the deleted Run wake to be consumed',
      );
    }

    const settledJobs = await deleteFx.db((tx) =>
      new ChatJobsRepository(tx).listByChat(seeded.chatId, deleteFx.userId),
    );

    expect(settledJobs).toHaveLength(0);

    const [job] = await deleteFx.db((tx) =>
      tx.select().from(chatJobs).where(eq(chatJobs.id, seeded.job.id)),
    );

    expect(job).toBeUndefined();
  });
});
