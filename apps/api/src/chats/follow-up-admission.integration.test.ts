/**
 * Follow-up admission (turn-actions D1–D4) — light integration: a REAL
 * Postgres + TenantDbService/repositories exercise the chat-row lock, the
 * single-flight admission a chat send shares (including stuck-Run expiry), the
 * action check, and the Run its event log describes. Only the leaves a
 * follow-up does not execute are doubled: the model catalog, the stream
 * bridge, the abort registry, and the queue dispatch.
 *
 * TEST_DATABASE_URL-gated; run by test:integration with the other
 * .integration suites.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { eq } from 'drizzle-orm';
import type { Mock } from 'vitest';

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as schema from '../db/schema';
import type { FollowUpAction, Run } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { MediaService } from '../media/media.service';
import {
  EffortNotAvailableError,
  ModelNotAvailableError,
  PermissionModeNotAvailableError,
  resolveEffortSelection,
  type ModelSelectionValidator,
} from '../models/models.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { runningReplyUsage } from '../runs/run-reply-finalizer';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { type RunStreamResponder } from '../runs/run-stream-bridge';
import { type TerminalRunStatus } from '../runs/run-status';
import type { PermissionMode } from '../tools/permissions/permission-mode';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import { ChatLoopService } from './chat-loop.service';
import { FollowUpAdmissionService } from './follow-up-admission.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import type { FollowUpRequestInput } from './follow-up-admission.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const MODEL_ID = 'system:openai:gpt-5.4-mini';
/** A model the operator removed from the catalog. */
const REMOVED_MODEL_ID = 'system:openai:retired';

const HEARTBEAT_SECONDS = 1;
const STUCK_AGE_MS = 60_000;

type TurnFixture = {
  chatId: string;
  messageId: string;
  runId: string;
  replyId: string | undefined;
};

type Api = {
  sql: Sql;
  db: Db;
  tenantDb: TenantDbService;
  /** The chat-send path, used to prove a reused message id still conflicts. */
  chatLoop: ChatLoopService;
  admission: FollowUpAdmissionService;
  jobState: Mock<RunDispatcher['jobState']>;
  userId: string;
};

function catalogEntry(modelId: string): SystemModelCatalogEntry {
  return {
    id: modelId,
    source: 'system',
    contextWindowTokens: 128_000,
    input: ['text'],
    provider: 'openai',
    providerModelId: modelId,
    systemPromptTemplate: 'Bound prompt',
    systemPromptSource: 'project_default',
    referencesSkills: false,
    // The real effort contract: `high` is declared, and a model default exists
    // so re-defaulting a stored `null` would show up as `low`.
    reasoning: {
      effortLevels: [{ value: 'high' }, { value: 'low' }],
      defaultEffort: 'low',
      cacheInvalidatedByEffortChange: false,
    },
  };
}

function modelValidator(): ModelSelectionValidator {
  return {
    validateModelSelection: (modelId: string) => {
      if (modelId === REMOVED_MODEL_ID) {
        throw new ModelNotAvailableError(modelId);
      }
      return catalogEntry(modelId);
    },
    // The production implementation, so the stored-effort rules are real.
    resolveEffortSelection: (model, effort) =>
      resolveEffortSelection(model, effort),
  };
}

describeIfDb('follow-up admission', () => {
  let api: Api;

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    const sql = postgres(TEST_DB_URL!, { ssl, max: 5 });
    const db = drizzle(sql, { schema });
    const tenantDb = new TenantDbService(db);
    const userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Follow Up', ${`follow-up-${userId}@test.com`})`;

    const jobState = vi.fn<RunDispatcher['jobState']>(() =>
      Promise.resolve('absent'),
    );
    const dispatch: RunDispatcher = {
      dispatch: vi.fn(async () => {}),
      jobState,
    };
    const bridge: RunStreamResponder = {
      createUiMessageStreamResponse: vi.fn(() => new Response()),
    };
    const instanceConfig: InstanceConfigReader = {
      config: {
        ...BUILT_IN_DEFAULTS,
        runs: {
          ...BUILT_IN_DEFAULTS.runs,
          heartbeatSeconds: HEARTBEAT_SECONDS,
        },
        tools: {
          ...BUILT_IN_DEFAULTS.tools,
          permissionModes: ['default', 'bypass'],
        },
      },
    };
    const chatLoop = new ChatLoopService(
      tenantDb,
      modelValidator(),
      instanceConfig,
      bridge,
      new RunAbortRegistry(),
      dispatch,
      new MediaService(tenantDb),
    );

    const admission = new FollowUpAdmissionService(
      tenantDb,
      modelValidator(),
      instanceConfig,
      dispatch,
    );

    api = { sql, db, tenantDb, chatLoop, admission, jobState, userId };
  });

  afterAll(async () => {
    if (api?.sql) {
      await api.sql`DELETE FROM users WHERE id = ${api.userId}`;
      await api.sql.end();
    }
  });

  beforeEach(() => {
    api.jobState.mockReset();
    api.jobState.mockResolvedValue('absent');
  });

  /**
   * One turn: an owned Chat, its user message, a Run of the requested state,
   * and the reply that Run left. Every value a test needs to disagree with
   * (model, effort, mode, statuses, reply) is an option.
   */
  async function seedTurn(options: {
    ownerUserId?: string;
    status: TerminalRunStatus | 'running_model';
    modelId?: string;
    effort?: string | null;
    permissionMode?: PermissionMode;
    replyParts?: Array<unknown>;
    replyUsageStatus?: 'error' | 'aborted' | 'completed' | 'running';
    reply?: boolean;
    followUpAction?: FollowUpAction;
    sourceRunId?: string;
    laterUserMessage?: boolean;
    archived?: boolean;
    ageMs?: number;
    runningAttempt?: boolean;
  }): Promise<TurnFixture> {
    const ownerUserId = options.ownerUserId ?? api.userId;
    return api.tenantDb.runAs(ownerUserId, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId,
        title: 'Follow-up turn',
      });
      if (options.archived === true) {
        await tx
          .update(schema.chats)
          .set({ archivedAt: new Date() })
          .where(eq(schema.chats.id, chat.id));
      }
      const messagesRepo = new MessagesRepository(tx);
      const userMessage = await messagesRepo.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: ownerUserId,
        parts: [{ type: 'text', text: 'Do the work' }],
      });
      if (options.laterUserMessage === true) {
        await messagesRepo.create({
          chatId: chat.id,
          role: 'user',
          senderUserId: ownerUserId,
          parts: [{ type: 'text', text: 'A later question' }],
        });
      }

      const runsRepo = new RunsRepository(tx);
      const created = await runsRepo.create({
        chatId: chat.id,
        messageId: userMessage.id,
        userId: ownerUserId,
        modelId: options.modelId ?? MODEL_ID,
        effort: options.effort ?? undefined,
        permissionMode: options.permissionMode ?? 'default',
        followUpAction: options.followUpAction,
        sourceRunId: options.sourceRunId,
      });
      let run: Run = created;
      if (options.runningAttempt === true) {
        run =
          (await runsRepo.markStarted(created.id, ownerUserId, {
            workerId: 'worker-1',
          })) ?? created;
      }
      if (options.status !== 'running_model' && options.status !== run.status) {
        run =
          (await runsRepo.markFinished(
            created.id,
            ownerUserId,
            options.status,
          )) ?? run;
      }
      if (options.ageMs !== undefined) {
        await tx
          .update(schema.runs)
          .set({
            createdAt: new Date(Date.now() - options.ageMs),
            startedAt: new Date(Date.now() - options.ageMs),
          })
          .where(eq(schema.runs.id, run.id));
        run = { ...run, createdAt: new Date(Date.now() - options.ageMs) };
      }

      let replyId: string | undefined;
      if (options.reply !== false) {
        const usageStatus = options.replyUsageStatus ?? 'error';
        const reply = await messagesRepo.create({
          chatId: chat.id,
          role: 'assistant',
          senderUserId: null,
          parts: options.replyParts ?? [{ type: 'text', text: 'partial' }],
          usage:
            usageStatus === 'running'
              ? runningReplyUsage({
                  runId: run.id,
                  attemptId: run.activeAttemptId ?? crypto.randomUUID(),
                  modelId: run.modelId,
                  effort: run.effort ?? undefined,
                  permissionMode: run.permissionMode,
                })
              : {
                  status: usageStatus,
                  runId: run.id,
                  modelId: run.modelId,
                },
          inReplyTo: userMessage.id,
        });
        replyId = reply.id;
      }

      return {
        chatId: chat.id,
        messageId: userMessage.id,
        runId: run.id,
        replyId,
      };
    });
  }

  async function admit(
    fixture: TurnFixture,
    request: FollowUpRequestInput,
    options?: { userId?: string; admission?: FollowUpAdmissionService },
  ) {
    return (options?.admission ?? api.admission).admitFollowUpRun({
      chatId: fixture.chatId,
      userId: options?.userId ?? api.userId,
      userMessageId: fixture.messageId,
      request,
    });
  }

  function runsOfChat(chatId: string, ownerUserId = api.userId) {
    return api.tenantDb.runAs(ownerUserId, (tx) =>
      new RunsRepository(tx).findByChatId(chatId, ownerUserId),
    );
  }

  function eventsOfRun(runId: string, ownerUserId = api.userId) {
    return api.tenantDb.runAs(ownerUserId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, ownerUserId),
    );
  }

  function runById(runId: string, ownerUserId = api.userId) {
    return api.tenantDb.runAs(ownerUserId, (tx) =>
      new RunsRepository(tx).findById(runId, ownerUserId),
    );
  }

  function replyOf(fixture: TurnFixture, ownerUserId = api.userId) {
    return api.tenantDb.runAs(ownerUserId, (tx) =>
      new MessagesRepository(tx).findById(
        fixture.chatId,
        ownerUserId,
        fixture.replyId ?? '',
      ),
    );
  }

  const settledCall = (toolCallId: string): Array<unknown> => [
    { type: 'reasoning', text: 'think' },
    { type: 'text', text: 'done' },
    {
      type: 'tool-read',
      toolCallId,
      state: 'output-available',
      input: { path: '/tmp/file.txt' },
      output: { content: 'file body' },
    },
  ];

  describe('task 2.2 — admission', () => {
    it('admits a Continue on the latest turn and records the follow-up Run', async () => {
      const fixture = await seedTurn({
        status: 'failed',
        effort: 'high',
        replyParts: settledCall('call-1'),
      });

      const admitted = await admit(fixture, {
        action: 'continue',
        permissionMode: 'bypass',
      });

      expect(admitted.modelId).toBe(MODEL_ID);
      expect(admitted.chatId).toBe(fixture.chatId);
      expect(admitted.userMessage.id).toBe(fixture.messageId);

      const run = await runById(admitted.runId);
      expect(run).toMatchObject({
        chatId: fixture.chatId,
        messageId: fixture.messageId,
        userId: api.userId,
        modelId: MODEL_ID,
        effort: 'high',
        permissionMode: 'bypass',
        followUpAction: 'continue',
        sourceRunId: fixture.runId,
        status: 'queued',
      });

      // The Run's log starts with its identity and the parts it continues.
      const events = await eventsOfRun(admitted.runId);
      expect(events.map((event) => event.eventType)).toEqual([
        'run.created',
        'run.continued',
      ]);
      expect(events[0]?.payload).toEqual({
        chatId: fixture.chatId,
        messageId: fixture.messageId,
        replacesUsage: true,
      });
      expect(events[1]?.payload).toEqual({
        sourceRunId: fixture.runId,
        parts: settledCall('call-1'),
      });
    });

    it('refuses a follow-up on an older turn and changes nothing', async () => {
      const fixture = await seedTurn({
        status: 'failed',
        laterUserMessage: true,
      });
      const replyBefore = await replyOf(fixture);

      await expect(
        admit(fixture, { action: 'continue' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
      expect(await replyOf(fixture)).toEqual(replyBefore);
    });

    it('refuses an older turn before it reads any job state', async () => {
      const fixture = await seedTurn({
        status: 'running_model',
        runningAttempt: true,
        replyUsageStatus: 'running',
        laterUserMessage: true,
      });
      api.jobState.mockResolvedValue('active');

      await expect(
        admit(fixture, { action: 'continue' }),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'A follow-up request applies to the latest user message only',
      });
      // The turn check runs before single-flight admission: a refused request
      // never waits on, or expires, another Run.
      expect(api.jobState).not.toHaveBeenCalled();
      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
    });

    it('refuses a follow-up on an archived Chat with the chat-send error', async () => {
      const fixture = await seedTurn({ status: 'failed', archived: true });

      await expect(
        admit(fixture, { action: 'continue' }),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'This item is archived; unarchive or delete it first.',
      });
      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
    });

    it('refuses a follow-up while a Run of the Chat is live', async () => {
      const fixture = await seedTurn({
        status: 'running_model',
        runningAttempt: true,
        replyUsageStatus: 'running',
      });
      api.jobState.mockResolvedValue('active');

      await expect(
        admit(fixture, { action: 'continue' }),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'Another run is already in flight for this chat',
      });
      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
      expect((await runById(fixture.runId))?.status).toBe('running_model');
    });

    it('expires a stuck Run before the action check and then admits', async () => {
      const fixture = await seedTurn({
        status: 'running_model',
        runningAttempt: true,
        replyUsageStatus: 'running',
        ageMs: STUCK_AGE_MS,
      });
      api.jobState.mockResolvedValue('absent');

      const admitted = await admit(fixture, { action: 'continue' });

      const expired = await runById(fixture.runId);
      expect(expired?.status).toBe('expired');
      expect(
        (await eventsOfRun(fixture.runId)).map((event) => event.eventType),
      ).toEqual(['run.expired']);
      // The expired Run's reply is finalized under its own identity, so the
      // Continue check reads a resumable Run and admits.
      const reply = await replyOf(fixture);
      expect(reply?.usage).toMatchObject({ status: 'aborted' });
      expect(await runById(admitted.runId)).toMatchObject({
        followUpAction: 'continue',
        sourceRunId: fixture.runId,
        status: 'queued',
      });
    });

    it("reveals nothing about another owner's Chat and reads no job state", async () => {
      const otherUserId = crypto.randomUUID();
      await api.sql`INSERT INTO users (id, name, email) VALUES (${otherUserId}, 'Other', ${`other-${otherUserId}@test.com`})`;
      try {
        const foreign = await seedTurn({
          ownerUserId: otherUserId,
          status: 'running_model',
          runningAttempt: true,
        });
        const before = await runsOfChat(foreign.chatId, otherUserId);

        await expect(
          admit(foreign, { action: 'continue' }),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(api.jobState).not.toHaveBeenCalled();
        expect(await runsOfChat(foreign.chatId, otherUserId)).toEqual(before);
      } finally {
        await api.sql`DELETE FROM users WHERE id = ${otherUserId}`;
      }
    });

    it("answers 404 for another owner's message id on an owned Chat", async () => {
      const fixture = await seedTurn({ status: 'failed' });

      await expect(
        api.admission.admitFollowUpRun({
          chatId: fixture.chatId,
          userId: api.userId,
          userMessageId: crypto.randomUUID(),
          request: { action: 'continue' },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
    });

    it('still refuses a chat send that reuses the message id', async () => {
      const fixture = await seedTurn({ status: 'failed' });

      await expect(
        api.chatLoop.createMessageStream({
          chatId: fixture.chatId,
          userId: api.userId,
          modelId: MODEL_ID,
          message: {
            id: fixture.messageId,
            parts: [{ type: 'text', text: 'again' }],
          },
        }),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'Message id already exists',
      });
      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
    });
  });

  describe('task 2.3 — validation and the Continue check', () => {
    it('rejects a model or an effort on Continue before any write', async () => {
      const fixture = await seedTurn({ status: 'failed' });

      await expect(
        admit(fixture, { action: 'continue', modelId: REMOVED_MODEL_ID }),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: 'A continue request does not name a model',
      });
      await expect(
        admit(fixture, { action: 'continue', effort: 'high' }),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: 'A continue request does not name an effort',
      });
      await expect(
        admit(fixture, { action: 'regenerate' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
    });

    it('rejects a permission mode the operator did not enable', async () => {
      const fixture = await seedTurn({ status: 'failed' });
      const admission = new FollowUpAdmissionService(
        api.tenantDb,
        modelValidator(),
        {
          config: {
            ...BUILT_IN_DEFAULTS,
            tools: { ...BUILT_IN_DEFAULTS.tools, permissionModes: ['default'] },
          },
        },
        { dispatch: vi.fn(async () => {}), jobState: api.jobState },
      );

      await expect(
        admit(
          fixture,
          { action: 'continue', permissionMode: 'bypass' },
          { admission },
        ),
      ).rejects.toBeInstanceOf(PermissionModeNotAvailableError);
      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
    });

    it('rejects a Continue whose model the operator removed', async () => {
      const fixture = await seedTurn({
        status: 'failed',
        modelId: REMOVED_MODEL_ID,
      });

      await expect(
        admit(fixture, { action: 'continue' }),
      ).rejects.toBeInstanceOf(ModelNotAvailableError);
      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
    });

    it('refuses a Continue on a completed Run', async () => {
      const fixture = await seedTurn({
        status: 'completed',
        replyUsageStatus: 'completed',
      });

      await expect(
        admit(fixture, { action: 'continue' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
    });

    it('refuses a Continue on a turn whose Run left no reply', async () => {
      const fixture = await seedTurn({ status: 'failed', reply: false });

      await expect(
        admit(fixture, { action: 'continue' }),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'The Run that can be continued left no reply',
      });
      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
    });

    it('refuses a Continue when the reply belongs to an older Run', async () => {
      const fixture = await seedTurn({ status: 'failed' });
      // A Regenerate on another model that failed before dispatch: it is the
      // latest Run, and it left no reply of its own.
      const failedRegenerate = await api.tenantDb.runAs(api.userId, (tx) =>
        new RunsRepository(tx).create({
          chatId: fixture.chatId,
          messageId: fixture.messageId,
          userId: api.userId,
          modelId: MODEL_ID,
          followUpAction: 'regenerate',
          sourceRunId: fixture.runId,
        }),
      );
      await api.tenantDb.runAs(api.userId, (tx) =>
        new RunsRepository(tx).markFinished(
          failedRegenerate.id,
          api.userId,
          'failed',
        ),
      );

      await expect(
        admit(fixture, { action: 'continue' }),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'The reply does not belong to a Run that can be continued',
      });
      expect(await runsOfChat(fixture.chatId)).toHaveLength(2);
    });

    it('keeps a stored null effort as no effort, not the current default', async () => {
      // The model declares `defaultEffort: 'low'`; the source Run sent none, so
      // re-resolving `undefined` would send an effort the turn never used.
      const fixture = await seedTurn({ status: 'failed', effort: null });

      const admitted = await admit(fixture, { action: 'continue' });

      expect((await runById(fixture.runId))?.effort).toBeNull();
      expect((await runById(admitted.runId))?.effort).toBeNull();
    });

    it('rejects a stored effort the model no longer declares', async () => {
      const fixture = await seedTurn({ status: 'failed', effort: 'max' });

      await expect(
        admit(fixture, { action: 'continue' }),
      ).rejects.toBeInstanceOf(EffortNotAvailableError);
      expect(await runsOfChat(fixture.chatId)).toHaveLength(1);
    });

    it('stores the requested mode on the follow-up Run and keeps the old one', async () => {
      const fixture = await seedTurn({ status: 'failed' });

      const admitted = await admit(fixture, {
        action: 'continue',
        permissionMode: 'bypass',
      });

      expect((await runById(admitted.runId))?.permissionMode).toBe('bypass');
      expect((await runById(fixture.runId))?.permissionMode).toBe('default');
    });
  });
});
