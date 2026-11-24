/**
 * A model switch inside a live Run (model-roles D6, tasks 5.2, 5.3) against
 * real Postgres: the failed close, the host message, the move, and the events.
 * Nothing in production calls the switch in this layer, so the suite calls
 * `deliverModelSwitch` directly inside the attempt-fenced transaction a worker
 * would hold.
 *
 * Requires TEST_DATABASE_URL; run by `test:integration`.
 */

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { isContextItemPart, type ContextItemPart } from '../chats/context-item';
import { isModelChangePayload } from '../chats/context-item-producers';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { RunningReplyRepository } from '../chats/running-reply-repository';
import { type Message } from '../db/schema';
import { isRecord, isString } from '@workspace/runtime-safety';

import { useSegmentsFixture } from '../testing/run-segments.test-fixture';
import { type Db } from '../db/tenant-db.service';
import { dispatchRun } from './worker-harness';
import { deliverModelSwitch, type ModelSwitchResult } from './model-switch';
import { runningReplyUsage } from './run-reply-finalizer';
import { RunEventsRepository, RunsRepository } from './runs-repository';

const SONNET = 'system:anthropic:claude-sonnet';

const telemetry = (input: { attemptId: string; modelId: string }) => ({
  runId: input.attemptId,
  attemptId: input.attemptId,
  modelId: input.modelId,
  latencyMs: 10,
  finishReason: 'stop' as const,
  status: 'completed' as const,
  complete: true,
});

describe('the model switch inside a live Run', () => {
  const fx = useSegmentsFixture('model-switch', {
    allowedTools: ['read'],
    localMachine: 'model-switch-host',
  });

  type LiveSwitch = {
    chatId: string;
    runId: string;
    attemptId: string;
    userMessageId: string;
    steerId: string;
    /** The fixture's model id; the operator catalog need not know it. */
    modelId: string;
  };

  /**
   * A Chat whose Run has dispatched on `codex`: a `running` reply under its
   * attempt and one steer waiting at the boundary. The session-level ID text
   * is what the test reads, so it is the only attempt whose reply exists.
   */
  async function seedLiveSwitch(): Promise<LiveSwitch> {
    const seeded = await fx.seed('switch this turn');

    const attemptId = await fx.db(async (tx) => {
      const started = await new RunsRepository(tx).markStarted(
        seeded.runId,
        fx.userId,
      );

      const claimed = started?.activeAttemptId;

      if (!claimed) throw new Error('The switch fixture claimed no attempt.');

      await new ChatsRepository(tx).setModelSelection(
        seeded.chatId,
        fx.userId,
        { revision: 1, selector: seeded.modelId, effort: 'high' },
      );
      await new RunsRepository(tx).updateForAttempt(
        seeded.runId,
        fx.userId,
        claimed,
        {
          effort: 'high',
          selectedEffort: 'high',
          selector: seeded.modelId,
          selectionRevision: 1,
        },
      );

      await new RunningReplyRepository(tx).upsertRunningReply({
        chatId: seeded.chatId,
        inReplyTo: seeded.userMessage.id,
        usage: runningReplyUsage({
          runId: seeded.runId,
          attemptId: claimed,
          modelId: seeded.modelId,
          effort: 'high',
          permissionMode: 'default',
        }),
        followUpAction: null,
      });

      return claimed;
    });

    const [steerId] = await fx.storeItems(seeded.chatId, ['wait for me']);

    if (steerId === undefined) throw new Error('The steer was not stored.');

    return {
      chatId: seeded.chatId,
      runId: seeded.runId,
      attemptId,
      userMessageId: seeded.userMessage.id,
      steerId,
      modelId: seeded.modelId,
    };
  }

  type SwitchExtras = {
    failureClass?: 'overloaded' | 'auth';
    toEffort?: string | null;
    beforeSwitch?: 'cancel' | 'fence';
  };

  function switchFrom(
    tx: Db,
    live: LiveSwitch,
    extras: SwitchExtras & { beforeSwitch: 'cancel' | 'fence' },
  ): Promise<ModelSwitchResult | undefined>;
  function switchFrom(
    tx: Db,
    live: LiveSwitch,
    extras?: SwitchExtras,
  ): Promise<ModelSwitchResult>;
  async function switchFrom(
    tx: Db,
    live: LiveSwitch,
    extras: SwitchExtras = {},
  ): Promise<ModelSwitchResult | undefined> {
    if (extras.beforeSwitch === 'cancel') {
      await new RunsRepository(tx).requestCancel(live.runId, fx.userId);
    } else if (extras.beforeSwitch === 'fence') {
      await new RunsRepository(tx).markFinished(
        live.runId,
        fx.userId,
        'failed',
        {
          attemptId: live.attemptId,
        },
      );
    }

    const switched = await deliverModelSwitch(tx, {
      delivery: {
        run: { runId: live.runId, userId: fx.userId },
        attemptId: live.attemptId,
        models: [],
        live: {
          chatId: live.chatId,
          inReplyTo: live.userMessageId,
          parts: [{ type: 'text', text: 'partial answer' }],
          telemetry: telemetry({
            attemptId: live.attemptId,
            modelId: live.modelId,
          }),
        },
        modelCompleted: {
          usage: { inputTokens: 12 },
          finishReason: 'stop',
          telemetry: telemetry({
            attemptId: live.attemptId,
            modelId: live.modelId,
          }),
        },
        deadWorkerAfterSeconds: 60,
      },
      fromModel: {
        id: live.modelId,
        name: 'Codex',
        providerModelId: 'codex-2026-01',
      },
      toModel: {
        id: SONNET,
        name: 'Claude Sonnet',
        providerModelId: 'claude-sonnet-20260101',
      },
      toEffort: extras.toEffort ?? 'low',
      failureClass: extras.failureClass ?? 'overloaded',
      origin: 'owner',
      failureTiming: {},
    });

    if (switched === undefined && extras.beforeSwitch === undefined) {
      throw new Error('Expected the live Run switch to retain its fence.');
    }

    return switched;
  }

  const messages = (chatId: string) =>
    fx.db((tx) => new MessagesRepository(tx).findByChatId(chatId, fx.userId));

  const run = (runId: string) =>
    fx.db((tx) => new RunsRepository(tx).findById(runId, fx.userId));

  const events = (runId: string) =>
    fx.db((tx) => new RunEventsRepository(tx).listByRunId(runId, fx.userId));

  const replyOf = (chat: ReadonlyArray<Message>, userMessageId: string) =>
    chat.find(
      (message) =>
        message.role === 'assistant' && message.inReplyTo === userMessageId,
    );

  const switchParts = (parts: ReadonlyArray<unknown>): Array<ContextItemPart> =>
    parts.filter(
      (part): part is ContextItemPart =>
        isContextItemPart(part) &&
        part.data.producer === 'effective-context-change',
    );

  it('A model switch names its cause', async () => {
    const live = await seedLiveSwitch();

    const switched = await fx.db((tx) => switchFrom(tx, live));

    const delivered = (await events(live.runId)).find(
      (event) => event.eventType === 'run.delivered',
    );

    expect(delivered?.payload).toMatchObject({
      messageId: switched.message.id,
      cause: 'failover',
      deliveryIds: [live.steerId],
      attemptId: switched.attemptId,
    });

    const host = (await messages(live.chatId)).find(
      (message) => message.id === switched.message.id,
    );

    // The switch item leads; the steer that waited at the boundary follows it.
    expect(switchParts(host?.parts ?? [])).toHaveLength(1);
    const [item] = switchParts(host?.parts ?? []);

    expect(item?.data.form).toBe('notice');
    expect(isModelChangePayload(item?.data.payload)).toBe(true);
    expect(item?.data.payload).toMatchObject({
      cause: 'failover',
      fromModelId: live.modelId,
      toModelId: SONNET,
      failureClass: 'overloaded',
    });
    expect(host?.parts.at(1)).toMatchObject({
      type: 'text',
      text: 'wait for me',
    });
  });
  it('recovered switch delivery compacts before its first target step', async () => {
    const live = await seedLiveSwitch();
    const switched = await fx.db((tx) => switchFrom(tx, live));
    const promptsBefore = fx.harness.models.prompts.length;

    fx.harness.models.register(SONNET, {
      kind: 'step-script',
      steps: [
        [{ type: 'text', id: 'summary', text: 'recovery summary' }],
        [{ type: 'text', id: 'answer', text: 'recovered target answer' }],
      ],
      compactionThresholdTokens: 1,
    });

    await dispatchRun({
      queue: fx.harness.queue,
      chatId: live.chatId,
      runId: live.runId,
      userId: fx.userId,
      modelId: SONNET,
      userMessage: {
        id: switched.message.id,
        seq: switched.message.seq,
        parts: switched.message.parts.filter(isRecord),
      },
    });

    const finished = await fx.terminal(live.runId);
    const transcript = await messages(live.chatId);

    expect(finished.status).toBe('completed');
    expect(
      transcript.some(
        (message) =>
          message.role === 'checkpoint' &&
          message.parts.some(
            (part) =>
              isContextItemPart(part) &&
              part.data.producer === 'compaction' &&
              isString(part.data.text) &&
              part.data.text.includes('recovery summary'),
          ),
      ),
    ).toBe(true);
    expect(fx.harness.models.prompts.slice(promptsBefore)).toHaveLength(2);
    expect(
      (await events(live.runId)).some(
        (event) => event.eventType === 'run.compaction_failed',
      ),
    ).toBe(false);
  });

  it('The transcript after a switch', async () => {
    const live = await seedLiveSwitch();

    const switched = await fx.db((tx) => switchFrom(tx, live));

    const chat = await messages(live.chatId);
    const closed = replyOf(chat, live.userMessageId);
    const host = chat.find((message) => message.id === switched.message.id);

    expect(closed?.parts).toEqual([{ type: 'text', text: 'partial answer' }]);
    expect(closed?.usage).toMatchObject({
      status: 'error',
      complete: false,
      modelId: live.modelId,
    });
    expect(closed?.usage).not.toHaveProperty('interrupted');
    expect(host?.role).toBe('user');
    expect(host?.seq).toBeGreaterThan(closed?.seq ?? 0);

    const moved = await run(live.runId);

    expect(moved).toMatchObject({
      modelId: SONNET,
      effort: 'low',
      messageId: switched.message.id,
      activeAttemptId: switched.attemptId,
      status: 'running_model',
    });
    expect(switched.attemptId).not.toBe(live.attemptId);

    const switchedEvent = (await events(live.runId)).find(
      (event) => event.eventType === 'model.switched',
    );

    expect(switchedEvent?.payload).toEqual({
      fromModelId: live.modelId,
      fromEffort: 'high',
      toModelId: SONNET,
      toEffort: 'low',
      failureClass: 'overloaded',
      messageId: switched.message.id,
      origin: 'owner',
    });

    // The boundary's steer was delivered to the host message, not left pending.
    const steer = await fx.db((tx) =>
      new ChatDeliveriesRepository(tx).findById(live.steerId, fx.userId),
    );

    expect(steer?.deliveredMessageId).toBe(switched.message.id);

    const updatedChat = await fx.db((tx) =>
      new ChatsRepository(tx).findById(live.chatId, fx.userId),
    );

    const hold = updatedChat?.modelSelection?.hold;

    expect(updatedChat?.modelSelection).toMatchObject({
      revision: 1,
      selector: live.modelId,
      effort: 'high',
    });
    expect(hold?.selector).toBe(live.modelId);
    expect(hold?.modelId).toBe(SONNET);
    expect(hold?.effort).toBe('low');
    expect(hold?.revertAt).toBeDefined();
  });

  it('does not overwrite a newer owner selection with a switch hold', async () => {
    const live = await seedLiveSwitch();

    await fx.db((tx) =>
      new ChatsRepository(tx).setModelSelection(live.chatId, fx.userId, {
        revision: 2,
        selector: '@another-role',
        effort: null,
      }),
    );

    await fx.db((tx) => switchFrom(tx, live));

    const updatedChat = await fx.db((tx) =>
      new ChatsRepository(tx).findById(live.chatId, fx.userId),
    );

    expect(updatedChat?.modelSelection).toEqual({
      revision: 2,
      selector: '@another-role',
      effort: null,
    });
  });

  it('A switch after an overload', async () => {
    const live = await seedLiveSwitch();

    const switched = await fx.db((tx) =>
      switchFrom(tx, live, { failureClass: 'overloaded' }),
    );

    const host = (await messages(live.chatId)).find(
      (message) => message.id === switched.message.id,
    );

    const [item] = switchParts(host?.parts ?? []);

    expect(item?.data.text).toContain(
      'The active model changed during this Run, because Codex',
    );
    expect(item?.data.text).toContain('failed: provider overload.');
    expect(item?.data.text).toContain('You are now Claude Sonnet');
    expect(item?.data.text).toContain(
      'Some tool calls before this point can have taken effect. Check their results before you repeat any of them.',
    );
    expect(item?.data.text).toContain(
      'Follow the current system instructions and continue the task.',
    );

    // The host message follows the closed reply in the transcript.
    const chat = await messages(live.chatId);

    const hostIndex = chat.findIndex(
      (message) => message.id === switched.message.id,
    );

    expect(chat[hostIndex - 1]?.id).toBe(replyOf(chat, live.userMessageId)?.id);
  });

  it('a later settle of the Run leaves the closed reply unchanged', async () => {
    const live = await seedLiveSwitch();

    const switched = await fx.db((tx) => switchFrom(tx, live));
    const before = replyOf(await messages(live.chatId), live.userMessageId);

    // A dead worker still holding the pre-switch attempt comes back to settle
    // the Run it thinks it owns. The Run row already names the segment the
    // switch moved onto, so the attempt fence refuses the write.
    const refused = await fx.db((tx) =>
      new RunsRepository(tx).markFinished(live.runId, fx.userId, 'failed', {
        attemptId: live.attemptId,
      }),
    );

    expect(refused).toBeUndefined();

    const current = await run(live.runId);

    expect(current).toMatchObject({
      modelId: SONNET,
      messageId: switched.message.id,
      activeAttemptId: switched.attemptId,
      status: 'running_model',
    });

    const chat = await messages(live.chatId);
    const after = replyOf(chat, live.userMessageId);

    // The closed reply keeps its own usage and parts: a failover close is
    // `error` and never complete, and the refused settle changed nothing.
    expect(after?.usage).toEqual(before?.usage);
    expect(after?.parts).toEqual(before?.parts);
    expect(after?.usage).toMatchObject({
      status: 'error',
      complete: false,
      modelId: live.modelId,
    });
    expect(after?.id).not.toBe(switched.message.id);
    // The stale attempt wrote no reply under the host message either.
    expect(replyOf(chat, switched.message.id)).toBeUndefined();
  });
  it.each(['cancel', 'fence'] as const)(
    'does not switch when the Run %s wins the fence',
    async (beforeSwitch) => {
      const live = await seedLiveSwitch();

      const switched = await fx.db((tx) =>
        switchFrom(tx, live, { beforeSwitch }),
      );

      expect(switched).toBeUndefined();
    },
  );
});
