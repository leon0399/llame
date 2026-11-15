import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { ChatLoopService } from '../chats/chat-loop.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { MediaService } from '../media/media.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { RunWaitService } from './run-wait.service';
import { eventPayloadString } from './run-event-payload';

import { JobNoticeRunService } from './job-notice-run.service';
import { settleBashJob } from '../jobs/bash-job-store';
import { createUser, seedLiveChatJob, seedRun } from './worker-harness';
import { waitFor } from '../testing/support';
import {
  answer,
  call,
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';
import {
  chatDeliveries,
  chatJobs,
  runs,
  workerInstances,
  type ChatJob,
} from '../db/schema';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'wait-tool-lifecycle.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('wait tool lifecycle through real Run streams', () => {
  const fx = useSegmentsFixture('wait-tool-lifecycle', {
    allowedTools: ['read', 'wait'],
    nativeExecutorId: 'wait-tool-lifecycle-host',
  });

  async function seedJob(
    seeded: SeededRun,
    userId = fx.userId,
  ): Promise<ChatJob> {
    return fx.db(async (tx) => {
      const [previous] = await tx
        .select({ seq: chatJobs.seq })
        .from(chatJobs)
        .where(eq(chatJobs.chatId, seeded.chatId))
        .orderBy(desc(chatJobs.seq))
        .limit(1);

      const seq = (previous?.seq ?? 0) + 1;

      if (seq === 1) {
        return seedLiveChatJob({
          tx,
          userId,
          modelId: seeded.modelId,
          run: { chatId: seeded.chatId, runId: seeded.runId },
        });
      }

      const workerInstanceId = crypto.randomUUID();
      await tx.insert(workerInstances).values({ id: workerInstanceId });

      return new ChatJobsRepository(tx).insert({
        chatId: seeded.chatId,
        ownerUserId: userId,
        executor: 'bash',
        seq,
        runId: seeded.runId,
        toolCallId: `wait-${crypto.randomUUID()}`,
        workerInstanceId,
        outputs: ['stdout', 'stderr'],
        artifactReadable: false,
        settings: { modelId: seeded.modelId, permissionMode: 'default' },
      });
    });
  }

  async function settle(
    job: ChatJob,
    state: 'failed' | 'succeeded' = 'failed',
  ) {
    await settleBashJob(
      fx.harness.tenantDb,
      job,
      {
        output: {
          stdout: 'actual settled job output',
          stderr: '',
          truncated: false,
          truncatedStreams: { stdout: false, stderr: false },
        },
        settlement: {
          state,
          result: { exitCode: state === 'failed' ? 1 : 0 },
        },
        offsets: { stdout: 0, stderr: 0 },
      },
      {
        maxBytes: 65_536,
        hostFiles: false,
        noticeRuns: fx.harness.moduleRef.get(JobNoticeRunService),
      },
    );
  }

  async function awaiting(runId: string) {
    return waitFor(
      async () => {
        const run = await fx.run(runId);

        return run?.status === 'awaiting_jobs' ? run : undefined;
      },
      20_000,
      `Run ${runId} to suspend for a listed job`,
    );
  }

  function locator(seq = 1) {
    return `job://bash-${seq}`;
  }

  function toolResults(prompt: (typeof fx.harness.models.prompts)[number]) {
    return prompt.flatMap((message) =>
      message.role === 'tool'
        ? message.content.flatMap((part) =>
            part.type === 'tool-result'
              ? [{ toolCallId: part.toolCallId, output: part.output }]
              : [],
          )
        : [],
    );
  }

  function answerAfterWake(seeded: SeededRun, text: string): void {
    fx.harness.models.register(seeded.modelId, {
      kind: 'step-script',
      steps: [answer(text)],
    });
  }

  it('suspends on a listed job failure and resumes the same Run with its result once', async () => {
    const seeded = await fx.seed('read before waiting');
    await fx.db((tx) =>
      tx
        .update(runs)
        .set({ permissionMode: 'read-only' })
        .where(eq(runs.id, seeded.runId)),
    );
    const path = join(fx.directory, 'before-wait.txt');
    await writeFile(path, 'read-only prefix value');
    const job = await seedJob(seeded);

    const started = await fx.launch(seeded, [
      [
        ...call('prefix-read', 'read', { path }),
        ...call('wait-for-failure', 'wait', {
          jobs: [locator()],
          timeout: 3600,
        }),
      ],
      answer('resumed after failure'),
    ]);

    await awaiting(seeded.runId);
    expect((await fx.run(seeded.runId))?.id).toBe(seeded.runId);
    expect(started.prompts()).toHaveLength(1);
    expect(
      (await fx.types(seeded.runId)).filter(
        (type) => type === 'tool.completed',
      ),
    ).toHaveLength(1);

    answerAfterWake(seeded, 'resumed after failure');
    await settle(job);
    const completed = await fx.terminal(seeded.runId);

    expect(completed.status).toBe('completed');
    expect(started.prompts()).toHaveLength(2);
    const providerResults = toolResults(fx.harness.models.prompts.at(-1) ?? []);
    expect(
      providerResults.filter((result) => result.toolCallId === 'prefix-read'),
    ).toHaveLength(1);
    expect(
      providerResults.filter(
        (result) => result.toolCallId === 'wait-for-failure',
      ),
    ).toHaveLength(1);
    expect(
      providerResults.find((result) => result.toolCallId === 'wait-for-failure')
        ?.output,
    ).toMatchObject({
      type: 'json',
      value: {
        status: 'success',
        ended: 'settled',
        jobs: [
          {
            locator: 'job://bash-1',
            state: 'failed',
            outputs: [
              { name: 'stdout', text: 'actual settled job output' },
              { name: 'stderr', text: '' },
            ],
          },
        ],
      },
    });
    const completedEvents = await fx.events(seeded.runId);
    expect(
      completedEvents.filter(
        (event) =>
          event.eventType === 'tool.started' &&
          eventPayloadString(event.payload, 'toolCallId') === 'prefix-read',
      ),
    ).toHaveLength(1);
    expect(
      completedEvents.filter(
        (event) =>
          event.eventType === 'tool.completed' &&
          eventPayloadString(event.payload, 'toolCallId') ===
            'wait-for-failure',
      ),
    ).toHaveLength(1);
    expect(
      providerResults.find((result) => result.toolCallId === 'prefix-read')
        ?.output,
    ).toBeDefined();
  });

  it('persists a sibling read before suspending without emitting an SDK wait result', async () => {
    const seeded = await fx.seed('parallel read and wait');
    const path = join(fx.directory, 'parallel-read.txt');
    await writeFile(path, 'sibling read payload');
    const job = await seedJob(seeded);

    const started = await fx.launch(seeded, [
      [
        ...call('parallel-wait', 'wait', { jobs: [locator()], timeout: 3600 }),
        ...call('parallel-read', 'read', { path }),
      ],
      answer('finished after sibling read'),
    ]);

    await awaiting(seeded.runId);
    expect(started.prompts()).toHaveLength(1);
    const events = await fx.events(seeded.runId);
    expect(
      events.some(
        (event) =>
          event.eventType === 'tool.completed' &&
          eventPayloadString(event.payload, 'toolCallId') === 'parallel-read',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.eventType === 'tool.completed' &&
          eventPayloadString(event.payload, 'toolCallId') === 'parallel-wait',
      ),
    ).toBe(false);

    const suspended = events.find(
      (event) => event.eventType === 'run.suspended',
    );

    expect(suspended?.payload).toMatchObject({
      steps: { 'parallel-wait': 0 },
    });
    expect(
      events.filter((event) => event.eventType === 'model.requested'),
    ).toHaveLength(1);

    answerAfterWake(seeded, 'finished after sibling read');
    await settle(job);
    await fx.terminal(seeded.runId);
    const providerResults = toolResults(fx.harness.models.prompts.at(-1) ?? []);
    expect(
      providerResults.filter((result) => result.toolCallId === 'parallel-read'),
    ).toHaveLength(1);
    expect(
      providerResults.find((result) => result.toolCallId === 'parallel-read')
        ?.output,
    ).toBeDefined();
    expect(
      providerResults.filter((result) => result.toolCallId === 'parallel-wait'),
    ).toHaveLength(1);
    const resumedEvents = await fx.events(seeded.runId);

    for (const toolCallId of ['parallel-read', 'parallel-wait']) {
      expect(
        resumedEvents.filter(
          (event) =>
            event.eventType === 'tool.completed' &&
            eventPayloadString(event.payload, 'toolCallId') === toolCallId,
        ),
      ).toHaveLength(1);
    }

    expect(
      resumedEvents.filter((event) => event.eventType === 'model.requested'),
    ).toHaveLength(2);

    const finalAssistant = (await fx.transcript(seeded.chatId))
      .filter((message) => message.role === 'assistant')
      .at(-1);

    expect(finalAssistant?.text).toBe('finished after sibling read');
  });

  it('returns the real timeout result and running promise after the durable deadline wake', async () => {
    const seeded = await fx.seed('timeout while waiting');
    await seedJob(seeded);

    const started = await fx.launch(seeded, [
      call('timeout-wait', 'wait', { jobs: [locator()], timeout: 1 }),
      answer('continued after timeout'),
    ]);

    await awaiting(seeded.runId);
    answerAfterWake(seeded, 'continued after timeout');

    const completed = await fx.terminal(seeded.runId);

    expect(completed.status).toBe('completed');
    expect(started.prompts()).toHaveLength(2);

    const waitResult = toolResults(fx.harness.models.prompts.at(-1) ?? []).find(
      (result) => result.toolCallId === 'timeout-wait',
    );

    expect(waitResult?.output).toMatchObject({
      type: 'json',
      value: {
        status: 'success',
        ended: 'timeout',
        jobs: [{ locator: 'job://bash-1', state: 'running' }],
        promise:
          'The jobs continue in the background. You get a notice when one of them settles.',
      },
    });
    const events = await fx.events(seeded.runId);
    expect((await fx.run(seeded.runId))?.awaiting).toBeNull();
    expect(
      events.filter((event) => event.eventType === 'run.suspended'),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.eventType === 'run.resumed'),
    ).toHaveLength(1);
    expect(
      events.find((event) => event.eventType === 'run.resumed')?.payload,
    ).toMatchObject({ cause: 'timeout' });
  });

  it('ends a wait interrupted when an unlisted job settles and delivers its notice', async () => {
    const seeded = await fx.seed('unlisted job settles');
    await seedJob(seeded);
    const unrelated = await seedJob(seeded);
    await fx.launch(seeded, [
      call('unlisted-wait', 'wait', { jobs: [locator()], timeout: 3600 }),
      answer('observed unlisted settlement'),
    ]);
    await awaiting(seeded.runId);
    answerAfterWake(seeded, 'observed unlisted settlement');
    await settle(unrelated);
    expect((await fx.terminal(seeded.runId)).status).toBe('completed');

    const completed = (await fx.events(seeded.runId)).find(
      (event) =>
        event.eventType === 'tool.completed' &&
        eventPayloadString(event.payload, 'toolCallId') === 'unlisted-wait',
    );

    expect(completed?.payload).toMatchObject({
      consumedJobNoticeIds: [],
      output: {
        ended: 'interrupted',
        jobs: [{ locator: 'job://bash-1', state: 'running' }],
      },
    });

    const [notice] = await fx.db((tx) =>
      tx
        .select({ state: chatDeliveries.state })
        .from(chatDeliveries)
        .where(eq(chatDeliveries.senderRef, unrelated.id)),
    );

    expect(notice?.state).toBe('delivered');
  });

  it('reports a waited job lost when its worker lease expires before wait lookup', async () => {
    const seeded = await fx.seed('wait for a dead worker');
    const job = await seedJob(seeded);
    await fx.harness.db
      .update(workerInstances)
      .set({ lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(workerInstances.id, job.workerInstanceId));

    const started = await fx.launch(seeded, [
      call('lost-job-wait', 'wait', { jobs: [locator()] }),
      answer('observed lost worker'),
    ]);

    expect((await fx.terminal(seeded.runId)).status).toBe('completed');
    expect(started.prompts()).toHaveLength(2);

    const result = toolResults(fx.harness.models.prompts.at(-1) ?? []).find(
      (part) => part.toolCallId === 'lost-job-wait',
    );

    expect(result?.output).toMatchObject({
      type: 'json',
      value: {
        ended: 'settled',
        jobs: [{ locator: 'job://bash-1', state: 'lost' }],
      },
    });
    expect(await fx.types(seeded.runId)).not.toContain('run.suspended');
  });

  it('returns one of three listed failures and consumes exactly its notice', async () => {
    const seeded = await fx.seed('one listed job settles');

    const listed = [
      await seedJob(seeded),
      await seedJob(seeded),
      await seedJob(seeded),
    ];

    const started = await fx.launch(seeded, [
      call('three-job-wait', 'wait', {
        jobs: listed.map((job) => locator(job.seq)),
        timeout: 3600,
      }),
      answer('resumed after one listed failure'),
    ]);

    await awaiting(seeded.runId);

    answerAfterWake(seeded, 'resumed after one listed failure');
    await settle(listed[1]);
    await fx.terminal(seeded.runId);
    expect(started.prompts()).toHaveLength(2);

    const [settledNotice] = await fx.db((tx) =>
      tx
        .select({ id: chatDeliveries.id, state: chatDeliveries.state })
        .from(chatDeliveries)
        .where(eq(chatDeliveries.senderRef, listed[1].id)),
    );

    expect(settledNotice).toMatchObject({ state: 'withdrawn' });
    expect(settledNotice?.id).toBeDefined();

    const completed = (await fx.events(seeded.runId)).find(
      (event) =>
        event.eventType === 'tool.completed' &&
        eventPayloadString(event.payload, 'toolCallId') === 'three-job-wait',
    );

    expect(completed?.payload).toMatchObject({
      consumedJobNoticeIds: [settledNotice?.id],
      output: {
        status: 'success',
        ended: 'settled',
        jobs: [
          { locator: 'job://bash-1', state: 'running' },
          { locator: 'job://bash-2', state: 'failed' },
          { locator: 'job://bash-3', state: 'running' },
        ],
      },
    });
    expect(completed?.payload).not.toHaveProperty(
      'output.consumedJobNoticeIds',
    );
    expect(
      JSON.stringify(fx.harness.models.prompts.at(-1) ?? []),
    ).not.toContain('consumedJobNoticeIds');
    expect(
      (await fx.events(seeded.runId)).filter(
        (event) =>
          event.eventType === 'tool.completed' &&
          eventPayloadString(event.payload, 'toolCallId') === 'three-job-wait',
      ),
    ).toHaveLength(1);
  });

  it('records an errored wait sibling and suspends the still-open wait', async () => {
    const seeded = await fx.seed('two waits in one model step');
    const job = await seedJob(seeded);

    const started = await fx.launch(seeded, [
      [
        ...call('open-wait', 'wait', { jobs: [locator()], timeout: 3600 }),
        ...call('duplicate-wait', 'wait', { jobs: [locator()], timeout: 3600 }),
      ],
      answer('resumed after open wait'),
    ]);

    await awaiting(seeded.runId);
    const events = await fx.events(seeded.runId);
    expect(
      events.some(
        (event) =>
          event.eventType === 'tool.completed' &&
          eventPayloadString(event.payload, 'toolCallId') ===
            'duplicate-wait' &&
          eventPayloadString(event.payload, 'status') === 'error',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.eventType === 'tool.completed' &&
          eventPayloadString(event.payload, 'toolCallId') === 'open-wait',
      ),
    ).toBe(false);
    expect(started.prompts()).toHaveLength(1);

    answerAfterWake(seeded, 'resumed after open wait');
    await settle(job);
    await fx.terminal(seeded.runId);
    expect(
      (await fx.events(seeded.runId)).filter(
        (event) =>
          event.eventType === 'tool.completed' &&
          eventPayloadString(event.payload, 'toolCallId') === 'open-wait',
      ),
    ).toHaveLength(1);
  });

  it('returns a real result for an already-settled job without suspending', async () => {
    const seeded = await fx.seed('already settled job');
    const job = await seedJob(seeded);
    await settle(job, 'succeeded');

    const started = await fx.launch(seeded, [
      call('settled-wait', 'wait', { jobs: [locator()] }),
      answer('already settled result received'),
    ]);

    const completed = await fx.terminal(seeded.runId);
    expect(completed.status).toBe('completed');
    expect(started.prompts()).toHaveLength(2);
    const settledResults = toolResults(fx.harness.models.prompts.at(-1) ?? []);

    const settledWait = settledResults.find(
      (result) => result.toolCallId === 'settled-wait',
    );

    expect(settledWait?.output).toMatchObject({
      type: 'json',
      value: {
        status: 'success',
        ended: 'settled',
        jobs: [
          {
            state: 'succeeded',
            outputs: [
              { name: 'stdout', text: 'actual settled job output' },
              { name: 'stderr', text: '' },
            ],
          },
        ],
      },
    });

    expect(settledWait?.output).not.toHaveProperty('value.promise');

    expect(
      (await fx.events(seeded.runId)).some(
        (event) =>
          event.eventType === 'run.suspended' &&
          eventPayloadString(event.payload, 'toolCallId') === 'settled-wait',
      ),
    ).toBe(false);
  });

  it('delivers an owner steer before the next provider request after an open wait', async () => {
    const seeded = await fx.seed('owner steer while waiting');
    await seedJob(seeded);

    const started = await fx.launch(seeded, [
      call('owner-wait', 'wait', { jobs: [locator()], timeout: 3600 }),
      answer('response after steer'),
    ]);

    await awaiting(seeded.runId);
    answerAfterWake(seeded, 'response after steer');

    const loop = new ChatLoopService(
      fx.harness.tenantDb,
      fx.harness.models,
      fx.harness.moduleRef.get(InstanceConfigService),
      { createUiMessageStreamResponse: () => new Response() },
      fx.harness.dispatch,
      new MediaService(fx.harness.tenantDb),
      fx.harness.moduleRef.get(RunWaitService),
    );

    await loop.createDeliveryMessage({
      chatId: seeded.chatId,
      userId: fx.userId,
      modelId: seeded.modelId,
      message: {
        id: crypto.randomUUID(),
        parts: [{ type: 'text', text: 'owner direction' }],
      },
      delivery: 'steer',
    });
    await fx.terminal(seeded.runId);

    const continuedPrompt = started.prompts()[1] ?? [];
    expect(continuedPrompt).toContain('user:owner direction');
    expect(
      (await fx.events(seeded.runId)).some(
        (event) =>
          event.eventType === 'run.delivered' &&
          eventPayloadString(event.payload, 'cause') === 'steer',
      ),
    ).toBe(true);
    expect(
      toolResults(fx.harness.models.prompts.at(-1) ?? []).find(
        (result) => result.toolCallId === 'owner-wait',
      )?.output,
    ).toMatchObject({
      type: 'json',
      value: { status: 'success', ended: 'interrupted' },
    });
    const lifecycle = await fx.events(seeded.runId);

    const deliveredAt = lifecycle.findIndex(
      (event) =>
        event.eventType === 'run.delivered' &&
        eventPayloadString(event.payload, 'cause') === 'steer',
    );

    const lastRequestAt = lifecycle
      .map((event) => event.eventType === 'model.requested')
      .lastIndexOf(true);

    expect(deliveredAt).toBeGreaterThanOrEqual(0);
    expect(lastRequestAt).toBeGreaterThan(deliveredAt);
    expect(
      lifecycle.filter((event) => event.eventType === 'model.requested'),
    ).toHaveLength(2);

    const finalAssistant = (await fx.transcript(seeded.chatId))
      .filter((message) => message.role === 'assistant')
      .at(-1);

    expect(finalAssistant?.text).toBe('response after steer');
  });

  it('does not find another owner’s job through the current owner’s wait', async () => {
    const seeded = await fx.seed('foreign job lookup');

    const foreignUserId = await createUser(
      fx.harness.db,
      'wait-tool-lifecycle-foreign',
    );

    const foreignSeeded = await seedRun({
      tenantDb: fx.harness.tenantDb,
      userId: foreignUserId,
      modelId: seeded.modelId,
      text: 'foreign owner job',
    });

    await fx.harness.tenantDb.runAs(foreignUserId, (tx) =>
      seedLiveChatJob({
        tx,
        userId: foreignUserId,
        modelId: seeded.modelId,
        run: foreignSeeded,
      }),
    );

    const started = await fx.launch(seeded, [
      call('foreign-wait', 'wait', { jobs: [locator()] }),
      answer('foreign job was not found'),
    ]);

    const completed = await fx.terminal(seeded.runId);
    expect(completed.status).toBe('completed');
    expect(started.prompts()).toHaveLength(2);
    expect(
      (await fx.events(seeded.runId)).some(
        (event) =>
          event.eventType === 'tool.completed' &&
          eventPayloadString(event.payload, 'toolCallId') === 'foreign-wait' &&
          eventPayloadString(event.payload, 'status') === 'error',
      ),
    ).toBe(true);
    expect((await fx.run(seeded.runId))?.status).not.toBe('awaiting_jobs');
  });
});
