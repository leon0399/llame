import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { type Db } from '../db/tenant-db.service';

import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import {
  chatDeliveries,
  chatJobChunks,
  chatJobs,
  type ChatJob,
} from '../db/schema';
import {
  ChatJobsRepository,
  type JobSettlement,
} from '../jobs/chat-jobs.repository';
import { settleBashJob } from '../jobs/bash-job-store';
import { JobNoticeRunService } from './job-notice-run.service';
import { RunsRepository } from './runs-repository';
import { RunDispatchService } from './run-dispatch.service';
import {
  bootWorkerHarness,
  createUser,
  seedRun,
  type WorkerHarness,
} from './worker-harness';
import { waitFor } from '../testing/support';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'job-notice-host.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('settled job host Runs', () => {
  let harness: WorkerHarness;
  let owner: string;
  let foreignOwner: string;
  let queueSchema: string;

  beforeAll(async () => {
    queueSchema = `${process.env.LLAME_TEST_SCHEMA_PREFIX ?? 'llame_t'}_host_run_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    harness = await bootWorkerHarness({ runsConcurrency: null, queueSchema });
    owner = await createUser(harness.db, 'job-notice-host');
    foreignOwner = await createUser(harness.db, 'job-notice-host-foreign');
  });

  afterAll(async () => {
    await harness?.close();
  });

  const db = <T>(work: (tx: Db) => Promise<T>): Promise<T> =>
    harness.tenantDb.runAs(owner, work);

  async function completedChat() {
    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId: owner,
      modelId: `baseline-${randomUUID()}`,
      text: 'owner initiated work',
    });

    await db(async (tx) => {
      const finished = await new RunsRepository(tx).markFinished(
        seeded.runId,
        owner,
        'completed',
      );

      expect(finished).toBeDefined();
    });

    return seeded;
  }

  async function runningJob(
    chatId: string,
    runId: string,
    settings: ChatJob['settings'] = {
      modelId: `job-model-${randomUUID()}`,
      permissionMode: 'default',
    },
  ) {
    if (settings.effort !== undefined) {
      harness.models.registerReasoning(settings.modelId, {
        effortLevels: [{ value: 'low' }, { value: 'high' }],
        defaultEffort: 'low',
        cacheInvalidatedByEffortChange: false,
      });
    }

    return db(async (tx) => {
      const seq = await new ArtifactsRepository(tx).nextSeq(chatId, owner);

      if (seq === undefined)
        throw new Error('Could not reserve a sequence for the test job.');

      return new ChatJobsRepository(tx).insert({
        chatId,
        ownerUserId: owner,
        executor: 'bash',
        seq,
        runId,
        toolCallId: randomUUID(),
        workerInstanceId: randomUUID(),
        outputs: ['stdout', 'stderr'],
        artifactReadable: false,
        settings,
      });
    });
  }

  async function settle(job: ChatJob, settlement: JobSettlement) {
    await settleBashJob(
      harness.tenantDb,
      job,
      {
        output: {
          stdout: `settled-${settlement.state}`,
          stderr: '',
          truncated: false,
          truncatedStreams: { stdout: false, stderr: false },
        },
        settlement,
        offsets: { stdout: 0, stderr: 0 },
      },
      {
        maxBytes: 65_536,
        hostFiles: false,
        noticeRuns: harness.moduleRef.get(JobNoticeRunService),
      },
    );
  }

  async function findHostRows(chatId: string) {
    return db(async (tx) => {
      const messages = await new MessagesRepository(tx).findByChatId(
        chatId,
        owner,
      );

      const hostMessages = messages.filter(
        (message) => message.role === 'user' && message.senderUserId === null,
      );

      const runs = await new RunsRepository(tx).findByChatId(chatId, owner);

      return {
        hostMessages,
        hostRuns: runs.filter((run) =>
          hostMessages.some((message) => message.id === run.messageId),
        ),
      };
    });
  }

  it.each([
    { state: 'succeeded', result: { exitCode: 0 } },
    { state: 'failed', result: { exitCode: 1 } },
    { state: 'timed_out', result: { exitCode: 1 } },
  ] satisfies Array<JobSettlement>)(
    'commits a $state settlement and its host trigger before any worker pickup',
    async (settlement) => {
      const prior = await completedChat();

      const job = await runningJob(prior.chatId, prior.runId, {
        modelId: `job-model-${randomUUID()}`,
        effort: 'high',
        permissionMode: 'default',
      });

      await settle(job, settlement);

      const { hostMessages, hostRuns: startedRuns } = await findHostRows(
        prior.chatId,
      );

      expect(hostMessages).toHaveLength(1);
      expect(hostMessages[0]?.parts).toEqual([]);
      expect(startedRuns).toHaveLength(1);
      expect(startedRuns[0]).toMatchObject({
        messageId: hostMessages[0]?.id,
        modelId: job.settings.modelId,
        permissionMode: job.settings.permissionMode,
        effort: job.settings.effort,
      });
      expect(
        await db((tx) =>
          new ChatDeliveriesRepository(tx).listPending(prior.chatId, owner),
        ),
      ).toHaveLength(0);
    },
  );

  it('coalesces settlements before pickup into one host trigger and one Run', async () => {
    const prior = await completedChat();
    const first = await runningJob(prior.chatId, prior.runId);
    const second = await runningJob(prior.chatId, prior.runId);

    await settle(first, { state: 'succeeded', result: { exitCode: 0 } });
    await settle(second, { state: 'failed', result: { exitCode: 1 } });

    const { hostMessages, hostRuns: startedRuns } = await findHostRows(
      prior.chatId,
    );

    expect(hostMessages).toHaveLength(1);
    expect(startedRuns).toHaveLength(1);

    const notices = await db((tx) =>
      new ChatDeliveriesRepository(tx).listDeliveredJobNotices(
        prior.chatId,
        owner,
        hostMessages[0].id,
      ),
    );

    expect(notices).toHaveLength(2);
    expect(notices.map((notice) => notice.state)).toEqual([
      'delivered',
      'delivered',
    ]);
    expect(notices.map((notice) => notice.runId)).toEqual([
      startedRuns[0]?.id,
      startedRuns[0]?.id,
    ]);
    expect(notices.map((notice) => notice.deliveredMessageId)).toEqual([
      hostMessages[0]?.id,
      hostMessages[0]?.id,
    ]);
  });

  it.each([
    { state: 'lost' as const },
    { state: 'cancelled' as const, stoppedBy: 'owner' as const },
  ] satisfies Array<JobSettlement>)(
    'does not start a host Run for a $state settlement',
    async (settlement) => {
      const prior = await completedChat();
      const job = await runningJob(prior.chatId, prior.runId);
      await settle(job, settlement);
      expect(await findHostRows(prior.chatId)).toMatchObject({
        hostMessages: [],
        hostRuns: [],
      });

      const stored = await db((tx) =>
        tx.select().from(chatJobs).where(eq(chatJobs.id, job.id)),
      );

      expect(stored[0]?.state).toBe(settlement.state);
    },
  );
  it('starts from the first held notice when a later settlement becomes eligible', async () => {
    const prior = await completedChat();

    const first = await runningJob(prior.chatId, prior.runId, {
      modelId: `held-first-${randomUUID()}`,
      effort: 'high',
      permissionMode: 'default',
    });

    await settle(first, { state: 'lost' });
    expect(await findHostRows(prior.chatId)).toMatchObject({
      hostMessages: [],
      hostRuns: [],
    });
    expect(
      await db((tx) =>
        new ChatDeliveriesRepository(tx).listPending(prior.chatId, owner),
      ),
    ).toHaveLength(1);

    const second = await runningJob(prior.chatId, prior.runId, {
      modelId: `later-second-${randomUUID()}`,
      effort: 'low',
      permissionMode: 'read-only',
    });

    await settle(second, { state: 'succeeded', result: { exitCode: 0 } });

    const { hostMessages, hostRuns: startedRuns } = await findHostRows(
      prior.chatId,
    );

    expect(hostMessages).toHaveLength(1);
    expect(startedRuns).toHaveLength(1);
    expect(startedRuns[0]).toMatchObject({
      modelId: first.settings.modelId,
      effort: first.settings.effort,
      permissionMode: first.settings.permissionMode,
    });

    const notices = await db((tx) =>
      new ChatDeliveriesRepository(tx).listDeliveredJobNotices(
        prior.chatId,
        owner,
        hostMessages[0].id,
      ),
    );

    expect(notices.map((notice) => notice.senderRef)).toEqual([
      first.id,
      second.id,
    ]);
    expect(notices.map((notice) => notice.runId)).toEqual([
      startedRuns[0]?.id,
      startedRuns[0]?.id,
    ]);
  });

  it('keeps a settled notice pending when its saved permission mode was removed', async () => {
    const prior = await completedChat();

    const job = await runningJob(prior.chatId, prior.runId, {
      modelId: `removed-mode-${randomUUID()}`,
      permissionMode: 'read-only',
    });

    await settle(job, { state: 'failed', result: { exitCode: 1 } });

    expect(await findHostRows(prior.chatId)).toMatchObject({
      hostMessages: [],
      hostRuns: [],
    });
    expect(
      await db((tx) =>
        new ChatDeliveriesRepository(tx).listPending(prior.chatId, owner),
      ),
    ).toHaveLength(1);

    const stored = await db((tx) =>
      tx.select().from(chatJobs).where(eq(chatJobs.id, job.id)),
    );

    expect(stored[0]?.state).toBe('failed');
  });

  it('does not start a host Run in an archived Chat', async () => {
    const prior = await completedChat();
    await db((tx) =>
      new ChatsRepository(tx).update(prior.chatId, owner, { archived: true }),
    );
    const job = await runningJob(prior.chatId, prior.runId);

    await settle(job, { state: 'succeeded', result: { exitCode: 0 } });

    expect(await findHostRows(prior.chatId)).toMatchObject({
      hostMessages: [],
      hostRuns: [],
    });
  });

  it('rolls back settlement, output, notice, and host Run when queue enqueue fails', async () => {
    const prior = await completedChat();
    const job = await runningJob(prior.chatId, prior.runId);
    const dispatch = harness.moduleRef.get(RunDispatchService);

    const enqueue = vi
      .spyOn(dispatch, 'enqueueInTransaction')
      .mockRejectedValueOnce(new Error('injected external queue failure'));

    try {
      await expect(
        settle(job, { state: 'failed', result: { exitCode: 1 } }),
      ).rejects.toThrow('injected external queue failure');
    } finally {
      enqueue.mockRestore();
    }

    const stored = await db((tx) =>
      tx.select().from(chatJobs).where(eq(chatJobs.id, job.id)),
    );

    const notice = await db((tx) =>
      tx
        .select()
        .from(chatDeliveries)
        .where(eq(chatDeliveries.senderRef, job.id)),
    );

    const output = await db((tx) =>
      tx.select().from(chatJobChunks).where(eq(chatJobChunks.jobId, job.id)),
    );

    expect(stored[0]?.state).toBe('running');
    expect(output).toEqual([]);
    expect(notice).toEqual([]);
    expect(
      await db((tx) =>
        new ChatDeliveriesRepository(tx).listPending(prior.chatId, owner),
      ),
    ).toEqual([]);
    expect(await findHostRows(prior.chatId)).toMatchObject({
      hostMessages: [],
      hostRuns: [],
    });
  });

  it('scopes pending notices to the trusted owner and Chat', async () => {
    const first = await completedChat();
    const second = await completedChat();

    for (const seeded of [first, second]) {
      await db((tx) =>
        new ChatsRepository(tx).update(seeded.chatId, owner, {
          archived: true,
        }),
      );
    }

    const firstJob = await runningJob(first.chatId, first.runId);
    const secondJob = await runningJob(second.chatId, second.runId);
    await settle(firstJob, { state: 'succeeded', result: { exitCode: 0 } });
    await settle(secondJob, { state: 'failed', result: { exitCode: 1 } });

    for (const seeded of [first, second]) {
      await db((tx) =>
        new ChatsRepository(tx).update(seeded.chatId, owner, {
          archived: false,
        }),
      );
    }

    const firstSettled = await db(async (tx) => {
      const [job] = await tx
        .select()
        .from(chatJobs)
        .where(eq(chatJobs.id, firstJob.id));

      return job;
    });

    await db((tx) =>
      harness.moduleRef
        .get(JobNoticeRunService)
        .startOnSettlement(tx, firstSettled),
    );

    const secondSettled = await db(async (tx) => {
      const [job] = await tx
        .select()
        .from(chatJobs)
        .where(eq(chatJobs.id, secondJob.id));

      return job;
    });

    await harness.tenantDb.runAs(foreignOwner, (tx) =>
      harness.moduleRef
        .get(JobNoticeRunService)
        .startOnSettlement(tx, secondSettled),
    );

    expect(await findHostRows(first.chatId)).toMatchObject({
      hostMessages: [{ senderUserId: null }],
      hostRuns: [{ chatId: first.chatId }],
    });
    expect(await findHostRows(second.chatId)).toMatchObject({
      hostMessages: [],
      hostRuns: [],
    });
    expect(
      await db((tx) =>
        new ChatDeliveriesRepository(tx).listPending(first.chatId, owner),
      ),
    ).toHaveLength(0);
    expect(
      await db((tx) =>
        new ChatDeliveriesRepository(tx).listPending(second.chatId, owner),
      ),
    ).toHaveLength(1);
  });

  it('delivers a settlement during a host request at the next boundary in the same Run', async () => {
    const prior = await completedChat();
    const modelId = `claimed-host-model-${randomUUID()}`;

    const first = await runningJob(prior.chatId, prior.runId, {
      modelId,
      permissionMode: 'default',
    });

    await settle(first, { state: 'succeeded', result: { exitCode: 0 } });

    const { hostMessages: firstHostMessages, hostRuns: startedRuns } =
      await findHostRows(prior.chatId);

    const hostRunId = startedRuns[0].id;

    await harness.close();
    harness = await bootWorkerHarness({ queueSchema });
    let firstRequestStarted = false;

    const { promise: firstRequestReleased, resolve: releaseFirstRequest } =
      Promise.withResolvers<void>();

    harness.models.register(modelId, {
      kind: 'step-script',
      steps: [
        [
          {
            type: 'tool-call',
            toolCallId: randomUUID(),
            toolName: 'not-a-registered-tool',
            input: {},
          },
        ],
        [{ type: 'text', id: 'final', text: 'host completed after boundary' }],
      ],
      beforeStep: async (stepIndex) => {
        if (stepIndex === 0) {
          firstRequestStarted = true;
          await firstRequestReleased;
        }
      },
    });
    await waitFor(
      () => (firstRequestStarted ? true : undefined),
      40_000,
      'first host provider request',
    );
    const atFirstRequest = await findHostRows(prior.chatId);

    const firstTriggerParts = structuredClone(
      atFirstRequest.hostMessages[0].parts,
    );

    expect(JSON.stringify(firstTriggerParts)).toContain('settled-succeeded');
    expect(JSON.stringify(firstTriggerParts)).not.toContain('settled-failed');

    const second = await runningJob(prior.chatId, prior.runId);
    await settle(second, { state: 'failed', result: { exitCode: 1 } });
    expect(
      await db((tx) =>
        new ChatDeliveriesRepository(tx).listPending(prior.chatId, owner),
      ),
    ).toHaveLength(1);
    const whileFirstRequestHeld = await findHostRows(prior.chatId);
    expect(whileFirstRequestHeld.hostMessages[0]?.parts).toEqual(
      firstTriggerParts,
    );
    expect(await findHostRows(prior.chatId)).toMatchObject({
      hostMessages: [{ id: firstHostMessages[0]?.id }],
      hostRuns: [{ id: hostRunId }],
    });

    releaseFirstRequest();
    await waitFor(
      async () => {
        const run = await db((tx) =>
          new RunsRepository(tx).findById(hostRunId, owner),
        );

        return run?.status === 'completed' ? run : undefined;
      },
      40_000,
      'host Run completion after notice boundary',
    );

    const { hostMessages, hostRuns: finalRuns } = await findHostRows(
      prior.chatId,
    );

    expect(finalRuns).toHaveLength(1);
    expect(finalRuns[0]?.id).toBe(hostRunId);
    expect(hostMessages).toHaveLength(2);
    expect(hostMessages[0]?.id).toBe(firstHostMessages[0]?.id);
    expect(hostMessages[0]?.parts).toEqual(firstTriggerParts);
    expect(JSON.stringify(hostMessages[1]?.parts)).toContain('settled-failed');
    expect(JSON.stringify(harness.models.prompts[0])).not.toContain(
      'settled-failed',
    );
    expect(JSON.stringify(harness.models.prompts[1])).toContain(
      'settled-failed',
    );
    expect(
      await db((tx) =>
        new ChatDeliveriesRepository(tx).listDeliveredJobNotices(
          prior.chatId,
          owner,
          hostMessages[1].id,
        ),
      ),
    ).toHaveLength(1);
    expect(
      await db((tx) =>
        new ChatDeliveriesRepository(tx).listPending(prior.chatId, owner),
      ),
    ).toHaveLength(0);
  });
});
