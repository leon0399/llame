/**
 * Continue on next candidate from a quota wait (model-roles D7 task 6.2, the
 * `model-roles` scenarios "A weekly limit ends early", "Another owner calls the
 * action", "An exact selector in a quota wait", "A compaction Run in a quota
 * wait", and `quota-wait` "Continue on next candidate wakes the Run") against
 * real Postgres and a live worker.
 *
 * The action runs the API transaction against a real `ModelsService` over a
 * role-holding config; the worker that claims the re-enqueued job runs on the
 * harness's scripted model client, so "its next request goes to sonnet" is read
 * from what the model was actually sent.
 *
 * Requires TEST_DATABASE_URL; run by `test:integration`.
 */

import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';

import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { isContextItemPart, type ContextItemPart } from '../chats/context-item';
import { isModelChangePayload } from '../chats/context-item-producers';
import { RunningReplyRepository } from '../chats/running-reply-repository';
import { type AwaitingQuota, type Message } from '../db/schema';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import {
  ModelsService,
  NextCandidateUnavailableError,
} from '../models/models.service';
import {
  answer,
  flatten,
  useSegmentsFixture,
  type SeededRun,
} from '../testing/run-segments.test-fixture';
import { NextCandidateService } from './next-candidate.service';
import { RUNS_QUEUE } from './run-queues';
import { runningReplyUsage } from './run-reply-finalizer';
import { RunWaitService } from './run-wait.service';
import { RunsController } from './runs.controller';
import { RunsRepository } from './runs-repository';
import { createUser } from './worker-harness';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'next-candidate-quota.integration.test.ts requires the integration database',
  );
}

/** The role's primary candidate. */
const CODEX: SystemModelCatalogEntry = {
  id: 'system:openai:codex',
  source: 'system',
  contextWindowTokens: 128_000,
  input: ['text'],
  provider: 'openai',
  providerModelId: 'codex-2026-01',
  systemPromptTemplate: 'Model selection prompt',
  systemPromptSource: 'project_default',
  referencesSkills: false,
  reasoning: {
    effortLevels: [{ value: 'high' }, { value: 'low' }],
    defaultEffort: 'high',
    cacheInvalidatedByEffortChange: false,
  },
};

/** The next candidate, which declares the role's other effort. */
const SONNET: SystemModelCatalogEntry = {
  id: 'system:anthropic:claude-sonnet',
  source: 'system',
  contextWindowTokens: 128_000,
  input: ['text'],
  provider: 'openai',
  providerModelId: 'claude-sonnet',
  name: 'Claude Sonnet',
  systemPromptTemplate: 'Model selection prompt',
  systemPromptSource: 'project_default',
  referencesSkills: false,
  reasoning: {
    effortLevels: [{ value: 'medium' }, { value: 'low' }],
    defaultEffort: 'low',
    cacheInvalidatedByEffortChange: false,
  },
};

const CONFIG: LlameConfig = {
  ...BUILT_IN_DEFAULTS,
  defaults: { selector: '@coding', titleGenerationSelector: null },
  providers: [
    {
      id: 'openai',
      type: 'openai-completions',
      key: null,
      baseUrl: 'https://next-candidate.example.test/v1',
      headers: {},
    },
  ],
  models: [CODEX, SONNET],
  modelRoles: [
    {
      name: 'coding',
      candidates: [
        { modelId: CODEX.id, effort: 'high' },
        { modelId: SONNET.id, effort: 'low' },
      ],
    },
  ],
};

type ParkedRun = SeededRun & { attemptId: string };

describe('Continue on next candidate from a quota wait', () => {
  const fx = useSegmentsFixture('next-candidate-quota', {
    allowedTools: [],
    runsConcurrency: 1,
    quotaWaitMaxSeconds: 7 * 24 * 60 * 60,
    queueSchema: `next_candidate_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
  });

  /** The API surface, over a real catalog and the harness's queue. */
  function endpoint(): RunsController {
    const reader = { config: CONFIG, productUserAgent: 'llame/nc-test' };
    const models = new ModelsService(reader);

    return new RunsController(
      fx.harness.tenantDb,
      fx.harness.moduleRef.get(RunWaitService, { strict: false }),
      new NextCandidateService(
        fx.harness.tenantDb,
        models,
        reader,
        fx.harness.dispatch,
      ),
    );
  }

  const awaited = (): AwaitingQuota => ({
    kind: 'quota',
    failureClass: 'quota_exhausted',
    resetsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    wakeAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
    resumeAt: 'request',
    waitCount: 1,
  });

  /**
   * A Run of `@coding` on `codex` parked in `awaiting_quota`: it dispatched on
   * an attempt, its reply holds one part, and a steer waits at the boundary.
   */
  async function parkedRun(selector = '@coding'): Promise<ParkedRun> {
    const seeded = await fx.seed('park this turn');

    const attemptId = await fx.db(async (tx) => {
      const started = await new RunsRepository(tx).markStarted(
        seeded.runId,
        fx.userId,
      );

      const attempt = started?.activeAttemptId;

      if (!attempt) throw new Error('The parked Run claimed no attempt.');

      await new RunsRepository(tx).updateForAttempt(
        seeded.runId,
        fx.userId,
        attempt,
        {
          modelId: CODEX.id,
          selector,
          effort: 'high',
          selectedEffort: 'high',
        },
      );

      const reply = await new RunningReplyRepository(tx).upsertRunningReply({
        chatId: seeded.chatId,
        inReplyTo: seeded.userMessage.id,
        usage: runningReplyUsage({
          runId: seeded.runId,
          attemptId: attempt,
          modelId: CODEX.id,
          effort: 'high',
          permissionMode: 'default',
        }),
        followUpAction: null,
      });

      if (!reply) throw new Error('The parked Run has no reply row.');

      return attempt;
    });

    await fx.storeItems(seeded.chatId, ['steer while parked']);

    await fx.harness.moduleRef.get(RunWaitService).suspendForQuota({
      runId: seeded.runId,
      chatId: seeded.chatId,
      userId: fx.userId,
      attemptId,
      awaiting: awaited(),
      parts: [{ type: 'text', text: 'checkpoint before the wait' }],
      steps: {},
    });

    return { ...seeded, attemptId };
  }

  /** A `/compact` Run on the role, parked in the same quota wait. */
  async function parkedCompaction(): Promise<{
    chatId: string;
    runId: string;
  }> {
    const seeded = await fx.db(async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: fx.userId,
        title: 'Harness chat',
      });

      const run = await new RunsRepository(tx).create({
        chatId: chat.id,
        messageId: null,
        kind: 'compaction',
        userId: fx.userId,
        modelId: CODEX.id,
        selector: '@coding',
      });

      const started = await new RunsRepository(tx).markStarted(
        run.id,
        fx.userId,
      );

      const attempt = started?.activeAttemptId;

      if (!attempt) throw new Error('The compaction Run claimed no attempt.');

      return { chatId: chat.id, runId: run.id, attempt };
    });

    await fx.harness.moduleRef.get(RunWaitService).suspendForQuota({
      runId: seeded.runId,
      chatId: seeded.chatId,
      userId: fx.userId,
      attemptId: seeded.attempt,
      awaiting: awaited(),
      parts: [],
      steps: {},
    });

    return seeded;
  }

  /** The reply of one triggering message. */
  async function replyOf(
    chatId: string,
    inReplyTo: string,
  ): Promise<Message | undefined> {
    const chat = await fx.db((tx) =>
      new MessagesRepository(tx).findByChatId(chatId, fx.userId),
    );

    return chat.find(
      (message) =>
        message.role === 'assistant' && message.inReplyTo === inReplyTo,
    );
  }

  function switchItemOf(
    parts: ReadonlyArray<unknown>,
  ): ContextItemPart | undefined {
    return parts.filter(
      (part): part is ContextItemPart =>
        isContextItemPart(part) &&
        part.data.producer === 'effective-context-change',
    )[0];
  }

  it('A weekly limit ends early', async () => {
    const parked = await parkedRun();
    const promptsBefore = fx.harness.models.prompts.length;

    fx.harness.models.register(SONNET.id, {
      kind: 'step-script',
      steps: [answer('sonnet answer')],
    });

    const response = await endpoint().nextCandidate(fx.userId, parked.runId);

    expect(response).toMatchObject({ id: parked.runId, status: 'queued' });

    const moved = await fx.run(parked.runId);

    expect(moved).toMatchObject({
      modelId: SONNET.id,
      effort: 'low',
      awaiting: null,
      selector: '@coding',
    });
    expect(moved?.currentJobId).not.toBe(null);
    expect(moved?.messageId).not.toBe(parked.userMessage.id);

    const closed = await replyOf(parked.chatId, parked.userMessage.id);

    expect(closed?.usage).toMatchObject({
      status: 'error',
      complete: false,
      modelId: CODEX.id,
    });
    // The parked reply is closed from the checkpoint `run.suspended` carried.
    expect(closed?.parts).toContainEqual({
      type: 'text',
      text: 'checkpoint before the wait',
    });
    expect(closed?.usage).not.toHaveProperty('interrupted');

    const host = await fx.db((tx) =>
      new MessagesRepository(tx).findById(
        parked.chatId,
        fx.userId,
        moved?.messageId ?? '',
      ),
    );

    const switchItem = switchItemOf(host?.parts ?? []);

    expect(switchItem?.data.form).toBe('notice');
    expect(isModelChangePayload(switchItem?.data.payload)).toBe(true);
    expect(switchItem?.data.payload).toMatchObject({
      cause: 'failover',
      fromModelId: CODEX.id,
      toModelId: SONNET.id,
      failureClass: 'quota_exhausted',
    });
    expect(host?.parts.at(1)).toMatchObject({
      type: 'text',
      text: 'steer while parked',
    });
    expect(host?.seq).toBeGreaterThan(closed?.seq ?? 0);

    const events = await fx.events(parked.runId);

    const delivered = events.find(
      (event) => event.eventType === 'run.delivered',
    );

    expect(delivered?.payload).toMatchObject({
      messageId: moved?.messageId,
      cause: 'failover',
      stoppedCalls: [],
    });
    expect(delivered?.payload).not.toHaveProperty('checkpointId');

    const switched = events.find(
      (event) => event.eventType === 'model.switched',
    );

    expect(switched?.payload).toEqual({
      fromModelId: CODEX.id,
      fromEffort: 'high',
      toModelId: SONNET.id,
      toEffort: 'low',
      failureClass: 'quota_exhausted',
      messageId: moved?.messageId,
      origin: 'owner',
    });

    const finished = await fx.terminal(parked.runId);

    expect(finished?.status).toBe('completed');

    // The next request went to sonnet, carried the host message, and the
    // worker's client is the scripted one registered for that model.
    const prompts = fx.harness.models.prompts
      .slice(promptsBefore)
      .map((prompt) => flatten(prompt).join('\n'));

    expect(fx.harness.models.createClientCalls.at(-1)).toEqual({
      modelId: SONNET.id,
    });
    expect(prompts.join('\n')).toContain('steer while parked');
    expect(prompts.join('\n')).toContain(
      'The active model changed during this Run',
    );
    expect(prompts.join('\n')).toContain('You are now Claude Sonnet');
  });

  it('Another owner calls the action', async () => {
    const parked = await parkedRun();

    const otherUserId = await createUser(fx.harness.db, 'next-candidate-other');

    await expect(
      endpoint().nextCandidate(otherUserId, parked.runId),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(await fx.run(parked.runId)).toMatchObject({
      status: 'awaiting_quota',
      modelId: CODEX.id,
    });
    expect(await fx.types(parked.runId)).not.toContain('model.switched');
  });

  it('An exact selector in a quota wait', async () => {
    const parked = await parkedRun(CODEX.id);

    const refused = endpoint().nextCandidate(fx.userId, parked.runId);

    await expect(refused).rejects.toBeInstanceOf(NextCandidateUnavailableError);
    await expect(refused).rejects.toMatchObject({
      code: 'next_candidate_unavailable',
    });

    expect(await fx.run(parked.runId)).toMatchObject({
      status: 'awaiting_quota',
      modelId: CODEX.id,
    });
    expect(await fx.types(parked.runId)).not.toContain('model.switched');
  });

  it('A compaction Run in a quota wait', async () => {
    const compacting = await parkedCompaction();

    const refused = endpoint().nextCandidate(fx.userId, compacting.runId);

    await expect(refused).rejects.toBeInstanceOf(NextCandidateUnavailableError);
    await expect(refused).rejects.toMatchObject({
      code: 'next_candidate_unavailable',
    });
    expect(await fx.run(compacting.runId)).toMatchObject({
      status: 'awaiting_quota',
    });
  });

  it('Continue on next candidate wakes the Run', async () => {
    const parked = await parkedRun();

    fx.harness.models.register(SONNET.id, {
      kind: 'step-script',
      steps: [answer('woken on sonnet')],
    });

    const waiting = await fx.run(parked.runId);
    const deadlineJobId = waiting?.currentJobId;

    if (!deadlineJobId) throw new Error('The quota wait parked no job.');

    await endpoint().nextCandidate(fx.userId, parked.runId);

    const wake = await fx.db((tx) =>
      fx.harness.moduleRef.get(RunWaitService).wakeInTransaction(tx, {
        runId: parked.runId,
        userId: fx.userId,
        generation: waiting?.wakeGeneration ?? 0,
        cause: 'timeout',
        deadlineJobId,
      }),
    );

    expect(wake).toBe(false);
    expect(await fx.harness.queue.jobState(RUNS_QUEUE, deadlineJobId)).toBe(
      'queued',
    );

    const finished = await fx.terminal(parked.runId);

    expect(finished?.status).toBe('completed');
    expect(await fx.types(parked.runId)).not.toContain('run.resumed');
  });
});
