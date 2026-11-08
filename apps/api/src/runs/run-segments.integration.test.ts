/**
 * run-steering, `segments` layer — the delivery machinery against real
 * Postgres (RLS active) and the co-located worker, with the scripted model
 * client. No HTTP admits a `steer` yet: pending items are stored directly in
 * `chat_deliveries`, as the layer contract says, so the suite proves the step
 * end check, the delivery transaction, the completion check, and recovery of
 * the current segment.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { MessagesRepository } from '../chats/chats-repository';
import { type ChatDeliveryMode, type Run } from '../db/schema';
import { waitFor } from '../testing/support';
import { finalizeRunReply } from './run-reply-finalizer';
import { isTerminalRunStatus } from './run-status';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { type ScriptedStep } from './scripted-model-step';
import { deliverPendingSteering } from './segment-delivery';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedRun,
  type WorkerHarness,
} from './worker-harness';

const describeIfDb = process.env['TEST_DATABASE_URL']
  ? describe
  : describe.skip;

vi.setConfig({ testTimeout: 90_000 });

const answer = (text: string): ScriptedStep => [
  { type: 'text', id: 't', text },
];
const call = (
  toolCallId: string,
  toolName: string,
  input: UnknownRecord,
): ScriptedStep => [{ type: 'tool-call', toolCallId, toolName, input }];

/** The slice of a provider message the scenarios read. */
type ProviderMessage = {
  role: string;
  content: string | ReadonlyArray<{ type: string; text?: string }>;
};

/** One flattened provider message: `role:text` or `role:<part type>`. */
function flatten(prompt: ReadonlyArray<ProviderMessage>): Array<string> {
  return prompt.flatMap(({ role, content }) =>
    isString(content)
      ? [`${role}:${content}`]
      : content.map((part) =>
          part.type === 'text'
            ? `${role}:${part.text}`
            : `${role}:${part.type}`,
        ),
  );
}

describeIfDb('run steering segments', () => {
  let harness: WorkerHarness;
  let userId: string;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'run-segments-'));
    harness = await bootWorkerHarness({
      allowedTools: ['read', 'bash'],
      nativeExecutorId: 'run-segments-host',
      maxStepsPerRun: 2,
    });
    userId = await createUser(harness.db, 'run-segments');
  });

  afterAll(async () => {
    if (harness) await harness.close();
    await rm(directory, { recursive: true, force: true });
  });

  const db = <T>(work: Parameters<typeof harness.tenantDb.runAs<T>>[1]) =>
    harness.tenantDb.runAs(userId, work);

  /** A pending item of the Chat, as admission will store it in a later layer. */
  async function storeItems(
    chatId: string,
    texts: ReadonlyArray<string>,
    mode: ChatDeliveryMode = 'steer',
  ): Promise<Array<string>> {
    const ids: Array<string> = [];
    for (const text of texts) {
      const id = randomUUID();
      await db((tx) =>
        new ChatDeliveriesRepository(tx).insertPending({
          id,
          chatId,
          ownerUserId: userId,
          mode,
          parts: [{ type: 'text', text }],
          settings: { modelId: 'ignored-by-steer', permissionMode: 'default' },
        }),
      );
      ids.push(id);
    }
    return ids;
  }

  const items = (chatId: string) =>
    db((tx) => new ChatDeliveriesRepository(tx).listPending(chatId, userId));

  const itemState = (id: string) =>
    db((tx) => new ChatDeliveriesRepository(tx).findById(id, userId));

  const events = (runId: string) =>
    db((tx) => new RunEventsRepository(tx).listByRunId(runId, userId));

  const types = async (runId: string) =>
    (await events(runId)).map((event) => event.eventType);

  const run = (runId: string) =>
    db((tx) => new RunsRepository(tx).findById(runId, userId));

  const terminal = (runId: string) =>
    waitFor(
      async () => {
        const found = await run(runId);
        return found && isTerminalRunStatus(found.status) ? found : undefined;
      },
      40_000,
      `Run ${runId} to settle`,
    );

  /** The Chat in `seq` order, reduced to what the scenarios assert. */
  async function transcript(chatId: string) {
    const messages = await db((tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      inReplyTo: message.inReplyTo,
      text: message.parts
        .flatMap((part) =>
          isRecord(part) && part['type'] === 'text' && isString(part['text'])
            ? [part['text']]
            : [],
        )
        .join('|'),
      status:
        isRecord(message.usage) && isString(message.usage['status'])
          ? message.usage['status']
          : undefined,
      usage: message.usage,
    }));
  }

  /** Seeds and dispatches a Run on a scripted model; `beforeStep` may store items. */
  async function startRun(
    steps: ReadonlyArray<ScriptedStep>,
    beforeStep?: (
      stepIndex: number,
      seeded: { chatId: string; runId: string },
    ) => Promise<void> | void,
    options: { target?: WorkerHarness } = {},
  ) {
    const target = options.target ?? harness;
    const modelId = `segments-${randomUUID()}`;
    const seeded = await seedRun({
      tenantDb: target.tenantDb,
      userId,
      modelId,
      text: 'first message',
    });
    target.models.register(modelId, {
      kind: 'step-script',
      steps,
      ...(beforeStep !== undefined && {
        beforeStep: (index) => beforeStep(index, seeded),
      }),
    });
    const promptsBefore = target.models.prompts.length;
    await dispatchRun({ queue: target.queue, ...seeded, userId, modelId });
    return {
      ...seeded,
      modelId,
      prompts: () =>
        target.models.prompts
          .slice(promptsBefore)
          .map((prompt) => flatten(prompt)),
    };
  }

  describe('the step end check and the delivery', () => {
    it('A steer during a tool call waits for the result', async () => {
      let chatId = '';
      const started = await startRun([
        call('slow', 'bash', {
          command: 'sleep 1; echo slept',
          cwd: directory,
        }),
        answer('after the steer'),
      ]);
      chatId = started.chatId;
      await waitFor(
        async () =>
          (await types(started.runId)).includes('tool.started')
            ? true
            : undefined,
        20_000,
        'the bash call to start',
      );
      await storeItems(chatId, ['change course']);
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
            ...call('r1', 'read', { path: directory }),
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
          call('a', 'read', { path: directory }),
          call('b', 'read', { path: directory }),
          call('c', 'read', { path: directory }),
          call('d', 'read', { path: directory }),
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
          call('a', 'read', { path: directory }),
          call('b', 'read', { path: directory }),
          answer('capped answer'),
          call('c', 'read', { path: directory }),
          call('d', 'read', { path: directory }),
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
        [call('a', 'read', { path: directory }), answer('both seen')],
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
        new MessagesRepository(tx).findByChatId(started.chatId, userId),
      );
      expect(
        stored.find((message) => message.id === delivered[0]?.id)?.senderUserId,
      ).toBe(userId);
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
        [call('a', 'read', { path: directory }), answer('second reply')],
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
        [call('a', 'read', { path: directory }), answer('end')],
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
        [call('a', 'read', { path: directory }), answer('never reached')],
        async (index, seeded) => {
          if (index !== 0) return;
          await storeItems(seeded.chatId, ['too late']);
          // Recorded, but no abort reaches this worker.
          await db((tx) =>
            new RunsRepository(tx).requestCancel(seeded.runId, userId),
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
  });

  describe('the completion check', () => {
    it('A steer during the final answer', async () => {
      const started = await startRun(
        [
          call('a', 'read', { path: directory }),
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

    it('A withdrawal after the step end', async () => {
      const withdrawn = randomUUID();
      // The step end saw the item; the owner withdraws it before the delivery
      // transaction reads the pending items, which then find none.
      const spy = vi
        .spyOn(ChatDeliveriesRepository.prototype, 'lockPendingSteering')
        .mockImplementationOnce(async (chatId) => {
          await db((tx) =>
            new ChatDeliveriesRepository(tx).withdrawPending(
              chatId,
              withdrawn,
              userId,
            ),
          );
          return [];
        });
      try {
        const started = await startRun(
          [call('a', 'read', { path: directory }), answer('same segment')],
          async (index, seeded) => {
            if (index !== 0) return;
            await db((tx) =>
              new ChatDeliveriesRepository(tx).insertPending({
                id: withdrawn,
                chatId: seeded.chatId,
                ownerUserId: userId,
                mode: 'steer',
                parts: [{ type: 'text', text: 'never mind' }],
                settings: { modelId: 'x', permissionMode: 'default' },
              }),
            );
          },
        );
        const finished = await terminal(started.runId);

        // Read at the step end, then again by the completion check.
        expect(spy).toHaveBeenCalledTimes(2);
        expect(finished.status).toBe('completed');
        expect(await types(started.runId)).not.toContain('run.delivered');
        const messages = await transcript(started.chatId);
        expect(messages.map(({ role, text }) => `${role}:${text}`)).toEqual([
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
      const modelId = `segments-retry-${randomUUID()}`;
      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId,
        text: 'first message',
      });
      await db((tx) =>
        new MessagesRepository(tx).createAssistantReplyIfAbsent({
          chatId: seeded.chatId,
          inReplyTo: seeded.userMessage.id,
          parts: [{ type: 'text', text: 'first reply' }],
          usage: { status: 'completed', complete: true },
        }),
      );
      const started = await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, userId),
      );
      await db((tx) =>
        new RunEventsRepository(tx).append(seeded.runId, 'run.started'),
      );
      await before?.(seeded);
      await storeItems(seeded.chatId, [steerText]);
      const delivery = await db((tx) =>
        deliverPendingSteering(tx, {
          run: { runId: seeded.runId, userId },
          attemptId: started?.activeAttemptId ?? '',
          models: [],
        }),
      );
      if (delivery.kind !== 'delivered') throw new Error('not delivered');
      return { ...seeded, modelId, delivered: delivery };
    }

    it('A crash retry keeps earlier segments, and a queue retry re-executes the loop from the current segment', async () => {
      const crashed = await runAfterCrashInSecondSegment('the steer');
      const promptsBefore = harness.models.prompts.length;
      harness.models.register(crashed.modelId, {
        kind: 'step-script',
        steps: [answer('second reply')],
      });
      await dispatchRun({
        queue: harness.queue,
        ...crashed,
        userId,
        modelId: crashed.modelId,
      });
      const finished = await terminal(crashed.runId);

      expect(finished.status).toBe('completed');
      expect(finished.messageId).toBe(crashed.delivered.message.id);
      const messages = await transcript(crashed.chatId);
      expect(messages.map(({ role, text }) => `${role}:${text}`)).toEqual([
        'user:first message',
        'assistant:first reply',
        'user:the steer',
        'assistant:second reply',
      ]);
      expect(messages[3]?.inReplyTo).toBe(crashed.delivered.message.id);
      // The retried request sends history through the delivered message: the
      // first segment, then the steer last.
      const sent = flatten(harness.models.prompts[promptsBefore] ?? []);
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
              path: join(directory, 'earlier'),
            }),
          );
        },
      );
      harness.models.register(crashed.modelId, {
        kind: 'step-script',
        steps: [answer('carried on')],
      });
      await dispatchRun({
        queue: harness.queue,
        ...crashed,
        userId,
        modelId: crashed.modelId,
      });
      expect((await terminal(crashed.runId)).status).toBe('completed');
    });

    it('A write attempted in the current segment stops a retry', async () => {
      const crashed = await runAfterCrashInSecondSegment('continue');
      await db((tx) =>
        new RunEventsRepository(tx).append(crashed.runId, 'native.attempt', {
          toolCallId: 'current-write',
          operation: 'write',
          path: join(directory, 'current'),
        }),
      );
      harness.models.register(crashed.modelId, {
        kind: 'step-script',
        steps: [answer('unreachable')],
      });
      await dispatchRun({
        queue: harness.queue,
        ...crashed,
        userId,
        modelId: crashed.modelId,
      });
      expect(await terminal(crashed.runId)).toMatchObject({
        status: 'failed',
        error: { code: 'outcome_unknown' },
      });
    });

    it('A finalizer leaves the reply of an earlier segment, and a rebuild covers only the current segment', async () => {
      // The earlier segment's own output sits before `run.delivered`.
      const crashed = await runAfterCrashInSecondSegment(
        'continue',
        async ({ runId }) => {
          await db(async (tx) => {
            const log = new RunEventsRepository(tx);
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
        new RunsRepository(tx).requestCancel(crashed.runId, userId),
      );
      harness.models.register(crashed.modelId, {
        kind: 'step-script',
        steps: [answer('must not run')],
      });
      const callsBefore = harness.models.streamCalls.length;
      await dispatchRun({
        queue: harness.queue,
        ...crashed,
        userId,
        modelId: crashed.modelId,
      });
      expect((await terminal(crashed.runId)).status).toBe('cancelled');

      expect(harness.models.streamCalls).toHaveLength(callsBefore);
      const messages = await transcript(crashed.chatId);
      // The delivered message gets no reply, and the earlier one is unchanged.
      expect(messages.map(({ role, text }) => `${role}:${text}`)).toEqual([
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
          [call('a', 'read', { path: directory }), answer('must not run')],
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
      const modelId = `segments-superseded-${randomUUID()}`;
      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId,
      });
      const first = await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, userId),
      );
      // A newer attempt claims the Run.
      await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, userId),
      );
      const [item] = await storeItems(seeded.chatId, ['stale']);
      const result = await db((tx) =>
        deliverPendingSteering(tx, {
          run: { runId: seeded.runId, userId },
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
      const modelId = `segments-crash-${randomUUID()}`;
      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId,
      });
      const started = await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, userId),
      );
      const [item] = await storeItems(seeded.chatId, ['survives']);
      const attemptId = started?.activeAttemptId ?? '';
      // The worker dies after the delivery wrote everything and before commit.
      await expect(
        db(async (tx) => {
          await deliverPendingSteering(tx, {
            run: { runId: seeded.runId, userId },
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
          run: { runId: seeded.runId, userId },
          attemptId,
          models: [],
        }),
      );
      expect(retried.kind).toBe('delivered');
      const again = await db((tx) =>
        deliverPendingSteering(tx, {
          run: { runId: seeded.runId, userId },
          attemptId: retried.kind === 'delivered' ? retried.attemptId : '',
          models: [],
        }),
      );
      expect(again.kind).toBe('nothing-pending');
    });
  });
});

describeIfDb('run steering segments without tools', () => {
  let harness: WorkerHarness;
  let userId: string;

  beforeAll(async () => {
    harness = await bootWorkerHarness({ allowedTools: [] });
    userId = await createUser(harness.db, 'run-segments-bare');
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('A steer during the final answer, with no tools', async () => {
    const modelId = `segments-bare-${randomUUID()}`;
    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      text: 'first message',
    });
    harness.models.register(modelId, {
      kind: 'step-script',
      steps: [answer('only answer'), answer('after the steer')],
      beforeStep: async (index) => {
        if (index !== 0) return;
        await harness.tenantDb.runAs(userId, (tx) =>
          new ChatDeliveriesRepository(tx).insertPending({
            id: randomUUID(),
            chatId: seeded.chatId,
            ownerUserId: userId,
            mode: 'steer',
            parts: [{ type: 'text', text: 'late thought' }],
            settings: { modelId, permissionMode: 'default' },
          }),
        );
      },
    });
    await dispatchRun({ queue: harness.queue, ...seeded, userId, modelId });
    const finished = await waitFor(
      async () => {
        const found = await harness.tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(seeded.runId, userId),
        );
        return found && isTerminalRunStatus(found.status) ? found : undefined;
      },
      40_000,
      'the Run to settle',
    );

    // No `stopWhen` exists without tools: the completion check alone kept it live.
    expect(harness.models.declarations.at(-1)?.tools).toEqual([]);
    expect(finished.status).toBe('completed');
    const messages = await harness.tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(seeded.chatId, userId),
    );
    expect(
      messages.map((message) =>
        message.parts.flatMap((part) =>
          isRecord(part) && isString(part['text']) ? [part['text']] : [],
        ),
      ),
    ).toEqual([
      ['first message'],
      ['only answer'],
      ['late thought'],
      ['after the steer'],
    ]);
  });

  it('A salvaged reply with a pending item continues the Run instead of completing it', async () => {
    const modelId = `segments-salvage-${randomUUID()}`;
    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      text: 'first message',
    });
    await harness.tenantDb.runAs(userId, async (tx) => {
      // The salvaged answer already completed the reply while the Run stayed live.
      await new MessagesRepository(tx).createAssistantReplyIfAbsent({
        chatId: seeded.chatId,
        inReplyTo: seeded.userMessage.id,
        parts: [{ type: 'text', text: 'salvaged answer' }],
        usage: { status: 'completed', complete: true },
      });
      await new ChatDeliveriesRepository(tx).insertPending({
        id: randomUUID(),
        chatId: seeded.chatId,
        ownerUserId: userId,
        mode: 'steer',
        parts: [{ type: 'text', text: 'pending at salvage' }],
        settings: { modelId, permissionMode: 'default' },
      });
    });
    harness.models.register(modelId, {
      kind: 'step-script',
      steps: [answer('answer to the steer')],
    });
    await dispatchRun({ queue: harness.queue, ...seeded, userId, modelId });
    const finished = await waitFor(
      async () => {
        const found = await harness.tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(seeded.runId, userId),
        );
        return found && isTerminalRunStatus(found.status) ? found : undefined;
      },
      40_000,
      'the Run to settle',
    );

    expect(finished.status).toBe('completed');
    const messages = await harness.tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(seeded.chatId, userId),
    );
    expect(
      messages.map((message) =>
        message.parts.flatMap((part) =>
          isRecord(part) && isString(part['text']) ? [part['text']] : [],
        ),
      ),
    ).toEqual([
      ['first message'],
      ['salvaged answer'],
      ['pending at salvage'],
      ['answer to the steer'],
    ]);
  });
});

describeIfDb('run steering segments and the time limits', () => {
  let harness: WorkerHarness;
  let userId: string;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'run-segments-budget-'));
    harness = await bootWorkerHarness({
      allowedTools: ['bash'],
      nativeExecutorId: 'run-segments-budget-host',
      timeoutSeconds: 4,
    });
    userId = await createUser(harness.db, 'run-segments-budget');
  });

  afterAll(async () => {
    if (harness) await harness.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('A long steered Run reaches its budget, because a delivery does not restart the limits', async () => {
    const modelId = `segments-budget-${randomUUID()}`;
    const seeded = await seedRun({
      tenantDb: harness.tenantDb,
      userId,
      modelId,
      text: 'first message',
    });
    harness.models.register(modelId, {
      kind: 'step-script',
      steps: [
        call('first', 'bash', { command: 'sleep 3', cwd: directory }),
        call('second', 'bash', { command: 'sleep 20', cwd: directory }),
      ],
      beforeStep: async (index) => {
        if (index !== 0) return;
        await harness.tenantDb.runAs(userId, (tx) =>
          new ChatDeliveriesRepository(tx).insertPending({
            id: randomUUID(),
            chatId: seeded.chatId,
            ownerUserId: userId,
            mode: 'steer',
            parts: [{ type: 'text', text: 'keep going' }],
            settings: { modelId, permissionMode: 'default' },
          }),
        );
      },
    });
    await dispatchRun({ queue: harness.queue, ...seeded, userId, modelId });
    const finished = await waitFor(
      async () => {
        const found = await harness.tenantDb.runAs(userId, (tx) =>
          new RunsRepository(tx).findById(seeded.runId, userId),
        );
        return found && isTerminalRunStatus(found.status) ? found : undefined;
      },
      40_000,
      'the Run to expire',
    );

    expect(finished.status).toBe('expired');
    const log = await harness.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(seeded.runId, userId),
    );
    // It expired in its second segment, four seconds after the claim; a
    // delivery that restarted the budget would have run past seven.
    expect(log.map((event) => event.eventType)).toContain('run.delivered');
    const elapsedMs =
      (finished.finishedAt?.getTime() ?? 0) -
      (finished.startedAt?.getTime() ?? 0);
    expect(elapsedMs).toBeGreaterThanOrEqual(3900);
    expect(elapsedMs).toBeLessThan(6500);
  });
});
