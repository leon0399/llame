/**
 * run-steering, `segment-prep` layer — the per-segment preparation of an
 * attempt, against real Postgres (RLS active) and the co-located worker with
 * the scripted model client. Pending steer items are stored directly in
 * `chat_deliveries`, as in the `segments` suite: no HTTP admits a `steer` yet.
 *
 * Requires TEST_DATABASE_URL (throws without it); run by test:integration.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { eq } from 'drizzle-orm';

import { AcceptedTurnPartsRepository } from '../chats/accepted-turn-parts.repository';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { type MessagePart } from '../chats/context-builder';
import { isContextItemPart } from '../chats/context-item';
import { createTemporalItem } from '../chats/context-item-producers';
import { createRunForMessage } from '../chats/run-creation';
import { runs, type Message } from '../db/schema';
import { waitFor } from '../testing/support';
import { type RunUserMessage } from './run-execution.service';
import { isTerminalRunStatus } from './run-status';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import {
  currentSegmentState,
  findEarlierSegmentBaseline,
} from './run-segment-queries';
import { type ScriptedStep } from './scripted-model-step';
import { deliverPendingSteering } from './segment-delivery';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedRun,
  type WorkerHarness,
} from './worker-harness';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (!TEST_DB_URL) {
  throw new Error(
    'run-segment-prep.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}

vi.setConfig({ testTimeout: 90_000 });

/** The Chat, Run, and trigger a test seeded before it dispatches. */
type SeededRun = {
  chatId: string;
  runId: string;
  userMessage: RunUserMessage;
};

const TITLE_MODEL_ID = 'system:openai:gpt-5.4-nano';

const answer = (text: string): ScriptedStep => [
  { type: 'text', id: 't', text },
];

const call = (
  toolCallId: string,
  toolName: string,
  input: UnknownRecord,
): ScriptedStep => [{ type: 'tool-call', toolCallId, toolName, input }];

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

/** The producer of each context item of a stored message, in order. */
const producers = (message: Message | undefined): Array<string> =>
  (message?.parts ?? []).flatMap((part) =>
    isContextItemPart(part) ? [part.data.producer] : [],
  );

describe('run steering segment preparation', () => {
  let harness: WorkerHarness;
  let userId: string;
  let directory: string;
  let skills: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'run-segment-prep-'));
    skills = join(directory, 'skills');
    await mkdir(join(skills, 'pdf'), { recursive: true });
    await writeFile(
      join(skills, 'pdf', 'SKILL.md'),
      [
        '---',
        'name: pdf',
        'description: Extract text from PDF files. Use when handling PDFs.',
        '---',
        '# PDF extraction',
        '',
        'PDF_SEGMENT_INSTRUCTIONS',
        '',
      ].join('\n'),
    );
    await writeFile(join(directory, 'notes.txt'), 'IMPORTED_SEGMENT_TOKEN\n');
    harness = await bootWorkerHarness({
      allowedTools: ['read', 'bash'],
      nativeExecutorId: 'run-segment-prep-host',
      skillDirectories: [skills],
    });
    harness.models.register(TITLE_MODEL_ID, {
      kind: 'complete',
      text: 'A steered title',
    });
    userId = await createUser(harness.db, 'run-segment-prep');
  });

  afterAll(async () => {
    if (harness) await harness.close();
    await rm(directory, { recursive: true, force: true });
  });

  const db = <T>(work: Parameters<typeof harness.tenantDb.runAs<T>>[1]) =>
    harness.tenantDb.runAs(userId, work);

  async function storeSteer(
    chatId: string,
    text: string,
    modelId = 'ignored-by-steer',
    mode: 'steer' | 'interrupt' = 'steer',
  ): Promise<void> {
    await db((tx) =>
      new ChatDeliveriesRepository(tx).insertPending({
        id: randomUUID(),
        chatId,
        ownerUserId: userId,
        mode,
        parts: [{ type: 'text', text }],
        settings: { modelId, permissionMode: 'default' },
      }),
    );
  }

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

  const chatMessages = (chatId: string) =>
    db((tx) => new MessagesRepository(tx).findByChatId(chatId, userId));

  /** The stored message with `text` among its text parts. */
  const messageWith = (messages: ReadonlyArray<Message>, text: string) =>
    messages.find((message) =>
      message.parts.some(
        (part) =>
          isRecord(part) && part['type'] === 'text' && part['text'] === text,
      ),
    );

  const replyTo = (
    messages: ReadonlyArray<Message>,
    userMessage: Message | undefined,
  ) => messages.find((message) => message.inReplyTo === userMessage?.id);

  /**
   * Registers a model script and runs it. `steerAtStep` stores `steer` before
   * the model answers that step, so the step end delivers it.
   */
  async function steeredRun(input: {
    steps: ReadonlyArray<ScriptedStep>;
    steer: string;
    behavior?: {
      referencesSkills?: boolean;
      compactionThresholdTokens?: number;
    };
    steerModelId?: string;
    firstText?: string;
    beforeStep?: (index: number, chatId: string) => Promise<void>;
    seed?: SeededRun;
  }) {
    const modelId = `segment-prep-${randomUUID()}`;

    const seeded =
      input.seed ??
      (await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId,
        text: input.firstText ?? 'first message',
      }));

    const runRow = await run(seeded.runId);
    const runModelId = runRow?.modelId ?? modelId;
    harness.models.register(runModelId, {
      kind: 'step-script',
      steps: input.steps,
      ...input.behavior,
      beforeStep: async (index) => {
        if (index === 0) {
          await storeSteer(seeded.chatId, input.steer, input.steerModelId);
        }

        await input.beforeStep?.(index, seeded.chatId);
      },
    });
    const promptsBefore = harness.models.prompts.length;
    await dispatchRun({
      queue: harness.queue,
      ...seeded,
      userId,
      modelId: runModelId,
    });
    const finished = await terminal(seeded.runId);

    return {
      ...seeded,
      modelId: runModelId,
      finished,
      rawPrompts: harness.models.prompts.slice(promptsBefore),
      prompts: harness.models.prompts
        .slice(promptsBefore)
        .map((prompt) => flatten(prompt)),
    };
  }

  describe('the first dispatch of a segment', () => {
    it('A steer with a skill mention', async () => {
      const started = await steeredRun({
        steps: [call('a', 'read', { path: directory }), answer('done')],
        steer: 'please use $pdf here',
      });

      expect(started.finished.status).toBe('completed');
      const messages = await chatMessages(started.chatId);
      const delivered = messageWith(messages, 'please use $pdf here');
      expect(producers(delivered)).toContain('skill-activation');
      const firstItem = delivered?.parts.findIndex(isContextItemPart) ?? -1;

      const textAt =
        delivered?.parts.findIndex(
          (part) => isRecord(part) && part['type'] === 'text',
        ) ?? -1;

      expect(firstItem).toBeGreaterThan(-1);
      expect(firstItem).toBeLessThan(textAt);
    });

    it('A delivered steer activates its skill', async () => {
      const started = await steeredRun({
        steps: [call('a', 'read', { path: directory }), answer('done')],
        steer: 'use $pdf now',
      });

      // The instructions load before the first request of the new segment, and
      // not before the first segment's requests: the first message names none.
      const [first, second] = started.prompts;
      expect(
        first?.some((line) => line.includes('PDF_SEGMENT_INSTRUCTIONS')),
      ).toBe(false);
      expect(
        second?.some((line) => line.includes('PDF_SEGMENT_INSTRUCTIONS')),
      ).toBe(true);
    });

    it('A delivered steer imports a file', async () => {
      const file = join(directory, 'notes.txt');

      const started = await steeredRun({
        steps: [call('a', 'read', { path: directory }), answer('done')],
        steer: `summarize @${file}`,
      });

      const messages = await chatMessages(started.chatId);
      const delivered = messageWith(messages, `summarize @${file}`);
      const items = producers(delivered);
      expect(items).toContain('prompt-imports');

      const importAt =
        delivered?.parts.findIndex(
          (part) =>
            isContextItemPart(part) && part.data.producer === 'prompt-imports',
        ) ?? -1;

      const textAt =
        delivered?.parts.findIndex(
          (part) => isRecord(part) && part['type'] === 'text',
        ) ?? -1;

      expect(importAt).toBeLessThan(textAt);
      expect(
        started.prompts[1]?.some((line) =>
          line.includes('IMPORTED_SEGMENT_TOKEN'),
        ),
      ).toBe(true);
    });

    it('A delivered message is prepared as a first dispatch', async () => {
      const started = await steeredRun({
        steps: [call('a', 'read', { path: directory }), answer('done')],
        steer: 'change course',
      });

      const messages = await chatMessages(started.chatId);
      const first = messages.find(({ role }) => role === 'user');
      const delivered = messageWith(messages, 'change course');
      // Each message holds the one temporal item its own segment authored.
      expect(producers(first).filter((p) => p === 'temporal')).toHaveLength(1);
      expect(producers(delivered).filter((p) => p === 'temporal')).toHaveLength(
        1,
      );
    });

    it('A retry inside a later segment appends instead of preparing a first dispatch', async () => {
      const modelId = `segment-prep-${randomUUID()}`;
      const crashed = await runAfterFirstSegment(modelId, 'second steer');
      // The earlier attempt of the second segment dispatched: its temporal
      // item sits on the delivered message and its request is in the log.
      await db(async (tx) => {
        await tx
          .update(runs)
          .set({ turnToolAvailability: [] })
          .where(eq(runs.id, crashed.runId));
        await new RunEventsRepository(tx).append(
          crashed.runId,
          'model.requested',
          { modelId, attemptId: crashed.delivery.attemptId },
        );
        await new AcceptedTurnPartsRepository(tx).storeAtDispatch({
          id: crashed.delivery.message.id,
          chatId: crashed.chatId,
          items: [
            createTemporalItem({
              runId: crashed.runId,
              instant: new Date(),
              timeZone: 'UTC',
            }),
          ].filter(isContextItemPart),
          placement: 'rank',
          removeModelSwitch: false,
        });
      });
      harness.models.register(modelId, {
        kind: 'step-script',
        steps: [answer('retried')],
      });
      await dispatchRun({
        queue: harness.queue,
        ...crashed,
        userId,
        modelId,
      });
      await terminal(crashed.runId);

      const delivered = (await chatMessages(crashed.chatId)).find(
        ({ id }) => id === crashed.delivery.message.id,
      );

      expect(producers(delivered).filter((p) => p === 'temporal')).toHaveLength(
        1,
      );
    });

    it('A steer sent with another model', async () => {
      const started = await steeredRun({
        steps: [call('a', 'read', { path: directory }), answer('done')],
        steer: 'switch models please',
        steerModelId: 'composer-model-b',
      });

      expect(started.finished.status).toBe('completed');
      const messages = await chatMessages(started.chatId);
      const delivered = messageWith(messages, 'switch models please');
      // The Run kept its model: the delivered message gets no model-switch item
      // for the composer's model, and its reply names the Run's model.
      expect(
        delivered?.parts.map((part) => JSON.stringify(part)).join(),
      ).not.toContain('composer-model-b');
      expect(producers(delivered)).not.toContain('effective-context-change');
      const reply = replyTo(messages, delivered);
      expect(isRecord(reply?.usage) && reply.usage['modelId']).toBe(
        started.modelId,
      );
    });

    it('A segment start does not compact', async () => {
      const started = await steeredRun({
        steps: [call('a', 'read', { path: directory }), answer('done')],
        steer: 'one more thing',
        behavior: { compactionThresholdTokens: 1 },
      });

      expect(started.finished.status).toBe('completed');
      // The threshold is exceeded by any history, yet the second segment sends
      // its first request with no summary request before it.
      expect(started.prompts).toHaveLength(2);
      const messages = await chatMessages(started.chatId);
      expect(messages.map(({ role }) => role)).not.toContain('checkpoint');
    });

    it('A later segment keeps the reasoning of an earlier segment', async () => {
      const providerMetadata = {
        openai: { itemId: 'rs_segment_1', reasoningEncryptedContent: 'ENC_1' },
      };

      const started = await steeredRun({
        steps: [
          [
            {
              type: 'reasoning',
              id: 'r',
              text: 'SEGMENT_ONE_THOUGHT',
              providerMetadata,
            },
            {
              type: 'tool-call',
              toolCallId: 'a',
              toolName: 'read',
              input: { path: directory },
            },
          ],
          answer('done'),
        ],
        steer: 'second segment',
      });

      expect(started.finished.status).toBe('completed');
      // The second segment's first request is the second one of the Run.
      const [, second] = started.rawPrompts;

      const replayed = (second ?? []).flatMap((message): Array<unknown> =>
        isString(message.content) ? [] : [...message.content],
      );

      expect(replayed).toContainEqual(
        expect.objectContaining({
          type: 'reasoning',
          text: 'SEGMENT_ONE_THOUGHT',
          providerOptions: providerMetadata,
        }),
      );
    });
  });

  /**
   * A Run that delivered once and whose worker then died in the second
   * segment: its first reply is stored, the item is delivered, and the Run row
   * names the delivered message.
   */
  async function runAfterFirstSegment(
    modelId: string,
    steerText: string,
    beforeDelivery?: (seeded: { runId: string }) => Promise<void>,
  ) {
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
        usage: { status: 'completed', complete: true, runId: seeded.runId },
      }),
    );

    const started = await db((tx) =>
      new RunsRepository(tx).markStarted(seeded.runId, userId),
    );

    await db((tx) =>
      new RunEventsRepository(tx).append(seeded.runId, 'run.started'),
    );
    await beforeDelivery?.(seeded);
    await storeSteer(seeded.chatId, steerText);

    const delivery = await db((tx) =>
      deliverPendingSteering(tx, {
        run: { runId: seeded.runId, userId },
        attemptId: started?.activeAttemptId ?? '',
        deadWorkerAfterSeconds: 1_000_000,
        models: [],
      }),
    );

    if (delivery.kind !== 'delivered') throw new Error('not delivered');

    return { ...seeded, delivery };
  }

  describe('follow-up state in the first segment only', () => {
    const keptParts: Array<MessagePart> = [
      { type: 'text', text: 'kept text before the failure', step: 0 },
      {
        type: 'tool-read',
        toolCallId: 'kept-call',
        state: 'output-available',
        input: { path: '/tmp/kept.txt' },
        output: { status: 'success', path: '/tmp/kept.txt', text: 'kept' },
        outcome: 'success',
        step: 0,
      },
    ];

    /** A failed Run with a reply, and the follow-up Run admission would create. */
    async function seedFollowUp(
      modelId: string,
      followUp: 'continue' | 'regenerate',
    ) {
      const chatId = randomUUID();

      return db(async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: chatId,
          ownerUserId: userId,
          title: 'Follow-up chat',
        });
        const messagesRepo = new MessagesRepository(tx);

        const trigger = await messagesRepo.create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'first message' }],
        });

        const source = await new RunsRepository(tx).create({
          chatId,
          messageId: trigger.id,
          userId,
          modelId,
        });

        await new RunsRepository(tx).markFinished(source.id, userId, 'failed', {
          error: { message: 'the stream dropped' },
        });
        await messagesRepo.createAssistantReplyIfAbsent({
          chatId,
          inReplyTo: trigger.id,
          parts:
            followUp === 'continue'
              ? keptParts
              : [{ type: 'text', text: 'old reply' }],
          usage: {
            status: 'error',
            complete: false,
            runId: source.id,
            modelId,
            attemptId: randomUUID(),
          },
        });

        const { run: created } = await createRunForMessage(
          tx,
          {
            userId,
            chatId,
            modelId,
            effort: undefined,
            permissionMode: 'default',
            targetRunId: randomUUID(),
            followUp:
              followUp === 'continue'
                ? {
                    action: 'continue',
                    sourceRunId: source.id,
                    keptParts,
                    replacesUsage: true,
                  }
                : {
                    action: 'regenerate',
                    sourceRunId: source.id,
                    replacesUsage: true,
                    notice: true,
                  },
          },
          trigger,
        );

        return {
          chatId,
          runId: created.id,
          userMessage: {
            id: trigger.id,
            seq: trigger.seq,
            parts: [{ type: 'text', text: 'first message' }],
          },
        };
      });
    }

    it('A steer inside a Continue Run', async () => {
      const modelId = `segment-prep-${randomUUID()}`;
      const seed = await seedFollowUp(modelId, 'continue');

      const started = await steeredRun({
        seed,
        steps: [
          call('own', 'read', { path: directory }),
          answer('segment two'),
        ],
        steer: 'and then this',
      });

      expect(started.finished.status).toBe('completed');
      const messages = await chatMessages(started.chatId);
      const [, delivered] = messages.filter(({ role }) => role === 'user');
      const second = replyTo(messages, delivered);
      expect(JSON.stringify(second?.parts)).not.toContain(
        'kept text before the failure',
      );
      // The second segment's request carries the kept parts once, in the
      // reply of the first segment.
      const sent = started.prompts[1] ?? [];
      expect(
        sent.filter(
          (line) => line === 'assistant:kept text before the failure',
        ),
      ).toHaveLength(1);
    });

    it('A delivered message does not repeat the kept parts', async () => {
      const modelId = `segment-prep-${randomUUID()}`;
      const seed = await seedFollowUp(modelId, 'continue');

      const started = await steeredRun({
        seed,
        steps: [
          call('own', 'read', { path: directory }),
          answer('only segment two'),
        ],
        steer: 'continue differently',
      });

      const messages = await chatMessages(started.chatId);
      const users = messages.filter(({ role }) => role === 'user');
      const first = replyTo(messages, users[0]);
      const second = replyTo(messages, users[1]);
      expect(
        (first?.parts ?? []).filter(
          (part) =>
            isRecord(part) && part['text'] === 'kept text before the failure',
        ),
      ).toHaveLength(1);
      expect(
        (second?.parts ?? []).map((part) =>
          isRecord(part) ? part['text'] : '',
        ),
      ).toEqual(['only segment two']);
    });

    it('A steer inside a Regenerate Run leaves the second segment without the notice or a replaced reply', async () => {
      const modelId = `segment-prep-${randomUUID()}`;
      const seed = await seedFollowUp(modelId, 'regenerate');

      const started = await steeredRun({
        seed,
        steps: [
          call('own', 'read', { path: directory }),
          answer('second answer'),
        ],
        steer: 'but shorter',
      });

      expect(started.finished.status).toBe('completed');
      const messages = await chatMessages(started.chatId);
      const users = messages.filter(({ role }) => role === 'user');
      expect(
        producers(users[0]).filter((p) => p === 'regenerate'),
      ).toHaveLength(1);
      expect(producers(users[1])).not.toContain('regenerate');
      const first = replyTo(messages, users[0]);
      const second = replyTo(messages, users[1]);
      expect(first).toMatchObject({ usage: { status: 'completed' } });
      expect(second).toMatchObject({ usage: { status: 'completed' } });
      // Only the first segment replaces the discarded reply's usage.
      expect(first?.usage).toMatchObject({ complete: false });
      expect(second?.usage).toMatchObject({ complete: true });
    });
  });

  describe('completeness, baselines, and the title', () => {
    const usageOf = (message: Message | undefined) =>
      isRecord(message?.usage) ? message.usage : {};

    it('A reply that a steer closed is complete', async () => {
      const started = await steeredRun({
        steps: [call('a', 'read', { path: directory }), answer('done')],
        steer: 'next',
      });

      const messages = await chatMessages(started.chatId);
      const users = messages.filter(({ role }) => role === 'user');
      // The segment attempts differ, yet neither reply marks the other incomplete.
      expect(usageOf(replyTo(messages, users[0]))).toMatchObject({
        status: 'completed',
        complete: true,
      });
      expect(usageOf(replyTo(messages, users[1]))).toMatchObject({
        status: 'completed',
        complete: true,
      });
    });

    it('Every request reported', async () => {
      const started = await steeredRun({
        steps: [
          call('a', 'read', { path: directory }),
          call('b', 'read', { path: directory }),
          answer('done'),
        ],
        steer: 'between steps',
      });

      const messages = await chatMessages(started.chatId);
      const replies = messages.filter(({ role }) => role === 'assistant');
      expect(replies).toHaveLength(2);

      for (const reply of replies) {
        expect(usageOf(reply)).toMatchObject({ complete: true });
      }
    });

    async function writeReceipt(runId: string, attemptId: string) {
      await db((tx) =>
        new SystemPromptReceiptsRepository(tx).create({
          ownerUserId: userId,
          runId,
          attemptId,
          source: 'project_default',
          systemPrompt: 'a reclaimed attempt',
          promptHash: randomUUID(),
        }),
      );
    }

    it('A reclaimed Run is incomplete', async () => {
      const modelId = `segment-prep-${randomUUID()}`;

      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId,
        text: 'first message',
      });

      const claimed = await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, userId),
      );

      // An earlier attempt of the same segment reached prompt preparation.
      await writeReceipt(seeded.runId, claimed?.activeAttemptId ?? '');
      harness.models.register(modelId, {
        kind: 'step-script',
        steps: [answer('after the reclaim')],
      });
      await dispatchRun({ queue: harness.queue, ...seeded, userId, modelId });
      await terminal(seeded.runId);

      const messages = await chatMessages(seeded.chatId);
      expect(usageOf(replyTo(messages, messages[0]))).toMatchObject({
        status: 'completed',
        complete: false,
      });
    });

    it('A reclaimed Run is incomplete, only within the segment it was reclaimed in', async () => {
      // An attempt of the FIRST segment left a receipt before the delivery:
      // the final reply of the second segment does not count it.
      const modelId = `segment-prep-${randomUUID()}`;

      const earlier = await runAfterFirstSegment(
        modelId,
        'a steer',
        async ({ runId }) => writeReceipt(runId, randomUUID()),
      );

      harness.models.register(modelId, {
        kind: 'step-script',
        steps: [answer('second reply')],
      });
      await dispatchRun({
        queue: harness.queue,
        ...earlier,
        userId,
        modelId,
      });
      await terminal(earlier.runId);
      const clean = await chatMessages(earlier.chatId);
      expect(
        usageOf(
          replyTo(
            clean,
            clean.find(({ id }) => id === earlier.delivery.message.id),
          ),
        ),
      ).toMatchObject({ complete: true });

      // An attempt of the SECOND segment that was reclaimed does.
      const modelId2 = `segment-prep-${randomUUID()}`;
      const later = await runAfterFirstSegment(modelId2, 'a steer');
      // It claimed the Run after the delivery, then reached preparation.
      const staleAttempt = randomUUID();
      await db((tx) =>
        new RunEventsRepository(tx).append(later.runId, 'run.started', {
          attemptId: staleAttempt,
        }),
      );
      await writeReceipt(later.runId, staleAttempt);
      harness.models.register(modelId2, {
        kind: 'step-script',
        steps: [answer('second reply')],
      });
      await dispatchRun({
        queue: harness.queue,
        ...later,
        userId,
        modelId: modelId2,
      });
      await terminal(later.runId);
      const reclaimed = await chatMessages(later.chatId);
      expect(
        usageOf(
          replyTo(
            reclaimed,
            reclaimed.find(({ id }) => id === later.delivery.message.id),
          ),
        ),
      ).toMatchObject({ complete: false });
    });

    it('A reclaim inside the first segment leaves the closed reply incomplete', async () => {
      const modelId = `segment-prep-${randomUUID()}`;

      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId,
        text: 'first message',
      });

      const started = await steeredRun({
        seed: seeded,
        steps: [call('a', 'read', { path: directory }), answer('done')],
        steer: 'after the reclaim',
        // An earlier attempt of the first segment left a receipt behind.
        beforeStep: async (index) => {
          if (index === 0) await writeReceipt(seeded.runId, randomUUID());
        },
      });

      const messages = await chatMessages(started.chatId);
      const users = messages.filter(({ role }) => role === 'user');
      // The delivery closed the first reply, which the stale attempt taints;
      // the second segment does not count it.
      expect(usageOf(replyTo(messages, users[0]))).toMatchObject({
        status: 'completed',
        complete: false,
      });
      expect(usageOf(replyTo(messages, users[1]))).toMatchObject({
        complete: true,
      });
    });

    it('A steer delivery writes the first-epoch baselines of the first Run', async () => {
      const seen: Array<boolean> = [];

      const started = await steeredRun({
        steps: [call('a', 'read', { path: directory }), answer('done')],
        steer: 'second segment',
        behavior: { referencesSkills: true },
        beforeStep: async (index, chatId) => {
          const chat = await db((tx) =>
            new ChatsRepository(tx).findById(chatId, userId),
          );

          // The baseline is on the Chat before the second segment's request.
          seen[index] = chat?.skillCatalogBaseline !== null;
        },
      });

      expect(started.finished.status).toBe('completed');
      expect(seen[0]).toBe(false);
      expect(seen[1]).toBe(true);
    });

    it('An interrupt delivery writes no first-epoch baselines', async () => {
      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId: 'unused',
      });

      const started = await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, userId),
      );

      const baselines = {
        recencyDigestInitialization: {
          baseline: {
            pinned: [],
            recent: [],
            pinnedShown: 0,
            pinnedTotal: 0,
            recentShown: 0,
            recentTotal: 0,
            compiledOn: '2026-11-08',
          },
          told: [],
        },
        skillCatalogFreeze: {
          baseline: { entries: [], omitted: 0 },
          rebakedFrom: null,
          told: [],
        },
      };

      const deliver = (attemptId: string | null | undefined) =>
        db((tx) =>
          deliverPendingSteering(tx, {
            run: { runId: seeded.runId, userId },
            attemptId: attemptId ?? '',
            deadWorkerAfterSeconds: 1_000_000,
            models: [],
            baselines,
          }),
        );

      const chat = () =>
        db((tx) => new ChatsRepository(tx).findById(seeded.chatId, userId));

      await storeSteer(seeded.chatId, 'stop that', undefined, 'interrupt');
      const interrupted = await deliver(started?.activeAttemptId);
      expect(interrupted.kind).toBe('delivered');
      expect((await chat())?.skillCatalogBaseline).toBeNull();
      expect((await chat())?.recencyDigestBaseline).toBeNull();

      // A steer delivery of the same Run establishes them.
      await storeSteer(seeded.chatId, 'carry on');

      const steered = await deliver(
        interrupted.kind === 'delivered' ? interrupted.attemptId : undefined,
      );

      expect(steered.kind).toBe('delivered');
      expect((await chat())?.skillCatalogBaseline).not.toBeNull();
      expect((await chat())?.recencyDigestBaseline).not.toBeNull();
    });

    it('interrupt closes segment 1, steer closes segment 2: baselines written at the second close', async () => {
      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId: 'unused',
      });

      const started = await db((tx) =>
        new RunsRepository(tx).markStarted(seeded.runId, userId),
      );

      const baselines = (compiledOn: string) => ({
        recencyDigestInitialization: {
          baseline: {
            pinned: [],
            recent: [],
            pinnedShown: 0,
            pinnedTotal: 0,
            recentShown: 0,
            recentTotal: 0,
            compiledOn,
          },
          told: [],
        },
        skillCatalogFreeze: {
          baseline: { entries: [], omitted: 0 },
          rebakedFrom: null,
          told: [],
        },
      });

      const deliver = (attemptId: string, compiledOn: string) =>
        db((tx) =>
          deliverPendingSteering(tx, {
            run: { runId: seeded.runId, userId },
            attemptId,
            deadWorkerAfterSeconds: 1_000_000,
            models: [],
            baselines: baselines(compiledOn),
          }),
        );

      const chat = () =>
        db((tx) => new ChatsRepository(tx).findById(seeded.chatId, userId));

      // Segment 1 closes on an interrupt: nothing is written.
      await storeSteer(seeded.chatId, 'stop that', undefined, 'interrupt');
      const first = await deliver(started?.activeAttemptId ?? '', '2026-11-01');

      if (first.kind !== 'delivered') throw new Error('no delivery');
      expect((await chat())?.recencyDigestBaseline).toBeNull();

      // Segment 2 closes on a steer: the baselines are written now.
      await storeSteer(seeded.chatId, 'carry on');
      const second = await deliver(first.attemptId, '2026-11-02');

      if (second.kind !== 'delivered') throw new Error('no delivery');
      const written = await chat();
      expect(written?.skillCatalogBaseline).not.toBeNull();
      expect(written?.recencyDigestBaseline).toMatchObject({
        compiledOn: '2026-11-02',
      });

      // A later steer close leaves the established baselines alone.
      await storeSteer(seeded.chatId, 'and again');
      await deliver(second.attemptId, '2026-11-03');
      expect((await chat())?.recencyDigestBaseline).toMatchObject({
        compiledOn: '2026-11-02',
      });
    });

    it('A steer in the first Run', async () => {
      const chatId = randomUUID();
      const modelId = `segment-prep-${randomUUID()}`;

      const seeded = await db(async (tx) => {
        // No title: the completed Run generates one.
        await new ChatsRepository(tx).createIfAbsent({
          id: chatId,
          ownerUserId: userId,
        });

        const message = await new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'FIRST_TITLE_SOURCE message' }],
        });

        const created = await new RunsRepository(tx).create({
          chatId,
          messageId: message.id,
          userId,
          modelId,
        });

        return {
          chatId,
          runId: created.id,
          userMessage: {
            id: message.id,
            seq: message.seq,
            parts: [{ type: 'text', text: 'FIRST_TITLE_SOURCE message' }],
          },
        };
      });

      await steeredRun({
        seed: seeded,
        steps: [call('a', 'read', { path: directory }), answer('done')],
        steer: 'LATER_STEER_TEXT',
      });
      await waitFor(
        async () => {
          const chat = await db((tx) =>
            new ChatsRepository(tx).findById(chatId, userId),
          );

          return chat?.title ?? undefined;
        },
        20_000,
        'the title',
      );

      const titlePrompt = flatten(harness.models.prompts.at(-1) ?? []).join(
        '\n',
      );

      expect(titlePrompt).toContain('FIRST_TITLE_SOURCE');
      expect(titlePrompt).not.toContain('LATER_STEER_TEXT');
    });
  });

  describe('the baseline queries of a Run that delivered', () => {
    it('currentSegmentState names a request after the latest delivery', async () => {
      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId: 'unused',
      });

      const state = () =>
        db((tx) => currentSegmentState(tx, seeded.runId, userId));

      const append = (type: 'model.requested' | 'run.delivered') =>
        db((tx) => new RunEventsRepository(tx).append(seeded.runId, type, {}));

      expect(await state()).toEqual({ delivered: false, dispatched: false });
      await append('model.requested');
      expect(await state()).toEqual({ delivered: false, dispatched: true });
      await append('run.delivered');
      expect(await state()).toEqual({ delivered: true, dispatched: false });
      await append('model.requested');
      expect(await state()).toEqual({ delivered: true, dispatched: true });
    });

    it('findEarlierSegmentBaseline reaches the Run through the reply it produced', async () => {
      const modelId = 'baseline-model';

      const seeded = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId,
        text: 'first',
      });

      const delivered = await db(async (tx) => {
        const messagesRepo = new MessagesRepository(tx);
        await messagesRepo.createAssistantReplyIfAbsent({
          chatId: seeded.chatId,
          inReplyTo: seeded.userMessage.id,
          parts: [{ type: 'text', text: 'reply' }],
          usage: { status: 'completed', complete: true, runId: seeded.runId },
        });

        const second = await messagesRepo.create({
          chatId: seeded.chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'delivered' }],
        });

        // The dispatch of the first segment wrote its record, then a delivery
        // moved the Run onto the second message.
        await tx
          .update(runs)
          .set({ turnToolAvailability: [], messageId: second.id })
          .where(eq(runs.id, seeded.runId));

        return second;
      });

      const baselines = await db(async (tx) => ({
        bySequence: await new RunsRepository(
          tx,
        ).findMostRecentDispatchedByChatMessageSequence(seeded.chatId, userId, {
          beforeSeq: delivered.seq,
        }),
        ownSegment: await findEarlierSegmentBaseline(tx, {
          chatId: seeded.chatId,
          userId,
          runId: seeded.runId,
          beforeSeq: delivered.seq,
        }),
        otherRun: await findEarlierSegmentBaseline(tx, {
          chatId: seeded.chatId,
          userId,
          runId: randomUUID(),
          beforeSeq: delivered.seq,
        }),
      }));

      // The message join cannot see the Run any more, the reply join can.
      expect(baselines.bySequence).toBeUndefined();
      expect(baselines.ownSegment?.run.id).toBe(seeded.runId);
      expect(baselines.ownSegment?.triggeringUserSeq).toBe(
        seeded.userMessage.seq,
      );
      expect(baselines.otherRun).toBeUndefined();
    });
  });
});
