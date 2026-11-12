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
import { MessagesRepository } from '../chats/chats-repository';
import { type Run } from '../db/schema';
import { waitFor } from '../testing/support';
import { finalizeRunReply } from './run-reply-finalizer';
import {
  answer,
  call,
  useSegmentsFixture,
} from '../testing/run-segments.test-fixture';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { deliverPendingSteering } from './segment-delivery';
import { createUser } from './worker-harness';

if (!process.env['TEST_DATABASE_URL']) {
  throw new Error(
    'run-segments.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

describe('run steering segments', () => {
  const fx = useSegmentsFixture('run-segments', {
    allowedTools: ['read', 'bash'],
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

  describe('the step end check and the delivery', () => {
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
        .spyOn(ChatDeliveriesRepository.prototype, 'lockPendingSteering')
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
        expect(spy).toHaveBeenCalledTimes(2);
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
      before?: (seeded: { runId: string }) => Promise<void>,
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
      // eslint-disable-next-line typescript/unbound-method -- called back with its own receiver below.
      const update = RunsRepository.prototype.updateForAttempt;
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

          // eslint-disable-next-line typescript/no-unsafe-return -- the spied method's own result, passed through.
          return update.apply(this, args);
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
          models: [],
        }),
      );

      expect(retried.kind).toBe('delivered');

      const again = await db((tx) =>
        deliverPendingSteering(tx, {
          run: { runId: seeded.runId, userId: fx.userId },
          attemptId: retried.kind === 'delivered' ? retried.attemptId : '',
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
        locked: await new RunsRepository(tx).lockForDelivery(
          seeded.runId,
          owner,
          attemptId,
        ),
        pending: await new ChatDeliveriesRepository(tx).lockPendingSteering(
          seeded.chatId,
          owner,
        ),
        delivery: await deliverPendingSteering(tx, {
          run: { runId: seeded.runId, userId: owner },
          attemptId,
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
