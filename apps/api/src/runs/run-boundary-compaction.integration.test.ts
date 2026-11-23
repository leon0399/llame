import { isRecord, isString } from '@workspace/runtime-safety';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { CompactionService } from '../compaction/compaction.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { settleBashJob } from '../jobs/bash-job-store';
import { JobNoticeRunService } from './job-notice-run.service';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import type { Message } from '../db/schema';
import {
  answer,
  call,
  useSegmentsFixture,
} from '../testing/run-segments.test-fixture';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'run-boundary-compaction.integration.test.ts requires TEST_DATABASE_URL.',
  );
}

describe('step-boundary compaction', () => {
  const fx = useSegmentsFixture('run-boundary-compaction', {
    allowedTools: ['read'],
  });

  const requestUsage = (inputTokens: number) => ({
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  });

  const partKinds = (message: Message) =>
    message.parts.map((part) =>
      isRecord(part) &&
      isRecord(part['data']) &&
      isString(part['data']['producer'])
        ? `data-context:${part['data']['producer']}`
        : isRecord(part) && isString(part['type'])
          ? part['type']
          : 'unknown',
    );

  it('A late final-answer compact is covered by its compaction', async () => {
    const seeded = await fx.seed('Keep the final answer.');

    const ids: Array<string> = [];
    let lateCommandStored = false;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation(async (input) => {
        if (!lateCommandStored) {
          lateCommandStored = true;

          await fx.db((tx) =>
            new ChatDeliveriesRepository(tx).withdrawPending(
              seeded.chatId,
              ids[0],
              fx.userId,
            ),
          );

          ids.push(
            ...(await fx.storeItems(
              seeded.chatId,
              ['/compact after read'],
              'steer',
            )),
          );
        }

        return {
          uptoSeq: input.plan.uptoSeq,
          summary: 'final answer summary',
          usage: {},
        };
      });

    const callsBefore = summarize.mock.calls.length;

    const started = await fx.launch(
      seeded,
      [
        answer('The final answer.'),
        answer('The replacement command is handled.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 0) {
          ids.push(
            ...(await fx.storeItems(
              seeded.chatId,
              ['/compact'],
              'steer',
              seeded.runId,
            )),
          );
        }
      },
    );

    const finished = await fx.terminal(seeded.runId);
    const messages = await fx.messages(seeded.chatId);
    const log = await fx.events(seeded.runId);

    expect(finished.status).toBe('completed');
    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(
      messages.filter((message) => message.role === 'checkpoint'),
    ).toHaveLength(1);
    expect(log.map((event) => event.eventType)).not.toContain('run.delivered');
    expect(
      (await Promise.all(ids.map((id) => fx.itemState(id)))).map(
        (item) => item?.state,
      ),
    ).toEqual(['withdrawn', 'delivered']);
    expect(started.prompts()).toHaveLength(1);
  });

  it('A compact at the final answer with a pending notice', async () => {
    const seeded = await fx.seed('Keep the final answer and notice.');

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'final answer with notice',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    let itemId = '';

    const started = await fx.launch(
      seeded,
      [answer('The final answer.'), answer('The notice is handled.')],
      async (stepIndex) => {
        if (stepIndex !== 0) return;

        await fx.storeItems(seeded.chatId, ['/compact'], 'steer', seeded.runId);

        const job = await fx.db((tx) =>
          new ChatJobsRepository(tx).insert({
            chatId: seeded.chatId,
            ownerUserId: fx.userId,
            executor: 'bash',
            seq: 1,
            runId: seeded.runId,
            toolCallId: `notice-${randomUUID()}`,
            workerInstanceId: randomUUID(),
            startedAt: new Date(),
            outputs: [],
            artifactReadable: false,
            settings: { selector: seeded.modelId, permissionMode: 'default' },
          }),
        );

        await settleBashJob(
          fx.harness.tenantDb,
          job,
          {
            output: {
              stdout: 'completed job output',
              stderr: '',
              truncated: false,
              truncatedStreams: { stdout: false, stderr: false },
            },
            settlement: { state: 'failed', result: { exitCode: 1 } },
            offsets: { stdout: 0, stderr: 0 },
          },
          {
            maxBytes: 65_536,
            hostFiles: false,
            noticeRuns: fx.harness.moduleRef.get(JobNoticeRunService),
          },
        );

        const pending = await fx.db((tx) =>
          new ChatDeliveriesRepository(tx).listPending(
            seeded.chatId,
            fx.userId,
          ),
        );

        itemId = pending.find((item) => item.producer === 'job')?.id ?? '';
      },
    );

    await fx.terminal(seeded.runId);
    const messages = await fx.messages(seeded.chatId);

    const hostMessage = messages.find(
      (message) =>
        message.role === 'user' &&
        partKinds(message).includes('data-context:job'),
    );

    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(hostMessage).toBeDefined();
    expect(partKinds(hostMessage!)).not.toContain('data-context:compaction');
    expect(await fx.itemState(itemId)).toMatchObject({ state: 'delivered' });
    expect(started.prompts()).toHaveLength(2);
  });

  it('A compaction in a tool loop absorbs the open turn and continues the Run', async () => {
    const seeded = await fx.seed('Finish the report.');

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'the open turn summary',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    const started = await fx.launch(
      seeded,
      [
        call('r1', 'read', { path: fx.directory }),
        call('r2', 'read', { path: fx.directory }),
        call('r3', 'read', { path: fx.directory }),
        answer('Report finished.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 2) {
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    const finished = await fx.terminal(seeded.runId);
    const messages = await fx.messages(seeded.chatId);

    const checkpoint = messages.find(
      (message) => message.role === 'checkpoint',
    );

    const delivered = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.delivered',
    );

    expect(finished.status).toBe('completed');
    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    const summaryRequest = summarize.mock.calls[callsBefore]?.[0];

    expect(summaryRequest?.closedReply.length).toBeGreaterThan(0);
    expect(JSON.stringify(summaryRequest?.closedReply)).toContain('r1');
    expect(JSON.stringify(summaryRequest?.closedReply)).toContain('r2');
    expect(checkpoint?.absorbedThroughSeq).toBeGreaterThan(
      seeded.userMessage.seq,
    );

    const assistant = messages.find(
      (message) =>
        message.role === 'assistant' &&
        message.inReplyTo === seeded.userMessage.id,
    );

    const continuation = messages.find(
      (message) =>
        message.role === 'user' &&
        partKinds(message).includes('data-context:compaction'),
    );

    expect(assistant?.seq).toBeLessThan(checkpoint?.seq ?? 0);
    expect(checkpoint?.seq).toBeLessThan(continuation?.seq ?? 0);
    expect(delivered?.payload).toMatchObject({
      cause: 'compaction',
      checkpointId: checkpoint?.id,
      stepBudgetUsed: 3,
    });
    expect(started.prompts()).toHaveLength(4);
    expect(
      started
        .prompts()
        .at(-1)
        ?.some((line) => line.includes('Finish the report.')),
    ).toBe(true);
    expect(
      started
        .prompts()
        .at(-1)
        ?.some((line) => line.includes('the open turn summary')),
    ).toBe(true);
  });
  it('Compact as a steer', async () => {
    const seeded = await fx.seed('Keep the result concise.');
    let stored = false;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'compacted steer context',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    const started = await fx.launch(
      seeded,
      [call('read-once', 'read', { path: fx.directory }), answer('Done.')],
      async (stepIndex) => {
        if (stepIndex === 0 && !stored) {
          stored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact keep X'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    await fx.terminal(seeded.runId);

    const messages = await fx.messages(seeded.chatId);

    const checkpoint = messages.find(
      (message) => message.role === 'checkpoint',
    );

    const continuation = messages.find(
      (message) =>
        message.role === 'user' &&
        partKinds(message).includes('data-context:compaction'),
    );

    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.parts[0]).toMatchObject({
      data: { payload: { v: 2, focus: 'keep X' } },
    });
    expect(continuation).toBeDefined();
    expect(partKinds(continuation!)).not.toContain('text');
    expect(started.prompts()).toHaveLength(2);
  });

  it('Two compact items at one boundary', async () => {
    const seeded = await fx.seed('Keep both requests.');
    let stored = false;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'one shared compacted context',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;
    let ids: Array<string> = [];

    await fx.launch(
      seeded,
      [call('read-once', 'read', { path: fx.directory }), answer('Done.')],
      async (stepIndex) => {
        if (stepIndex === 0 && !stored) {
          stored = true;
          ids = await fx.storeItems(
            seeded.chatId,
            ['/compact first', '/compact second'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    await fx.terminal(seeded.runId);

    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(
      (await Promise.all(ids.map((id) => fx.itemState(id)))).map(
        (item) => item?.state,
      ),
    ).toEqual(['delivered', 'delivered']);
    expect(
      (await fx.messages(seeded.chatId)).filter(
        (message) => message.role === 'checkpoint',
      ),
    ).toHaveLength(1);
  });

  it('A compact and a steer at one boundary', async () => {
    const seeded = await fx.seed('Keep the requested context.');
    let stored = false;
    let summaryFocus: string | null = null;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) => {
        summaryFocus = input.focus;

        return Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'mixed boundary context',
          usage: {},
        });
      });

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(
      seeded,
      [call('read-once', 'read', { path: fx.directory }), answer('Done.')],
      async (stepIndex) => {
        if (stepIndex === 0 && !stored) {
          stored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact Focus this command', 'Keep going'],
            'steer',
            seeded.runId,
          );
        }
      },
      {
        compactionThresholdTokens: 1,
        requestUsages: [requestUsage(0), requestUsage(0)],
      },
    );

    await fx.terminal(seeded.runId);

    const delivered = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.delivered',
    );

    const message = (await fx.messages(seeded.chatId)).find(
      (candidate) =>
        candidate.role === 'user' &&
        partKinds(candidate).includes('data-context:compaction'),
    );

    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(summaryFocus).toBe('Focus this command');

    const checkpoint = (await fx.messages(seeded.chatId)).find(
      (candidate) => candidate.role === 'checkpoint',
    );

    expect(delivered?.payload).toMatchObject({
      cause: 'steer',
      checkpointId: checkpoint?.id,
    });
    expect(checkpoint?.seq).toBeLessThan(message?.seq ?? 0);
    expect(
      message?.parts.map((part) => (isRecord(part) ? part['text'] : null)),
    ).toContain('Keep going');
    expect(
      message?.parts.find(
        (part) =>
          isRecord(part) &&
          isRecord(part['data']) &&
          part['data']['producer'] === 'compaction' &&
          part['data']['form'] === 'notice',
      ),
    ).toMatchObject({ data: { payload: { quote: 'Keep going' } } });
  });
  it('A provider error during a compaction mid-turn', async () => {
    const seeded = await fx.seed('Continue after a failed summary.');
    let stored = false;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockResolvedValue(null);

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(
      seeded,
      [
        call('read-one', 'read', { path: fx.directory }),
        call('read-two', 'read', { path: fx.directory }),
        answer('The task is complete.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 1 && !stored) {
          stored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    const finished = await fx.terminal(seeded.runId);
    const events = await fx.events(seeded.runId);

    expect(finished.status).toBe('completed');
    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(events.map((event) => event.eventType)).toContain(
      'run.compaction_failed',
    );
    const messages = await fx.messages(seeded.chatId);

    const reply = messages.find(
      (message) =>
        message.role === 'assistant' &&
        message.inReplyTo === seeded.userMessage.id,
    );

    expect(
      messages.filter((message) => message.role === 'checkpoint'),
    ).toHaveLength(0);
    expect(reply?.parts).toContainEqual({
      type: 'data-compaction-failed',
      data: {},
    });
  });
  it('Two compactions share one budget', async () => {
    const seeded = await fx.seed('Keep the multi-step task moving.');
    let firstStored = false;
    let secondStored = false;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'updated task checkpoint',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    const started = await fx.launch(
      seeded,
      [
        call('read-one', 'read', { path: fx.directory }),
        call('read-two', 'read', { path: fx.directory }),
        call('read-three', 'read', { path: fx.directory }),
        call('read-four', 'read', { path: fx.directory }),
        answer('Task complete.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 2 && !firstStored) {
          firstStored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact first'],
            'steer',
            seeded.runId,
          );
        } else if (stepIndex === 3 && !secondStored) {
          secondStored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact second'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    await fx.terminal(seeded.runId);

    const budgets = (await fx.events(seeded.runId))
      .filter((event) => event.eventType === 'run.delivered')
      .map((event) =>
        isRecord(event.payload) ? event.payload['stepBudgetUsed'] : undefined,
      );

    expect(summarize).toHaveBeenCalledTimes(callsBefore + 2);
    expect(budgets).toEqual([3, 4]);

    const continuedQuotes = (await fx.messages(seeded.chatId))
      .flatMap((message) => message.parts)
      .filter(
        (part) =>
          isRecord(part) &&
          isRecord(part['data']) &&
          part['data']['producer'] === 'compaction' &&
          part['data']['form'] === 'notice',
      )
      .map((part) =>
        isRecord(part) &&
        isRecord(part['data']) &&
        isRecord(part['data']['payload'])
          ? part['data']['payload']['quote']
          : undefined,
      );

    expect(continuedQuotes).toEqual([
      'Keep the multi-step task moving.',
      'Keep the multi-step task moving.',
    ]);
    expect(started.prompts()).toHaveLength(5);
  });
  it('An interrupt compaction keeps its cause', async () => {
    const seeded = await fx.seed('Interrupt and compact.');
    let stored = false;

    await fx.launch(
      seeded,
      [
        call('read-one', 'read', { path: fx.directory }),
        call('read-two', 'read', { path: fx.directory }),
        answer('Finished after interruption.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 1 && !stored) {
          stored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'interrupt',
            seeded.runId,
          );
        }
      },
    );

    await fx.terminal(seeded.runId);

    const events = await fx.events(seeded.runId);

    const delivered = events.find(
      (event) => event.eventType === 'run.delivered',
    );

    const checkpoint = (await fx.messages(seeded.chatId)).find(
      (message) => message.role === 'checkpoint',
    );

    const reply = (await fx.messages(seeded.chatId)).find(
      (message) =>
        message.role === 'assistant' &&
        message.inReplyTo === seeded.userMessage.id,
    );

    expect(delivered?.payload).toMatchObject({
      cause: 'interrupt',
      checkpointId: checkpoint?.id,
      stepBudgetUsed: 2,
    });
    expect(reply?.usage).toMatchObject({
      status: 'aborted',
      interrupted: true,
    });
  });
  it('A compact item withdrawn during the compaction', async () => {
    const seeded = await fx.seed('Keep working after withdrawal.');
    const entered = Promise.withResolvers<void>();

    const release = Promise.withResolvers<{
      uptoSeq: number;
      summary: string;
      usage: Record<string, never>;
    } | null>();

    let itemId: string | undefined;

    vi.spyOn(
      fx.harness.moduleRef.get(CompactionService),
      'computeBoundarySummary',
    ).mockImplementation(async (input) => {
      entered.resolve();

      return release.promise.then(() => ({
        uptoSeq: input.plan.uptoSeq,
        summary: 'withdrawn summary',
        usage: {},
      }));
    });

    await fx.launch(
      seeded,
      [
        call('read-one', 'read', { path: fx.directory }),
        call('read-two', 'read', { path: fx.directory }),
        answer('Task finished.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 1 && itemId === undefined) {
          [itemId] = await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }
      },
    );

    await entered.promise;
    await fx.db((tx) =>
      new ChatDeliveriesRepository(tx).withdrawPending(
        seeded.chatId,
        itemId!,
        fx.userId,
      ),
    );
    release.resolve(null);
    await fx.terminal(seeded.runId);

    expect((await fx.itemState(itemId!))?.state).toBe('withdrawn');
    expect(
      (await fx.messages(seeded.chatId)).filter(
        (message) => message.role === 'checkpoint',
      ),
    ).toHaveLength(0);
    expect(
      (await fx.types(seeded.runId)).filter((type) => type === 'run.delivered'),
    ).toHaveLength(0);
  });
  it('resolves retained image media from the closing reply', async () => {
    const seeded = await fx.seed('Inspect this image.');
    const imagePath = `${fx.directory}/tiny.png`;
    await writeFile(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );

    await fx.launch(
      seeded,
      [
        call('read-image', 'read', { path: imagePath }),
        answer('The image was inspected.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 0) {
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }
      },
    );
    const finished = await fx.terminal(seeded.runId);

    expect(finished.status).toBe('completed');
    expect(
      (await fx.messages(seeded.chatId)).filter(
        (message) => message.role === 'checkpoint',
      ),
    ).toHaveLength(1);
  });

  it('A long tool loop compacts itself', async () => {
    const seeded = await fx.seed('Keep the automatic request.');

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'automatic checkpoint',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(
      seeded,
      [call('automatic-read', 'read', { path: fx.directory }), answer('Done.')],
      undefined,
      {
        compactionThresholdTokens: 1,
        requestUsages: [requestUsage(0), requestUsage(0)],
      },
    );

    const finished = await fx.terminal(seeded.runId);

    const checkpoints = (await fx.messages(seeded.chatId)).filter(
      (message) => message.role === 'checkpoint',
    );

    expect(finished.status).toBe('completed');
    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(checkpoints).toHaveLength(1);
  });

  it('A final answer does not compact automatically', async () => {
    const seeded = await fx.seed('Answer without tools.');

    const summarize = vi.spyOn(
      fx.harness.moduleRef.get(CompactionService),
      'computeBoundarySummary',
    );

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(seeded, [answer('No compaction.')], undefined, {
      compactionThresholdTokens: 1,
      requestUsages: [requestUsage(10)],
    });
    await fx.terminal(seeded.runId);

    expect(summarize).toHaveBeenCalledTimes(callsBefore);
    expect(
      (await fx.messages(seeded.chatId)).filter(
        (message) => message.role === 'checkpoint',
      ),
    ).toHaveLength(0);
  });

  it('Ten compactions in a long Run', async () => {
    const seeded = await fx.seed('Keep compacting the long request.');

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'automatic checkpoint',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    const steps = [
      ...Array.from({ length: 10 }, (_, index) =>
        call(`automatic-read-${index}`, 'read', { path: fx.directory }),
      ),
      answer('Finished ten checkpoints.'),
    ];

    await fx.launch(seeded, steps, undefined, {
      compactionThresholdTokens: 1,
      requestUsages: Array.from({ length: 11 }, () => requestUsage(0)),
    });
    await fx.terminal(seeded.runId);

    expect(summarize).toHaveBeenCalledTimes(callsBefore + 10);
    expect(
      (await fx.messages(seeded.chatId)).filter(
        (message) => message.role === 'checkpoint',
      ),
    ).toHaveLength(10);
  });

  it('Automatic compaction includes a steer locked at the boundary', async () => {
    const seeded = await fx.seed('Keep the delivery after compaction.');

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'automatic checkpoint with steer',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(
      seeded,
      [
        call('read-before-delivery', 'read', { path: fx.directory }),
        answer('The delivered segment completes.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 0) {
          await fx.storeItems(
            seeded.chatId,
            ['Continue after the checkpoint.'],
            'steer',
            seeded.runId,
          );

          const job = await fx.db((tx) =>
            new ChatJobsRepository(tx).insert({
              chatId: seeded.chatId,
              ownerUserId: fx.userId,
              executor: 'bash',
              seq: 1,
              runId: seeded.runId,
              toolCallId: `notice-${randomUUID()}`,
              workerInstanceId: randomUUID(),
              startedAt: new Date(),
              outputs: [],
              artifactReadable: false,
              settings: { selector: seeded.modelId, permissionMode: 'default' },
            }),
          );

          await settleBashJob(
            fx.harness.tenantDb,
            job,
            {
              output: {
                stdout: 'completed job output',
                stderr: '',
                truncated: false,
                truncatedStreams: { stdout: false, stderr: false },
              },
              settlement: { state: 'failed', result: { exitCode: 1 } },
              offsets: { stdout: 0, stderr: 0 },
            },
            {
              maxBytes: 65_536,
              hostFiles: false,
              noticeRuns: fx.harness.moduleRef.get(JobNoticeRunService),
            },
          );
        }
      },
      {
        compactionThresholdTokens: 1,
        requestUsages: [requestUsage(0), requestUsage(0)],
      },
    );
    await fx.terminal(seeded.runId);

    const messages = await fx.messages(seeded.chatId);

    const checkpoint = messages.find(
      (message) => message.role === 'checkpoint',
    );

    const delivered = (await fx.events(seeded.runId)).find(
      (event) => event.eventType === 'run.delivered',
    );

    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(delivered?.payload).toMatchObject({
      cause: 'steer',
      checkpointId: checkpoint?.id,
    });

    const deliveredMessage = messages.find(
      (message) =>
        message.role === 'user' &&
        partKinds(message).includes('data-context:compaction'),
    );

    expect(checkpoint?.seq).toBeLessThan(deliveredMessage?.seq ?? 0);
    expect(deliveredMessage?.parts).toContainEqual({
      type: 'text',
      text: 'Continue after the checkpoint.',
    });
    expect(partKinds(deliveredMessage!)).toContain('data-context:job');
  });

  it('A compaction that does not help disables the automatic trigger', async () => {
    const seeded = await fx.seed('Keep testing compaction progress.');

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'automatic checkpoint',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(
      seeded,
      [
        call('first-read', 'read', { path: fx.directory }),
        call('second-read', 'read', { path: fx.directory }),
        call('third-read', 'read', { path: fx.directory }),
        answer('Finished after the manual checkpoint.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 1) {
          await fx.storeItems(
            seeded.chatId,
            ['Continue while automatic compaction stays off.'],
            'steer',
            seeded.runId,
          );
        }

        if (stepIndex === 3) {
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }
      },
      {
        compactionThresholdTokens: 1,
        requestUsages: [
          requestUsage(0),
          null,
          requestUsage(0),
          requestUsage(0),
        ],
      },
    );
    const finished = await fx.terminal(seeded.runId);
    const events = await fx.events(seeded.runId);

    expect(finished.status).toBe('completed');
    expect(summarize).toHaveBeenCalledTimes(callsBefore + 2);
    expect(
      events.filter((event) => event.eventType === 'run.compaction_disabled'),
    ).toHaveLength(1);
    expect(
      (await fx.messages(seeded.chatId)).flatMap((message) => message.parts),
    ).toContainEqual({ type: 'data-compaction-disabled', data: {} });
  });

  it('A failed automatic compaction stops the trigger', async () => {
    const seeded = await fx.seed('Keep testing failed compaction.');

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockResolvedValue(null);

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(
      seeded,
      [
        call('first-read', 'read', { path: fx.directory }),
        call('second-read', 'read', { path: fx.directory }),
        answer('Finished without a checkpoint.'),
      ],
      undefined,
      {
        compactionThresholdTokens: 1,
        requestUsages: [requestUsage(0), requestUsage(0), requestUsage(0)],
      },
    );
    const finished = await fx.terminal(seeded.runId);
    const events = await fx.events(seeded.runId);

    const reply = (await fx.messages(seeded.chatId)).find(
      (message) => message.role === 'assistant',
    );

    expect(finished.status).toBe('completed');
    expect(summarize).toHaveBeenCalledTimes(callsBefore + 1);
    expect(events.map((event) => event.eventType)).toContain(
      'run.compaction_disabled',
    );
    expect(events.map((event) => event.eventType)).not.toContain(
      'run.compaction_failed',
    );
    expect(reply?.parts).toContainEqual({
      type: 'data-compaction-disabled',
      data: {},
    });
  });

  it('A segment start does not compact automatically', async () => {
    const seeded = await fx.seed('A segment starts with a request.');

    const summarize = vi.spyOn(
      fx.harness.moduleRef.get(CompactionService),
      'computeBoundarySummary',
    );

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(
      seeded,
      [
        answer('The first segment ends above the threshold.'),
        answer('The steered segment answers without pre-step compaction.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 0) {
          await fx.storeItems(
            seeded.chatId,
            ['Start another segment.'],
            'steer',
            seeded.runId,
          );
        }
      },
      {
        compactionThresholdTokens: 1,
        requestUsages: [requestUsage(10), requestUsage(10)],
      },
    );
    await fx.terminal(seeded.runId);

    expect(summarize).toHaveBeenCalledTimes(callsBefore);
  });

  it('The summary request reuses the live prefix', async () => {
    const seeded = await fx.seed('Keep the live request.');
    let stored = false;

    const summarize = vi
      .spyOn(
        fx.harness.moduleRef.get(CompactionService),
        'computeBoundarySummary',
      )
      .mockImplementation((input) =>
        Promise.resolve({
          uptoSeq: input.plan.uptoSeq,
          summary: 'live-prefix checkpoint',
          usage: {},
        }),
      );

    const callsBefore = summarize.mock.calls.length;

    await fx.launch(
      seeded,
      [
        call('read-one', 'read', { path: fx.directory }),
        call('read-two', 'read', { path: fx.directory }),
        answer('Finished with the live prefix.'),
      ],
      async (stepIndex) => {
        if (stepIndex === 1 && !stored) {
          stored = true;
          await fx.storeItems(
            seeded.chatId,
            ['/compact'],
            'steer',
            seeded.runId,
          );
        }
      },
    );
    await fx.terminal(seeded.runId);

    const request = summarize.mock.calls[callsBefore]?.[0];

    expect(request?.closedReply.length).toBeGreaterThan(0);
    expect(JSON.stringify(request?.closedReply)).toContain(
      'Keep the live request.',
    );
    expect(JSON.stringify(request?.closedReply)).not.toContain(
      'Summarize the conversation so far',
    );
    expect(request?.client).toBeDefined();
    expect(request?.system.length).toBeGreaterThan(0);
    expect(request?.toolDeclarations.length).toBeGreaterThan(0);
    expect(request?.focus).toBeNull();
    expect(request?.plan.uptoSeq).toBeGreaterThan(seeded.userMessage.seq);
  });
});
