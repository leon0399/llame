/**
 * run-steering, `segments` layer — the delivery machinery against real
 * Postgres (RLS active) and the co-located worker, with the scripted model
 * client. No HTTP admits a `steer` yet: pending items are stored directly in
 * `chat_deliveries`, as the layer contract says, so the suite proves the step
 * end check, the delivery transaction, the completion check, and recovery of
 * the current segment.
 *
 * Requires TEST_DATABASE_URL (throws without it); run by `test:integration`.
 */

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isRecord } from '@workspace/runtime-safety';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { chatJobChunks, type Run } from '../db/schema';
import { waitFor } from '../testing/support';
import type { Db } from '../db/tenant-db.service';
import { finalizeRunReply } from './run-reply-finalizer';
import {
  answer,
  call,
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { deliverPendingSteering } from './segment-delivery';
import { RunRowFenceRepository } from './run-row-fence.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { createUser } from './worker-harness';
import { notifyRunControl } from './run-control';
import { WorkerHeartbeatService } from '../jobs/worker-heartbeat.service';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'run-segments.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('run steering segments', () => {
  const fx = useSegmentsFixture('run-segments', {
    allowedTools: ['read', 'bash', 'stop'],
    nativeExecutorId: 'run-segments-host',
    maxStepsPerRun: 2,
  });

  const {
    db,
    storeItems,
    items,
    itemState,
    events,
    types,
    run,
    terminal,
    transcript,
    lines,
    seed,
    launch,
    startRun,
  } = fx;

  async function writeNoticeOutputChunks(
    tx: Db,
    jobId: string,
    outputs: ReadonlyArray<{ name: string; text: string }>,
  ) {
    if (outputs.length === 0) return;
    await tx.insert(chatJobChunks).values(
      outputs.map(({ name, text }, position) => ({
        jobId,
        ownerUserId: fx.userId,
        output: name,
        position,
        content: Buffer.from(text),
      })),
    );
  }

  async function settleNotice(
    seeded: SeededRun,
    options: {
      executor?: string;
      modelId?: string;
      seq?: number;
      outputs?: ReadonlyArray<{ name: string; text: string }>;
    } = {},
  ) {
    return db(async (tx) => {
      const jobs = new ChatJobsRepository(tx);

      const job = await jobs.insert({
        chatId: seeded.chatId,
        ownerUserId: fx.userId,
        executor: options.executor ?? 'bash',
        seq: options.seq ?? 1,
        runId: seeded.runId,
        toolCallId: randomUUID(),
        workerInstanceId: randomUUID(),
        outputs: options.outputs?.map(({ name }) => name) ?? [],
        artifactReadable: false,
        settings: {
          modelId: options.modelId ?? seeded.modelId,
          permissionMode: 'default',
        },
      });

      await writeNoticeOutputChunks(tx, job.id, options.outputs ?? []);

      const settled = await jobs.settle(seeded.chatId, fx.userId, job.id, {
        state: 'failed',
        result: { exitCode: 2 },
      });

      if (!settled) throw new Error('The test job did not settle.');

      const notice = await new ChatDeliveriesRepository(tx).insertJobNotice(
        settled,
      );

      if (!notice) throw new Error('The test job notice was not inserted.');

      return { job: settled, notice };
    });
  }

  describe('the step end check and the delivery', () => {
    it('A successful stop records its exact consumed notice ids outside output', async () => {
      let noticeId = '';

      const started = await startRun(
        [
          call('notice-stop', 'stop', { jobs: ['job://bash-1'] }),
          answer('stopped'),
        ],
        async (index, seeded) => {
          if (index === 0) noticeId = (await settleNotice(seeded)).notice.id;
        },
      );

      await terminal(started.runId);

      const completion = (await events(started.runId)).find(
        (event) =>
          event.eventType === 'tool.completed' &&
          isRecord(event.payload) &&
          event.payload['toolCallId'] === 'notice-stop',
      );

      const notice = await itemState(noticeId);

      expect(completion && isRecord(completion.payload)).toBe(true);

      if (!completion || !isRecord(completion.payload)) {
        throw new Error('The stop completion was not recorded.');
      }

      expect(completion.payload['consumedJobNoticeIds']).toEqual([noticeId]);
      expect(isRecord(completion.payload['output'])).toBe(true);

      if (isRecord(completion.payload['output'])) {
        expect(completion.payload['output']).not.toHaveProperty(
          'consumedJobNoticeIds',
        );
      }

      expect(notice).toMatchObject({
        state: 'withdrawn',
        runId: started.runId,
      });
      expect(await types(started.runId)).not.toContain('run.delivered');
    });
    it('A cancelled stop result leaves a previously pending notice pending', async () => {
      let noticeId = '';
      let runId = '';

      const originalUpdateForAttempt: (
        this: RunsRepository,
        ...args: Parameters<RunsRepository['updateForAttempt']>
      ) => Promise<Run | undefined> =
        // eslint-disable-next-line typescript/unbound-method -- apply below supplies the repository receiver explicitly.
        RunsRepository.prototype.updateForAttempt;

      let cancellationRecorded = false;

      const updateForAttempt = vi
        .spyOn(RunsRepository.prototype, 'updateForAttempt')
        .mockImplementation(async function (
          this: RunsRepository,
          ...args: Parameters<RunsRepository['updateForAttempt']>
        ): Promise<Run | undefined> {
          const [targetRunId, ownerUserId, attemptId, set] = args;

          if (
            !cancellationRecorded &&
            targetRunId === runId &&
            ownerUserId === fx.userId &&
            Object.keys(set).length === 1 &&
            set.activeAttemptId === attemptId
          ) {
            // This is the successful stop result's transactional persistence
            // callback. Commit cancellation before its real attempt fence runs.
            await db(async (tx) => {
              const cancelled = await new RunsRepository(tx).requestCancel(
                runId,
                fx.userId,
              );

              if (!cancelled)
                throw new Error('The live Run was not cancelled.');
              await notifyRunControl(tx, { runId, kind: 'cancel' });
            });
            cancellationRecorded = true;
          }

          // eslint-disable-next-line typescript/no-unsafe-return -- Function.apply loses the captured method's declared result type.
          return originalUpdateForAttempt.apply(this, args);
        });

      try {
        const started = await startRun(
          [
            call('cancelled-stop', 'stop', {
              jobs: ['job://bash-1', 'job://bash-2'],
            }),
            answer('unreached'),
          ],
          async (index, seeded) => {
            if (index !== 0) return;
            runId = seeded.runId;
            noticeId = (await settleNotice(seeded)).notice.id;

            await db((tx) =>
              new ChatJobsRepository(tx).insert({
                chatId: seeded.chatId,
                ownerUserId: fx.userId,
                executor: 'bash',
                seq: 2,
                runId: seeded.runId,
                toolCallId: randomUUID(),
                workerInstanceId: fx.harness.moduleRef.get(
                  WorkerHeartbeatService,
                ).instanceId,
                outputs: [],
                artifactReadable: false,
                settings: {
                  modelId: seeded.modelId,
                  permissionMode: 'default',
                },
              }),
            );
          },
        );

        await terminal(started.runId);
        expect(cancellationRecorded).toBe(true);
        const notice = await itemState(noticeId);

        const stopCompletion = (await events(started.runId)).find(
          (event) =>
            event.eventType === 'tool.completed' &&
            isRecord(event.payload) &&
            event.payload['toolCallId'] === 'cancelled-stop',
        );

        expect(notice).toMatchObject({ state: 'pending', runId: null });
        expect(stopCompletion && isRecord(stopCompletion.payload)).toBe(true);

        if (!stopCompletion || !isRecord(stopCompletion.payload)) {
          throw new Error('The stop completion was not recorded.');
        }

        expect(stopCompletion.payload['status']).toBe('success');
        expect(isRecord(stopCompletion.payload['output'])).toBe(true);

        if (!isRecord(stopCompletion.payload['output'])) {
          throw new Error('The successful stop output was not recorded.');
        }

        expect(stopCompletion.payload['output']['jobs']).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ job: 'job://bash-1', state: 'failed' }),
          ]),
        );
        expect(stopCompletion.payload['consumedJobNoticeIds']).toEqual([]);
      } finally {
        updateForAttempt.mockRestore();
      }
    });
    it('A stop that returns running leaves the later settlement notice pending', async () => {
      let jobId = '';
      let noticeId = '';

      const started = await startRun(
        [
          call('late-stop', 'stop', { jobs: ['job://bash-1'] }),
          answer('follow-up'),
          answer('notice received'),
        ],
        async (index, seeded) => {
          if (index === 0) {
            const running = await db((tx) =>
              new ChatJobsRepository(tx).insert({
                chatId: seeded.chatId,
                ownerUserId: fx.userId,
                executor: 'bash',
                seq: 1,
                runId: seeded.runId,
                toolCallId: randomUUID(),
                workerInstanceId: fx.harness.moduleRef.get(
                  WorkerHeartbeatService,
                ).instanceId,
                outputs: [],
                artifactReadable: false,
                settings: {
                  modelId: seeded.modelId,
                  permissionMode: 'default',
                },
              }),
            );

            jobId = running.id;

            return;
          }

          if (index !== 1) return;

          const stopEvent = await waitFor(
            async () =>
              (await events(seeded.runId)).find(
                (event) =>
                  event.eventType === 'tool.completed' &&
                  isRecord(event.payload) &&
                  event.payload['toolCallId'] === 'late-stop',
              ),
            20_000,
            'the stop result to be recorded',
          );

          if (
            !isRecord(stopEvent.payload) ||
            !isRecord(stopEvent.payload['output'])
          ) {
            throw new Error('The stop result was not a structured output.');
          }

          expect(stopEvent.payload['output']['jobs']).toMatchObject([
            { state: 'running' },
          ]);

          await db(async (tx) => {
            const jobs = new ChatJobsRepository(tx);

            const settled = await jobs.settle(seeded.chatId, fx.userId, jobId, {
              state: 'succeeded',
            });

            if (!settled) throw new Error('The late test job did not settle.');

            const notice = await new ChatDeliveriesRepository(
              tx,
            ).insertJobNotice(settled);

            if (!notice) throw new Error('The late notice was not inserted.');
            noticeId = notice.id;
          });
        },
      );

      await terminal(started.runId);
      expect((await itemState(noticeId))?.state).toBe('delivered');

      const completion = (await events(started.runId)).find(
        (event) =>
          event.eventType === 'tool.completed' &&
          isRecord(event.payload) &&
          event.payload['toolCallId'] === 'late-stop',
      );

      expect(completion && isRecord(completion.payload)).toBe(true);

      if (completion && isRecord(completion.payload)) {
        expect(completion.payload['consumedJobNoticeIds']).toEqual([]);
      }
    });

    it('A notice alone continues the live Run as a host message', async () => {
      let noticeId = '';

      const started = await startRun(
        [
          [
            { type: 'text', id: 'notice-intro', text: 'earlier reply' },
            ...call('notice-read', 'read', { path: fx.directory }),
          ],
          answer('continued'),
        ],
        async (index, seeded) => {
          if (index === 0) {
            noticeId = (
              await settleNotice(seeded, {
                modelId: 'different-model',
                outputs: [
                  { name: 'stdout', text: 'diagnostic payload from old model' },
                ],
              })
            ).notice.id;
          }
        },
      );

      const finished = await terminal(started.runId);
      expect(finished.status).toBe('completed');

      const notice = await itemState(noticeId);

      const storedMessages = await db((tx) =>
        new MessagesRepository(tx).findByChatId(started.chatId, fx.userId),
      );

      const hostMessage = storedMessages.find(
        (message) => message.id === notice?.deliveredMessageId,
      );

      expect(hostMessage).toMatchObject({
        role: 'user',
        senderUserId: null,
      });
      expect(
        hostMessage?.parts.some(
          (part) =>
            isRecord(part) &&
            part['type'] === 'data-context' &&
            isRecord(part['data']) &&
            part['data']['producer'] === 'job',
        ),
      ).toBe(true);
      expect(
        started
          .prompts()[1]
          ?.some((line) => line.includes('Background job job://bash-1')),
      ).toBe(true);
      expect(started.prompts()[1]).toContain('assistant:earlier reply');
      expect(
        started
          .prompts()[1]
          ?.some((line) => line.includes('diagnostic payload from old model')),
      ).toBe(true);
    });
    it('A notice arriving during a model response is delivered at its step end', async () => {
      const gate = join(fx.directory, `notice-gate-${randomUUID()}`);
      let noticeId = '';
      const noticeReady = Promise.withResolvers<void>();

      const started = await startRun(
        [
          call('notice-wait', 'bash', {
            command: `while [ ! -e ${gate} ]; do sleep 0.05; done; echo response-finished`,
            cwd: fx.directory,
          }),
          answer('continued'),
        ],
        (index, seeded) => {
          if (index !== 0) return;
          setImmediate(() => {
            void (async () => {
              try {
                await waitFor(
                  async () =>
                    (await types(seeded.runId)).includes('tool.started')
                      ? true
                      : undefined,
                  20_000,
                  'the gated model call to start',
                );
                noticeId = (await settleNotice(seeded)).notice.id;
                await writeFile(gate, '');
                noticeReady.resolve();
              } catch (error) {
                noticeReady.reject(error);
              }
            })();
          });
        },
      );

      await noticeReady.promise;
      await terminal(started.runId);

      const delivered = (await events(started.runId)).find(
        (event) => event.eventType === 'run.delivered',
      );

      expect(delivered?.payload).toMatchObject({ cause: 'notice' });
      expect((await itemState(noticeId))?.state).toBe('delivered');
    });

    it('A job settling during the final answer reaches the next provider request', async () => {
      let releaseSettlement: (() => void) | undefined;
      let settlement: Promise<void> | undefined;

      const started = await startRun(
        [answer('final answer already streaming'), answer('follow-up')],
        async (index, seeded) => {
          if (index !== 0) return;
          const chatLocked = Promise.withResolvers<void>();
          const proceed = Promise.withResolvers<void>();
          releaseSettlement = proceed.resolve;
          settlement = db(async (tx) => {
            await new ChatsRepository(tx).lock(seeded.chatId, fx.userId);
            chatLocked.resolve();
            await proceed.promise;
            const jobs = new ChatJobsRepository(tx);

            const job = await jobs.insert({
              chatId: seeded.chatId,
              ownerUserId: fx.userId,
              executor: 'bash',
              seq: 1,
              runId: seeded.runId,
              toolCallId: randomUUID(),
              workerInstanceId: randomUUID(),
              outputs: [],
              artifactReadable: false,
              settings: { modelId: seeded.modelId, permissionMode: 'default' },
            });

            const settled = await jobs.settle(
              seeded.chatId,
              fx.userId,
              job.id,
              { state: 'succeeded' },
            );

            if (!settled) throw new Error('The test job did not settle.');
            await new ChatDeliveriesRepository(tx).insertJobNotice(settled);
          });
          await chatLocked.promise;
        },
      );

      await waitFor(
        async () =>
          (await types(started.runId)).includes('model.delta')
            ? true
            : undefined,
        20_000,
        'the final answer to start streaming',
      );

      if (!releaseSettlement || !settlement) {
        throw new Error('The notice settlement transaction did not start.');
      }

      releaseSettlement();
      await settlement;
      await terminal(started.runId);

      expect(
        (await events(started.runId)).find(
          (event) => event.eventType === 'run.delivered',
        )?.payload,
      ).toMatchObject({ cause: 'notice' });
      expect(
        started
          .prompts()[1]
          ?.some((line) => line.includes('Background job job://bash-1')),
      ).toBe(true);
      expect(started.prompts()[1]).toContain(
        'assistant:final answer already streaming',
      );
    });

    it('A steer and notice at one boundary retain owner text and steer cause', async () => {
      let noticeId = '';
      let steerId = '';

      const started = await startRun(
        [
          call('notice-steer', 'read', { path: fx.directory }),
          answer('continued'),
        ],
        async (index, seeded) => {
          if (index !== 0) return;
          noticeId = (await settleNotice(seeded)).notice.id;
          steerId =
            (await storeItems(seeded.chatId, ['owner direction']))[0] ?? '';
        },
      );

      await terminal(started.runId);
      const log = await events(started.runId);

      const delivered = log.find(
        (event) => event.eventType === 'run.delivered',
      );

      const notice = await itemState(noticeId);

      const storedMessages = await db((tx) =>
        new MessagesRepository(tx).findByChatId(started.chatId, fx.userId),
      );

      const message = storedMessages.find(
        (candidate) => candidate.id === notice?.deliveredMessageId,
      );

      expect(delivered?.payload).toMatchObject({
        cause: 'steer',
        deliveryIds: [noticeId, steerId],
      });
      expect(message).toMatchObject({
        role: 'user',
        senderUserId: fx.userId,
      });
      expect(
        message?.parts.some(
          (part) =>
            isRecord(part) &&
            part['type'] === 'data-context' &&
            isRecord(part['data']) &&
            part['data']['producer'] === 'job',
        ),
      ).toBe(true);
      expect(
        message?.parts.some(
          (part) =>
            isRecord(part) &&
            part['type'] === 'text' &&
            part['text'] === 'owner direction',
        ),
      ).toBe(true);
      const continuedPrompt = started.prompts()[1] ?? [];
      expect(continuedPrompt).toContain('user:owner direction');
      expect(
        continuedPrompt.some((line) =>
          line.includes('Background job job://bash-1'),
        ),
      ).toBe(true);

      const contextPosition = continuedPrompt.findIndex((line) =>
        line.includes('Background job job://bash-1'),
      );

      const ownerPosition = continuedPrompt.indexOf('user:owner direction');
      expect(contextPosition).toBeGreaterThanOrEqual(0);
      expect(ownerPosition).toBeGreaterThan(contextPosition);
    });
    it('A lost steer signal delays delivery until the command finishes', async () => {
      // The call blocks on a gate file, so the item is stored while it runs.
      const gate = join(fx.directory, `gate-${randomUUID()}`);

      const started = await startRun([
        call('slow', 'bash', {
          command: `while [ ! -e ${gate} ]; do sleep 0.05; done; echo opened`,
          cwd: fx.directory,
        }),
        answer('after the steer'),
      ]);

      await waitFor(
        async () =>
          (await types(started.runId)).includes('tool.started')
            ? true
            : undefined,
        20_000,
        'the bash call to start',
      );
      await storeItems(started.chatId, ['change course']);
      await writeFile(gate, '');
      await terminal(started.runId);

      const log = await events(started.runId);

      const completed = log.findIndex(
        (event) => event.eventType === 'tool.completed',
      );

      const delivered = log.findIndex(
        (event) => event.eventType === 'run.delivered',
      );

      expect(completed).toBeGreaterThan(-1);
      expect(delivered).toBeGreaterThan(completed);
      expect(log[completed]?.payload).toMatchObject({
        toolCallId: 'slow',
        status: 'success',
      });
      const second = started.prompts()[1] ?? [];
      expect(second.at(-1)).toBe('user:change course');
      expect(second.slice(0, -1)).toContain('tool:tool-result');
    });

    it('A steer during a model response waits for the step end', async () => {
      const started = await startRun(
        [
          [
            { type: 'text', id: 'a', text: 'Reading. ' },
            ...call('r1', 'read', { path: fx.directory }),
          ],
          answer('done'),
        ],
        async (index, seeded) => {
          if (index === 0) await storeItems(seeded.chatId, ['mid-response']);
        },
      );

      await terminal(started.runId);

      const messages = await transcript(started.chatId);
      expect(messages.map(({ role, text }) => `${role}:${text}`)).toEqual([
        'user:first message',
        'assistant:Reading. ',
        'user:mid-response',
        'assistant:done',
      ]);
      const log = await types(started.runId);
      expect(log.indexOf('tool.completed')).toBeLessThan(
        log.indexOf('run.delivered'),
      );
    });

    it('A delivered message restarts the step count', async () => {
      const started = await startRun(
        [
          call('a', 'read', { path: fx.directory }),
          call('b', 'read', { path: fx.directory }),
          call('c', 'read', { path: fx.directory }),
          call('d', 'read', { path: fx.directory }),
          answer('four steps in two segments'),
        ],
        async (index, seeded) => {
          if (index === 1) await storeItems(seeded.chatId, ['more']);
        },
      );

      const finished = await terminal(started.runId);

      expect(finished.status).toBe('completed');
      const log = await types(started.runId);
      expect(log.filter((type) => type === 'tool.completed')).toHaveLength(4);
      // The cap is 2: only the second segment reaches it, after its own two.
      expect(
        log.filter((type) => type === 'run.step_cap_reached'),
      ).toHaveLength(1);
      const messages = await transcript(started.chatId);
      expect(messages.at(-1)?.text).toBe('four steps in two segments');
    });

    it('A steer after the cap gives a new budget', async () => {
      const started = await startRun(
        [
          call('a', 'read', { path: fx.directory }),
          call('b', 'read', { path: fx.directory }),
          answer('capped answer'),
          call('c', 'read', { path: fx.directory }),
          call('d', 'read', { path: fx.directory }),
          answer('second segment answer'),
        ],
        async (index, seeded) => {
          if (index === 2) await storeItems(seeded.chatId, ['keep going']);
        },
      );

      await terminal(started.runId);

      const log = await types(started.runId);
      expect(log.filter((type) => type === 'tool.completed')).toHaveLength(4);
      expect(
        log.filter((type) => type === 'run.step_cap_reached'),
      ).toHaveLength(2);
      const messages = await transcript(started.chatId);
      expect(messages.map(({ role, text }) => `${role}:${text}`)).toEqual([
        'user:first message',
        'assistant:capped answer',
        'user:keep going',
        'assistant:second segment answer',
      ]);
    });

    it('Two steers at one boundary', async () => {
      let ids: Array<string> = [];

      const started = await startRun(
        [call('a', 'read', { path: fx.directory }), answer('both seen')],
        async (index, seeded) => {
          if (index === 0) {
            ids = await storeItems(seeded.chatId, ['one', 'two']);
          }
        },
      );

      await terminal(started.runId);

      const messages = await transcript(started.chatId);

      const delivered = messages.filter(
        (message) => message.role === 'user' && message.text === 'one|two',
      );

      expect(delivered).toHaveLength(1);

      const stored = await db((tx) =>
        new MessagesRepository(tx).findByChatId(started.chatId, fx.userId),
      );

      expect(
        stored.find((message) => message.id === delivered[0]?.id)?.senderUserId,
      ).toBe(fx.userId);
      const states = await Promise.all(ids.map((id) => itemState(id)));
      expect(states.map((item) => item?.deliveredMessageId)).toEqual([
        delivered[0]?.id,
        delivered[0]?.id,
      ]);
      expect(states.map((item) => item?.state)).toEqual([
        'delivered',
        'delivered',
      ]);
    });

    it('The transcript order after a steer, and a delivered message executes in the active Run', async () => {
      const started = await startRun(
        [call('a', 'read', { path: fx.directory }), answer('second reply')],
        async (index, seeded) => {
          if (index === 0) await storeItems(seeded.chatId, ['steer']);
        },
      );

      const finished = await terminal(started.runId);

      const messages = await transcript(started.chatId);
      expect(messages.map(({ role, text }) => `${role}:${text}`)).toEqual([
        'user:first message',
        'assistant:',
        'user:steer',
        'assistant:second reply',
      ]);
      // Each reply answers its own user row; the Run's message moved.
      expect(messages[1]?.inReplyTo).toBe(messages[0]?.id);
      expect(messages[3]?.inReplyTo).toBe(messages[2]?.id);
      expect(finished.messageId).toBe(messages[2]?.id);
      // One Run, one claim: the delivery appended no `run.started`.
      const log = await types(started.runId);
      expect(log.filter((type) => type === 'run.started')).toHaveLength(1);
      expect(log.filter((type) => type === 'run.delivered')).toHaveLength(1);
      expect(messages[1]?.status).toBe('completed');
      expect(finished.status).toBe('completed');
    });

    it('A live client sees the segment usage', async () => {
      const started = await startRun(
        [call('a', 'read', { path: fx.directory }), answer('end')],
        async (index, seeded) => {
          if (index === 0) await storeItems(seeded.chatId, ['steer']);
        },
      );

      await terminal(started.runId);

      const log = await events(started.runId);

      const usageEvent = log.findIndex(
        (event) => event.eventType === 'model.completed',
      );

      const delivered = log.findIndex(
        (event) => event.eventType === 'run.delivered',
      );

      expect(usageEvent).toBeGreaterThan(-1);
      expect(usageEvent).toBeLessThan(delivered);

      const streamed =
        isRecord(log[usageEvent]?.payload) &&
        log[usageEvent].payload['telemetry'];

      const [firstReply] = (await transcript(started.chatId)).filter(
        (message) => message.role === 'assistant',
      );

      // The reload shows the usage the stream carried.
      expect(firstReply?.usage).toEqual(streamed);
    });

    it('A cancellation and a steer at one boundary', async () => {
      const started = await startRun(
        [call('a', 'read', { path: fx.directory }), answer('never reached')],
        async (index, seeded) => {
          if (index !== 0) return;
          await storeItems(seeded.chatId, ['too late']);
          // Recorded, but no abort reaches this worker.
          await db((tx) =>
            new RunsRepository(tx).requestCancel(seeded.runId, fx.userId),
          );
        },
      );

      const finished = await terminal(started.runId);

      expect(finished.status).toBe('cancelled');
      expect(await types(started.runId)).not.toContain('run.delivered');
      const pending = await items(started.chatId);
      expect(pending.map((item) => item.state)).toEqual(['pending']);
      const messages = await transcript(started.chatId);
      expect(
        messages.filter((message) => message.role === 'user'),
      ).toHaveLength(1);
    });

    it('A cancellation recorded with no pending item stops the call at the step end', async () => {
      const started = await startRun(
        [call('a', 'read', { path: fx.directory }), answer('never reached')],
        async (index, seeded) => {
          // Recorded, but no abort reaches this worker.
          if (index === 0) {
            await db((tx) =>
              new RunsRepository(tx).requestCancel(seeded.runId, fx.userId),
            );
          }
        },
      );

      const finished = await terminal(started.runId);

      expect(finished.status).toBe('cancelled');
      expect(started.prompts()).toHaveLength(1);
      expect(await types(started.runId)).not.toContain('run.delivered');
    });
  });

  describe('the completion check', () => {
    it('A steer during the final answer', async () => {
      const started = await startRun(
        [
          call('a', 'read', { path: fx.directory }),
          answer('final answer'),
          answer('after the steer'),
        ],
        async (index, seeded) => {
          if (index === 1) await storeItems(seeded.chatId, ['one more thing']);
        },
      );

      const finished = await terminal(started.runId);

      const messages = await transcript(started.chatId);
      expect(messages.map(({ role, text }) => `${role}:${text}`)).toEqual([
        'user:first message',
        'assistant:final answer',
        'user:one more thing',
        'assistant:after the steer',
      ]);
      expect(finished.status).toBe('completed');
      expect(started.prompts()[2]?.at(-1)).toBe('user:one more thing');
    });

    /**
     * The step end saw the pending item; the owner withdraws it before the
     * delivery transaction reads the pending items, which then find none.
     */
    const withdrawBeforeDelivery = () =>
      vi
        .spyOn(ChatDeliveriesRepository.prototype, 'lockPendingBoundary')
        .mockImplementationOnce(async (chatId) => {
          for (const item of await items(chatId)) {
            await db((tx) =>
              new ChatDeliveriesRepository(tx).withdrawPending(
                chatId,
                item.id,
                fx.userId,
              ),
            );
          }

          return [];
        });

    it('A withdrawal after the step end', async () => {
      const spy = withdrawBeforeDelivery();

      try {
        const started = await startRun(
          [call('a', 'read', { path: fx.directory }), answer('same segment')],
          async (index, seeded) => {
            if (index === 0) await storeItems(seeded.chatId, ['never mind']);
          },
        );

        const finished = await terminal(started.runId);

        // Read at the step end, then again by the completion check.
        expect(finished.status).toBe('completed');
        expect(await types(started.runId)).not.toContain('run.delivered');
        expect(await lines(started.chatId)).toEqual([
          'user:first message',
          'assistant:same segment',
        ]);
        // The second request is the same segment's next step: it carries the
        // call's result and no steer.
        const second = started.prompts()[1] ?? [];
        expect(second).toContain('tool:tool-result');
        expect(second.at(-1)).not.toBe('user:never mind');
      } finally {
        spy.mockRestore();
      }
    });

    it('A withdrawal leaves the step budget the earlier calls left', async () => {
      const spy = withdrawBeforeDelivery();

      try {
        // The cap is 2: the first call used one step and stopped at the step
        // end, so the continuation has one tool step left, then the forced
        // answer.
        const started = await startRun(
          [
            call('a', 'read', { path: fx.directory }),
            call('b', 'read', { path: fx.directory }),
            answer('forced answer'),
          ],
          async (index, seeded) => {
            if (index === 0) await storeItems(seeded.chatId, ['never mind']);
          },
        );

        const finished = await terminal(started.runId);

        expect(finished.status).toBe('completed');
        const log = await types(started.runId);
        expect(log.filter((type) => type === 'tool.completed')).toHaveLength(2);
        expect(
          log.filter((type) => type === 'run.step_cap_reached'),
        ).toHaveLength(1);
        expect((await lines(started.chatId)).at(-1)).toBe(
          'assistant:forced answer',
        );
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('recovery of the current segment', () => {
    /**
     * A Run that delivered once and whose worker then died: its first reply is
     * stored, the item is delivered, and the Run row names the delivered
     * message. `before` runs after the claim, ahead of the delivery.
     */
    async function runAfterCrashInSecondSegment(
      steerText: string,
      before?: (seeded: SeededRun) => Promise<void>,
    ) {
      const seeded = await seed();
      await db((tx) =>
        new MessagesRepository(tx).createAssistantReplyIfAbsent({
          chatId: seeded.chatId,
          inReplyTo: seeded.userMessage.id,
          parts: [{ type: 'text', text: 'first reply' }],
          usage: { status: 'completed', complete: true },
        }),
      );

      const started = await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, fx.userId),
      );

      await db((tx) =>
        new RunEventsRepository(tx).append(seeded.runId, 'run.started'),
      );
      await before?.(seeded);
      await storeItems(seeded.chatId, [steerText]);

      const delivery = await db((tx) =>
        deliverPendingSteering(tx, {
          run: { runId: seeded.runId, userId: fx.userId },
          attemptId: started?.activeAttemptId ?? '',
          deadWorkerAfterSeconds: 60,
          models: [],
        }),
      );

      if (delivery.kind !== 'delivered') throw new Error('not delivered');

      return { ...seeded, delivered: delivery };
    }

    it('A crash retry keeps earlier segments, and a queue retry re-executes the loop from the current segment', async () => {
      const crashed = await runAfterCrashInSecondSegment('the steer');
      const retried = await launch(crashed, [answer('second reply')]);
      const finished = await terminal(crashed.runId);

      expect(finished.status).toBe('completed');
      expect(finished.messageId).toBe(crashed.delivered.message.id);
      expect(await lines(crashed.chatId)).toEqual([
        'user:first message',
        'assistant:first reply',
        'user:the steer',
        'assistant:second reply',
      ]);
      expect((await transcript(crashed.chatId))[3]?.inReplyTo).toBe(
        crashed.delivered.message.id,
      );
      // The retried request sends history through the delivered message: the
      // first segment, then the steer last.
      const sent = retried.prompts()[0] ?? [];
      expect(sent.indexOf('user:first message')).toBeGreaterThan(-1);
      expect(sent.indexOf('assistant:first reply')).toBeGreaterThan(
        sent.indexOf('user:first message'),
      );
      expect(sent.at(-1)).toBe('user:the steer');
    });
    it('A discarded stop result restores only its exact consumed notices', async () => {
      let keptId = '';
      let discardedId = '';
      let ownerDeletedId = '';

      const crashed = await runAfterCrashInSecondSegment(
        'continue',
        async (seeded) => {
          const kept = await settleNotice(seeded, { seq: 1 });
          const discarded = await settleNotice(seeded, { seq: 2 });
          const ownerDeleted = await settleNotice(seeded, { seq: 3 });
          keptId = kept.notice.id;
          discardedId = discarded.notice.id;
          ownerDeletedId = ownerDeleted.notice.id;

          await db(async (tx) => {
            const deliveries = new ChatDeliveriesRepository(tx);
            await deliveries.consumeJobNotices({
              chatId: seeded.chatId,
              ownerUserId: fx.userId,
              runId: seeded.runId,
              jobIds: [kept.job.id, discarded.job.id],
            });
            await deliveries.withdrawPending(
              seeded.chatId,
              ownerDeleted.notice.id,
              fx.userId,
            );
            await new RunEventsRepository(tx).append(
              seeded.runId,
              'tool.completed',
              {
                toolName: 'stop',
                consumedJobNoticeIds: [kept.notice.id],
              },
            );
          });
        },
      );

      await db(async (tx) => {
        const events = new RunEventsRepository(tx);
        await events.append(crashed.runId, 'tool.completed', {
          toolName: 'stop',
          consumedJobNoticeIds: [discardedId, ownerDeletedId],
        });
        await events.append(crashed.runId, 'tool.completed', {
          toolName: 'stop',
          consumedJobNoticeIds: [],
        });
      });

      const retried = await launch(crashed, [
        answer('retry keeps the earlier reply'),
        answer('notice restored'),
      ]);

      await terminal(crashed.runId);

      expect((await itemState(discardedId))?.state).toBe('delivered');
      expect(await itemState(keptId)).toMatchObject({
        state: 'withdrawn',
        runId: crashed.runId,
      });
      expect(await itemState(ownerDeletedId)).toMatchObject({
        state: 'withdrawn',
        runId: null,
      });
      expect(
        retried
          .prompts()[1]
          ?.some((line) => line.includes('Background job job://bash-2')),
      ).toBe(true);
      expect(
        retried
          .prompts()[1]
          ?.some(
            (line) =>
              line.includes('Background job job://bash-1') ||
              line.includes('Background job job://bash-3'),
          ),
      ).toBe(false);
      expect(retried.prompts()[0]).toContain('assistant:first reply');
    });

    it('A settled write in an earlier segment does not stop a retry', async () => {
      const crashed = await runAfterCrashInSecondSegment(
        'continue',
        async ({ runId }) => {
          await db((tx) =>
            new RunEventsRepository(tx).append(runId, 'native.attempt', {
              toolCallId: 'earlier-write',
              operation: 'write',
              path: join(fx.directory, 'earlier'),
            }),
          );
        },
      );

      await launch(crashed, [answer('carried on')]);
      expect((await terminal(crashed.runId)).status).toBe('completed');
    });

    it('A write attempted in the current segment stops a retry', async () => {
      const crashed = await runAfterCrashInSecondSegment('continue');
      await db((tx) =>
        new RunEventsRepository(tx).append(crashed.runId, 'native.attempt', {
          toolCallId: 'current-write',
          operation: 'write',
          path: join(fx.directory, 'current'),
        }),
      );
      await launch(crashed, [answer('unreachable')]);
      expect(await terminal(crashed.runId)).toMatchObject({
        status: 'failed',
        error: { code: 'outcome_unknown' },
      });
    });

    it('A finalizer leaves the reply of an earlier segment, and a rebuild covers only the current segment', async () => {
      // The earlier segment's own output sits before `run.delivered`, kept
      // parts of a Continue Run included.
      const crashed = await runAfterCrashInSecondSegment(
        'continue',
        async ({ runId }) => {
          await db(async (tx) => {
            const log = new RunEventsRepository(tx);
            await log.append(runId, 'run.continued', {
              sourceRunId: randomUUID(),
              parts: [{ type: 'text', text: 'kept earlier part' }],
              steps: {},
              results: {},
            });
            await log.append(runId, 'model.requested', {
              modelId: 'earlier',
              attemptId: 'earlier-attempt',
            });
            await log.append(runId, 'model.delta', {
              text: 'earlier segment text',
              stepNumber: 0,
            });
          });
        },
      );

      const attemptId = crashed.delivered.attemptId;
      await db(async (tx) => {
        const log = new RunEventsRepository(tx);
        await log.append(crashed.runId, 'model.requested', {
          modelId: crashed.modelId,
          attemptId,
        });
        await log.append(crashed.runId, 'model.delta', {
          text: 'current segment text',
          stepNumber: 0,
        });
      });

      const replyId = await db(async (tx) => {
        const reply = await new MessagesRepository(
          tx,
        ).createAssistantReplyIfAbsent({
          chatId: crashed.chatId,
          inReplyTo: crashed.delivered.message.id,
          parts: [],
          usage: {
            status: 'running',
            complete: false,
            runId: crashed.runId,
            attemptId,
            modelId: crashed.modelId,
          },
        });

        return reply?.id;
      });

      const current = await run(crashed.runId);

      if (!current) throw new Error('Run missing');
      await db((tx) =>
        finalizeRunReply(tx, { run: current, status: 'failed', models: [] }),
      );

      const messages = await transcript(crashed.chatId);
      expect(messages.find((message) => message.id === replyId)?.text).toBe(
        'current segment text',
      );
      expect(messages[1]).toMatchObject({
        text: 'first reply',
        status: 'completed',
      });
    });

    it('A cancellation after a delivery leaves the earlier reply', async () => {
      const crashed = await runAfterCrashInSecondSegment(
        'continue',
        async ({ runId }) => {
          await db((tx) =>
            new RunEventsRepository(tx).append(runId, 'model.requested', {
              modelId: 'earlier',
              attemptId: 'earlier-attempt',
            }),
          );
        },
      );

      await db((tx) =>
        new RunsRepository(tx).requestCancel(crashed.runId, fx.userId),
      );
      const callsBefore = fx.harness.models.streamCalls.length;
      await launch(crashed, [answer('must not run')]);
      expect((await terminal(crashed.runId)).status).toBe('cancelled');

      expect(fx.harness.models.streamCalls).toHaveLength(callsBefore);
      // The delivered message gets no reply, and the earlier one is unchanged.
      expect(await lines(crashed.chatId)).toEqual([
        'user:first message',
        'assistant:first reply',
        'user:continue',
      ]);
    });

    it('A cancellation recorded after a delivery settles the Run before the next request', async () => {
      // Keep the real implementation before Vitest replaces the prototype.
      const originalUpdateForAttempt: (
        this: RunsRepository,
        ...args: Parameters<RunsRepository['updateForAttempt']>
      ) => Promise<Run | undefined> =
        // eslint-disable-next-line typescript/unbound-method -- apply below supplies the repository receiver explicitly.
        RunsRepository.prototype.updateForAttempt;

      let dispatches = 0;

      // The second dispatch belongs to the segment that the delivery started:
      // the cancellation lands after the delivery, before that dispatch fences
      // the attempt. No abort reaches this worker.
      const spy = vi
        .spyOn(RunsRepository.prototype, 'updateForAttempt')
        .mockImplementation(async function (
          this: RunsRepository,
          ...args: Parameters<RunsRepository['updateForAttempt']>
        ): Promise<Run | undefined> {
          const [runId, owner, , set] = args;

          if (set.turnToolAvailability !== undefined) {
            dispatches += 1;

            if (dispatches === 2) {
              await db((tx) =>
                new RunsRepository(tx).requestCancel(runId, owner),
              );
            }
          }

          // eslint-disable-next-line typescript/no-unsafe-return -- Function.apply loses the captured method's declared result type.
          return originalUpdateForAttempt.apply(this, args);
        });

      try {
        const started = await startRun(
          [call('a', 'read', { path: fx.directory }), answer('must not run')],
          async (index, seeded) => {
            if (index === 0) await storeItems(seeded.chatId, ['redirect']);
          },
        );

        const finished = await terminal(started.runId);

        expect(finished.status).toBe('cancelled');
        const messages = await transcript(started.chatId);
        // The delivered message gets no reply; the first segment's is unchanged.
        expect(messages.map(({ role, status }) => `${role}:${status}`)).toEqual(
          ['user:undefined', 'assistant:completed', 'user:undefined'],
        );
        expect(started.prompts()).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('A superseded attempt cannot deliver', async () => {
      const seeded = await seed();

      const first = await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, fx.userId),
      );

      // A newer attempt claims the Run.
      await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, fx.userId),
      );
      const [item] = await storeItems(seeded.chatId, ['stale']);

      const result = await db((tx) =>
        deliverPendingSteering(tx, {
          run: { runId: seeded.runId, userId: fx.userId },
          attemptId: first?.activeAttemptId ?? '',
          deadWorkerAfterSeconds: 60,
          models: [],
        }),
      );

      expect(result.kind).toBe('fenced');
      expect(await itemState(item ?? '')).toMatchObject({ state: 'pending' });
      expect(
        (await transcript(seeded.chatId)).filter((m) => m.role === 'user'),
      ).toHaveLength(1);
      expect(await types(seeded.runId)).not.toContain('run.delivered');
    });

    it('A crash before delivery keeps the item', async () => {
      const seeded = await seed();

      const started = await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, fx.userId),
      );

      const [item] = await storeItems(seeded.chatId, ['survives']);
      const attemptId = started?.activeAttemptId ?? '';
      // The worker dies after the delivery wrote everything and before commit.
      await expect(
        db(async (tx) => {
          await deliverPendingSteering(tx, {
            run: { runId: seeded.runId, userId: fx.userId },
            attemptId,
            deadWorkerAfterSeconds: 60,
            models: [],
          });
          throw new Error('worker died');
        }),
      ).rejects.toThrow('worker died');

      expect(await itemState(item ?? '')).toMatchObject({ state: 'pending' });
      const unchanged = await run(seeded.runId);
      expect(unchanged).toMatchObject({
        messageId: seeded.userMessage.id,
        activeAttemptId: attemptId,
      });
      expect(await types(seeded.runId)).not.toContain('run.delivered');

      // The retried attempt delivers it once.
      const retried = await db((tx) =>
        deliverPendingSteering(tx, {
          run: { runId: seeded.runId, userId: fx.userId },
          attemptId,
          deadWorkerAfterSeconds: 60,
          models: [],
        }),
      );

      expect(retried.kind).toBe('delivered');

      const again = await db((tx) =>
        deliverPendingSteering(tx, {
          run: { runId: seeded.runId, userId: fx.userId },
          attemptId: retried.kind === 'delivered' ? retried.attemptId : '',
          deadWorkerAfterSeconds: 60,
          models: [],
        }),
      );

      expect(again.kind).toBe('nothing-pending');
    });
  });

  describe('tenant isolation', () => {
    it("Another owner's session reaches nothing of this Run, and changes nothing", async () => {
      const seeded = await seed();

      const started = await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, fx.userId),
      );

      const attemptId = started?.activeAttemptId ?? '';
      const [item] = await storeItems(seeded.chatId, ['private']);
      const stranger = await createUser(fx.harness.db, 'run-segments-stranger');
      // Every call names the owner's identity, as a forged caller would: the
      // session's own identity is what the row security policy enforces.
      const owner = fx.userId;

      const attempt = await fx.harness.tenantDb.runAs(stranger, async (tx) => ({
        signal: await new ChatDeliveriesRepository(tx).stepEndSignal({
          runId: seeded.runId,
          chatId: seeded.chatId,
          userId: owner,
        }),
        locked: await new RunRowFenceRepository(tx).lockForDelivery(
          seeded.runId,
          owner,
          attemptId,
        ),
        pending: await new ChatDeliveriesRepository(tx).lockPendingBoundary(
          seeded.chatId,
          owner,
        ),
        delivery: await deliverPendingSteering(tx, {
          run: { runId: seeded.runId, userId: owner },
          attemptId,
          deadWorkerAfterSeconds: 60,
          models: [],
        }),
      }));

      // The Run is invisible, so the step end fails closed to a stop.
      expect(attempt).toEqual({
        signal: 'cancel',
        locked: undefined,
        pending: [],
        delivery: { kind: 'fenced' },
      });
      expect(await itemState(item ?? '')).toMatchObject({ state: 'pending' });
      expect(await run(seeded.runId)).toMatchObject({
        messageId: seeded.userMessage.id,
        activeAttemptId: attemptId,
      });
      expect(await types(seeded.runId)).not.toContain('run.delivered');
    });
  });
});

describe('run steering segments without tools', () => {
  const fx = useSegmentsFixture('run-segments-bare', { allowedTools: [] });

  it('A steer during the final answer, with no tools', async () => {
    const started = await fx.startRun(
      [answer('only answer'), answer('after the steer')],
      async (index, seeded) => {
        if (index === 0) await fx.storeItems(seeded.chatId, ['late thought']);
      },
    );

    const finished = await fx.terminal(started.runId);

    // No `stopWhen` exists without tools: the completion check alone kept it live.
    expect(fx.harness.models.declarations.at(-1)?.tools).toEqual([]);
    expect(finished.status).toBe('completed');
    expect(await fx.lines(started.chatId)).toEqual([
      'user:first message',
      'assistant:only answer',
      'user:late thought',
      'assistant:after the steer',
    ]);
  });

  it('A salvaged reply with a pending item continues the Run instead of completing it', async () => {
    const seeded = await fx.seed();
    await fx.db((tx) =>
      // The salvaged answer already completed the reply while the Run stayed live.
      new MessagesRepository(tx).createAssistantReplyIfAbsent({
        chatId: seeded.chatId,
        inReplyTo: seeded.userMessage.id,
        parts: [{ type: 'text', text: 'salvaged answer' }],
        usage: { status: 'completed', complete: true },
      }),
    );
    await fx.storeItems(seeded.chatId, ['pending at salvage']);
    await fx.launch(seeded, [answer('answer to the steer')]);
    const finished = await fx.terminal(seeded.runId);

    expect(finished.status).toBe('completed');
    expect(await fx.lines(seeded.chatId)).toEqual([
      'user:first message',
      'assistant:salvaged answer',
      'user:pending at salvage',
      'assistant:answer to the steer',
    ]);
  });
});

describe('run steering segments and the time limits', () => {
  const fx = useSegmentsFixture('run-segments-budget', {
    allowedTools: ['bash'],
    nativeExecutorId: 'run-segments-budget-host',
    timeoutSeconds: 4,
  });

  it('A long steered Run reaches its budget, because a delivery does not restart the limits', async () => {
    // Test-side clock marks: the Run row's timestamps come from the database
    // clock and the app clock mixed, which can differ by seconds under Docker.
    let firstRequestAt = 0;
    let secondRequestAt = 0;

    const started = await fx.startRun(
      [
        call('first', 'bash', { command: 'sleep 2', cwd: fx.directory }),
        call('second', 'bash', { command: 'sleep 20', cwd: fx.directory }),
      ],
      async (index, seeded) => {
        if (index === 0) {
          firstRequestAt = Date.now();
          await fx.storeItems(seeded.chatId, ['keep going']);
        }

        if (index === 1) secondRequestAt = Date.now();
      },
    );

    const finished = await fx.terminal(started.runId);
    const settledAt = Date.now();

    expect(finished.status).toBe('expired');
    expect(await fx.types(started.runId)).toContain('run.delivered');
    // The budget (four seconds) runs from the claim, just before the first
    // request. The delivery came two seconds in, so a budget that ran on
    // would end under four seconds after the second request, and one that
    // restarted at the delivery could not end before four.
    expect(settledAt - firstRequestAt).toBeGreaterThanOrEqual(3000);
    expect(settledAt - secondRequestAt).toBeLessThan(3900);
  });
});
