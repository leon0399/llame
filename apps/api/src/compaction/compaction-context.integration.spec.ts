/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable no-unsafe-optional-chaining */

import type { streamText } from 'ai';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type ModelToolDeclaration } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { createFakeModelClient, ZERO_USAGE } from '../models/fake-model-client';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import { type ModelsService } from '../models/models.service';
import { SearchIndexService } from '../search/search-index.service';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from '../chats/chats-repository';
import {
  createModelSwitchPart,
  renderModelSwitchReminder,
} from '../chats/model-context-part';
import {
  CONVERSATION_CHECKPOINT_START,
  type MessagePart,
} from '../chats/context-builder';
import {
  RUN_TIMEOUT_ABORT_REASON,
  RunExecutionService,
  RunNotRunnableError,
} from '../runs/run-execution.service';
import { seedModelContextSnapshot } from '../runs/model-context-snapshot.test-fixture';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import {
  COMPACTION_INSTRUCTION,
  TRANSITION_COMPACTION_INSTRUCTION,
} from './compaction';
import { CompactionService } from './compaction.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

function compactionClient(input: {
  model: string;
  calls: ModelStreamInput[];
  response?: string;
  toolCalls?: unknown[];
  error?: Error;
  contextWindowTokens?: number;
}): ModelClient {
  return {
    model: input.model,
    provider: 'fake',
    contextWindowTokens: input.contextWindowTokens ?? 100_000,
    compactionThresholdTokens: 1,
    streamText(request) {
      input.calls.push(request);
      if (input.error) {
        throw input.error;
      }
      return {
        text: Promise.resolve(input.response ?? '## Objective\nContinue.'),
        toolCalls: Promise.resolve(input.toolCalls ?? []),
        usage: Promise.resolve(ZERO_USAGE),
        finishReason: Promise.resolve('stop'),
      } as unknown as ReturnType<typeof streamText>;
    },
  };
}

describeIfDb('snapshot-bound compaction continuity', () => {
  let sql: SqlClient;
  let tenantDb: TenantDbService;
  let userId: string;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 3 });
    const db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Compaction context', ${`compaction-${userId}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  async function seedHistory(messagePairs = 5) {
    return tenantDb.runAs(userId, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: userId,
      });
      const messages = new MessagesRepository(tx);
      for (let index = 0; index < messagePairs; index++) {
        const user = await messages.create({
          chatId: chat.id,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: `request-${index}` }],
        });
        await messages.create({
          chatId: chat.id,
          role: 'assistant',
          inReplyTo: user.id,
          parts: [{ type: 'text', text: `answer-${index}` }],
          usage: { status: 'completed' },
        });
      }
      return chat;
    });
  }

  it('uses the completed run prompt and schema-only declarations with toolChoice none', async () => {
    const chat = await seedHistory();
    const calls: ModelStreamInput[] = [];
    const client = compactionClient({ model: 'source-model', calls });
    const service = new CompactionService(tenantDb, {} as ModelsService);
    const declarations: ModelToolDeclaration[] = [
      {
        id: 'lookup',
        description: 'Look up context',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
      },
    ];

    await service.maybeCompact({
      chatId: chat.id,
      userId,
      client,
      system: 'EXACT SNAPSHOTTED PROMPT',
      toolDeclarations: declarations,
      lastTurnTotalTokens: 10,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe('EXACT SNAPSHOTTED PROMPT');
    expect(calls[0].messages.at(-1)).toEqual({
      role: 'user',
      content: COMPACTION_INSTRUCTION,
    });
    expect(calls[0].toolChoice).toBe('none');
    expect(Object.keys(calls[0].tools ?? {})).toEqual(['lookup']);
    expect(
      (calls[0].tools?.['lookup'] as { execute?: unknown }).execute,
    ).toBeUndefined();
    expect(
      await (
        calls[0].tools?.['lookup'] as unknown as {
          inputSchema: { jsonSchema: Promise<unknown> };
        }
      ).inputSchema.jsonSchema,
    ).toEqual(declarations[0].inputSchema);

    const persisted = await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(chat.id, userId),
    );
    expect(persisted?.summary).toBe('## Objective\nContinue.');
    await sql`DELETE FROM chats WHERE id = ${chat.id}`;
  });

  it('rejects a provider tool call without persisting a checkpoint or exposing an executor', async () => {
    const chat = await seedHistory();
    const calls: ModelStreamInput[] = [];
    const service = new CompactionService(tenantDb, {} as ModelsService);

    await service.maybeCompact({
      chatId: chat.id,
      userId,
      client: compactionClient({
        model: 'source-model',
        calls,
        toolCalls: [{ toolName: 'lookup', input: {} }],
      }),
      system: 'BOUND PROMPT',
      toolDeclarations: [
        {
          id: 'lookup',
          description: 'Look up context',
          inputSchema: { type: 'object' },
        },
      ],
      lastTurnTotalTokens: 10,
    });

    expect(
      (calls[0].tools?.['lookup'] as { execute?: unknown }).execute,
    ).toBeUndefined();
    await expect(
      tenantDb.runAs(userId, (tx) =>
        new CompactionsRepository(tx).findLatestByChatId(chat.id, userId),
      ),
    ).resolves.toBeUndefined();
    await sql`DELETE FROM chats WHERE id = ${chat.id}`;
  });

  async function seedSwitch(options?: {
    sourceRun?: boolean;
    switchMarker?: boolean;
  }) {
    return tenantDb.runAs(userId, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: userId,
      });
      const messages = new MessagesRepository(tx);
      const runs = new RunsRepository(tx);
      const oldUser = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: `OLD REQUEST ${'x'.repeat(1_200)}` }],
      });
      const sourceSnapshot = await seedModelContextSnapshot(
        tx,
        userId,
        `transition-source-${chat.id}`,
        ['search_conversations'],
      );
      if (options?.sourceRun !== false) {
        const sourceRun = await runs.create({
          chatId: chat.id,
          messageId: oldUser.id,
          userId,
          modelId: 'source-model',
          modelContextSnapshotId: sourceSnapshot.id,
        });
        await runs.markFinished(sourceRun.id, userId, 'completed');
      }
      await messages.create({
        chatId: chat.id,
        role: 'assistant',
        inReplyTo: oldUser.id,
        parts: [{ type: 'text', text: `OLD ANSWER ${'y'.repeat(1_200)}` }],
        usage: { status: 'completed' },
      });
      const targetRunId = crypto.randomUUID();
      const switchPart = createModelSwitchPart({
        fromModelId: 'source-model',
        toModelId: 'target-model',
        runId: targetRunId,
      });
      const targetUser = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: userId,
        parts: [
          ...(options?.switchMarker === false ? [] : [switchPart]),
          { type: 'text', text: 'CURRENT TRIGGER' },
        ],
      });
      const targetSnapshot = await seedModelContextSnapshot(
        tx,
        userId,
        `transition-target-${chat.id}`,
        ['search_conversations'],
      );
      const targetRun = await runs.create({
        id: targetRunId,
        chatId: chat.id,
        messageId: targetUser.id,
        userId,
        modelId: 'target-model',
        modelContextSnapshotId: targetSnapshot.id,
      });
      return {
        chat,
        sourceSnapshot,
        switchPart,
        targetUser,
        targetSnapshot,
        targetRun,
      };
    });
  }

  function runService(compaction: CompactionService) {
    return new RunExecutionService(
      tenantDb,
      compaction,
      { maybeGenerateTitle: async () => {} } as never,
      { config: BUILT_IN_DEFAULTS },
      new SearchIndexService(tenantDb),
      noopReindexDispatch(),
    );
  }

  it('uses one source-snapshot transition checkpoint before invoking the smaller target', async () => {
    const seeded = await seedSwitch();
    const sourceCalls: ModelStreamInput[] = [];
    const targetCalls: ModelStreamInput[] = [];
    const summary =
      '## Objective\nPreserve continuity.\n\n## Current State\nReady.';
    const sourceClient = compactionClient({
      model: 'source-model',
      calls: sourceCalls,
      response: summary,
      contextWindowTokens: 10_000,
    });
    const createSourceClient = jest.fn(() => sourceClient);
    const compaction = new CompactionService(tenantDb, {
      createClient: createSourceClient,
    } as unknown as ModelsService);
    const targetDelegate = createFakeModelClient(['target response'], 500);
    const targetClient: ModelClient = {
      ...targetDelegate,
      model: 'target-model',
      streamText(input) {
        targetCalls.push(input);
        return targetDelegate.streamText(input);
      },
    };

    const result = await runService(compaction).executeRun({
      runId: seeded.targetRun.id,
      chatId: seeded.chat.id,
      userId,
      userMessage: {
        id: seeded.targetUser.id,
        seq: seeded.targetUser.seq,
        parts: seeded.targetUser.parts as MessagePart[],
      },
      client: targetClient,
    });
    await result.consumeStream?.();

    expect(sourceCalls).toHaveLength(1);
    expect(createSourceClient).toHaveBeenCalledWith('source-model');
    expect(sourceCalls[0].system).toBe(seeded.sourceSnapshot.systemPrompt);
    expect(sourceCalls[0].toolChoice).toBe('none');
    expect(Object.keys(sourceCalls[0].tools ?? {})).toEqual([
      'search_conversations',
    ]);
    expect(sourceCalls[0].messages.at(-1)).toEqual({
      role: 'user',
      content: TRANSITION_COMPACTION_INSTRUCTION,
    });
    expect(JSON.stringify(sourceCalls[0].messages)).not.toContain(
      'CURRENT TRIGGER',
    );

    expect(targetCalls).toHaveLength(1);
    expect(targetCalls[0].system).toBe(seeded.targetSnapshot.systemPrompt);
    expect(Object.keys(targetCalls[0].tools ?? {})).toEqual([
      'search_conversations',
    ]);
    expect(targetCalls[0].messages[0]).toEqual({
      role: 'user',
      content: expect.stringMatching(
        new RegExp(
          `^${CONVERSATION_CHECKPOINT_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        ),
      ) as string,
    });
    expect(targetCalls[0].messages[0].content).toContain(summary);
    expect(targetCalls[0].messages.at(-1)).toEqual({
      role: 'user',
      content: `${renderModelSwitchReminder(seeded.switchPart)}\n\nCURRENT TRIGGER`,
    });
    expect(JSON.stringify(targetCalls[0])).not.toContain(
      seeded.sourceSnapshot.systemPrompt,
    );

    const checkpoint = await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(seeded.chat.id, userId),
    );
    expect(checkpoint?.uptoSeq).toBeLessThan(seeded.targetUser.seq);
    expect(checkpoint?.summary).toBe(summary);
    await sql`DELETE FROM chats WHERE id = ${seeded.chat.id}`;
  });

  it('settles a cancel requested before the claim without spending on transition compaction', async () => {
    const seeded = await seedSwitch();
    const sourceCalls: ModelStreamInput[] = [];
    const targetCalls: ModelStreamInput[] = [];
    const compaction = new CompactionService(tenantDb, {
      createClient: jest.fn(() =>
        compactionClient({ model: 'source-model', calls: sourceCalls }),
      ),
    } as unknown as ModelsService);
    const targetDelegate = createFakeModelClient(['must not run'], 500);
    const targetClient: ModelClient = {
      ...targetDelegate,
      model: 'target-model',
      streamText(input) {
        targetCalls.push(input);
        return targetDelegate.streamText(input);
      },
    };

    await tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).requestCancel(seeded.targetRun.id, userId),
    );

    await expect(
      runService(compaction).executeRun({
        runId: seeded.targetRun.id,
        chatId: seeded.chat.id,
        userId,
        userMessage: {
          id: seeded.targetUser.id,
          seq: seeded.targetUser.seq,
          parts: seeded.targetUser.parts as MessagePart[],
        },
        client: targetClient,
      }),
    ).rejects.toBeInstanceOf(RunNotRunnableError);

    expect(sourceCalls).toHaveLength(0);
    expect(targetCalls).toHaveLength(0);
    const settled = await tenantDb.runAs(userId, async (tx: Db) => ({
      run: await new RunsRepository(tx).findById(seeded.targetRun.id, userId),
      events: await new RunEventsRepository(tx).listByRunId(
        seeded.targetRun.id,
        userId,
      ),
    }));
    expect(settled.run?.status).toBe('cancelled');
    expect(settled.events.map((event) => event.eventType)).toEqual([
      'run.cancelled',
    ]);
    await sql`DELETE FROM chats WHERE id = ${seeded.chat.id}`;
  });

  it('aborts in-flight transition compaction and settles the claimed run as expired', async () => {
    const seeded = await seedSwitch();
    const sourceCalls: ModelStreamInput[] = [];
    const targetCalls: ModelStreamInput[] = [];
    let rejectSummary!: (error: Error) => void;
    let sourceStarted!: () => void;
    const sourceStartedPromise = new Promise<void>((resolve) => {
      sourceStarted = resolve;
    });
    const summaryPromise = new Promise<string>((_resolve, reject) => {
      rejectSummary = reject;
    });
    const sourceClient: ModelClient = {
      ...compactionClient({ model: 'source-model', calls: [] }),
      streamText(request) {
        sourceCalls.push(request);
        sourceStarted();
        return {
          text: summaryPromise,
          toolCalls: Promise.resolve([]),
          usage: Promise.resolve(ZERO_USAGE),
          finishReason: Promise.resolve('stop'),
        } as unknown as ReturnType<typeof streamText>;
      },
    };
    const compaction = new CompactionService(tenantDb, {
      createClient: jest.fn(() => sourceClient),
    } as unknown as ModelsService);
    const targetDelegate = createFakeModelClient(['must not run'], 500);
    const targetClient: ModelClient = {
      ...targetDelegate,
      model: 'target-model',
      streamText(input) {
        targetCalls.push(input);
        return targetDelegate.streamText(input);
      },
    };
    const abort = new AbortController();

    const execution = runService(compaction).executeRun({
      runId: seeded.targetRun.id,
      chatId: seeded.chat.id,
      userId,
      userMessage: {
        id: seeded.targetUser.id,
        seq: seeded.targetUser.seq,
        parts: seeded.targetUser.parts as MessagePart[],
      },
      client: targetClient,
      abortSignal: abort.signal,
    });
    await sourceStartedPromise;
    abort.abort(RUN_TIMEOUT_ABORT_REASON);
    rejectSummary(new Error('source request aborted'));

    await expect(execution).rejects.toBeInstanceOf(RunNotRunnableError);
    expect(sourceCalls[0]?.abortSignal).toBe(abort.signal);
    expect(targetCalls).toHaveLength(0);
    const settled = await tenantDb.runAs(userId, async (tx: Db) => ({
      run: await new RunsRepository(tx).findById(seeded.targetRun.id, userId),
      events: await new RunEventsRepository(tx).listByRunId(
        seeded.targetRun.id,
        userId,
      ),
      checkpoint: await new CompactionsRepository(tx).findLatestByChatId(
        seeded.chat.id,
        userId,
      ),
    }));
    expect(settled.run?.status).toBe('expired');
    expect(settled.events.map((event) => event.eventType)).toEqual([
      'run.started',
      'run.expired',
    ]);
    expect(settled.checkpoint).toBeUndefined();
    await sql`DELETE FROM chats WHERE id = ${seeded.chat.id}`;
  });

  it('uses a concurrently won checkpoint instead of failing the target run', async () => {
    const seeded = await seedSwitch();
    const targetCalls: ModelStreamInput[] = [];
    let resolveSummary!: (summary: string) => void;
    let sourceStarted!: () => void;
    const sourceStartedPromise = new Promise<void>((resolve) => {
      sourceStarted = resolve;
    });
    const summaryPromise = new Promise<string>((resolve) => {
      resolveSummary = resolve;
    });
    const sourceClient: ModelClient = {
      ...compactionClient({ model: 'source-model', calls: [] }),
      streamText() {
        sourceStarted();
        return {
          text: summaryPromise,
          toolCalls: Promise.resolve([]),
          usage: Promise.resolve(ZERO_USAGE),
          finishReason: Promise.resolve('stop'),
        } as unknown as ReturnType<typeof streamText>;
      },
    };
    const compaction = new CompactionService(tenantDb, {
      createClient: jest.fn(() => sourceClient),
    } as unknown as ModelsService);
    const targetDelegate = createFakeModelClient(['target response'], 500);
    const targetClient: ModelClient = {
      ...targetDelegate,
      model: 'target-model',
      streamText(input) {
        targetCalls.push(input);
        return targetDelegate.streamText(input);
      },
    };

    const execution = runService(compaction).executeRun({
      runId: seeded.targetRun.id,
      chatId: seeded.chat.id,
      userId,
      userMessage: {
        id: seeded.targetUser.id,
        seq: seeded.targetUser.seq,
        parts: seeded.targetUser.parts as MessagePart[],
      },
      client: targetClient,
    });
    await sourceStartedPromise;
    const concurrentSummary = '## Objective\nUse the newer checkpoint.';
    await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).create({
        chatId: seeded.chat.id,
        uptoSeq: seeded.targetUser.seq - 1,
        summary: concurrentSummary,
      }),
    );
    resolveSummary('## Objective\nDiscard this stale summary.');

    const result = await execution;
    await result.consumeStream?.();

    expect(targetCalls).toHaveLength(1);
    expect(targetCalls[0]?.messages[0]).toEqual({
      role: 'user',
      content: expect.stringContaining(concurrentSummary) as string,
    });
    const settled = await tenantDb.runAs(userId, async (tx: Db) => ({
      run: await new RunsRepository(tx).findById(seeded.targetRun.id, userId),
      checkpoint: await new CompactionsRepository(tx).findLatestByChatId(
        seeded.chat.id,
        userId,
      ),
    }));
    expect(settled.run?.status).toBe('completed');
    expect(settled.checkpoint?.summary).toBe(concurrentSummary);
    await sql`DELETE FROM chats WHERE id = ${seeded.chat.id}`;
  });

  it('persists the transition cutoff when a concurrent checkpoint is too early for the target', async () => {
    const seeded = await seedSwitch();
    const targetCalls: ModelStreamInput[] = [];
    let resolveSummary!: (summary: string) => void;
    let sourceStarted!: () => void;
    const sourceStartedPromise = new Promise<void>((resolve) => {
      sourceStarted = resolve;
    });
    const summaryPromise = new Promise<string>((resolve) => {
      resolveSummary = resolve;
    });
    const sourceClient: ModelClient = {
      ...compactionClient({ model: 'source-model', calls: [] }),
      streamText() {
        sourceStarted();
        return {
          text: summaryPromise,
          toolCalls: Promise.resolve([]),
          usage: Promise.resolve(ZERO_USAGE),
          finishReason: Promise.resolve('stop'),
        } as unknown as ReturnType<typeof streamText>;
      },
    };
    const compaction = new CompactionService(tenantDb, {
      createClient: jest.fn(() => sourceClient),
    } as unknown as ModelsService);
    const targetDelegate = createFakeModelClient(['target response'], 500);
    const targetClient: ModelClient = {
      ...targetDelegate,
      model: 'target-model',
      streamText(input) {
        targetCalls.push(input);
        return targetDelegate.streamText(input);
      },
    };

    const execution = runService(compaction).executeRun({
      runId: seeded.targetRun.id,
      chatId: seeded.chat.id,
      userId,
      userMessage: {
        id: seeded.targetUser.id,
        seq: seeded.targetUser.seq,
        parts: seeded.targetUser.parts as MessagePart[],
      },
      client: targetClient,
    });
    await sourceStartedPromise;
    await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).create({
        chatId: seeded.chat.id,
        // Mirrors an ordinary checkpoint retaining the latest assistant turn.
        uptoSeq: seeded.targetUser.seq - 2,
        summary: '## Objective\nOrdinary checkpoint is not far enough.',
      }),
    );
    const transitionSummary =
      '## Objective\nUse the complete transition checkpoint.';
    resolveSummary(transitionSummary);

    const result = await execution;
    await result.consumeStream?.();

    expect(targetCalls).toHaveLength(1);
    expect(targetCalls[0]?.messages[0]).toEqual({
      role: 'user',
      content: expect.stringContaining(transitionSummary) as string,
    });
    const checkpoint = await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(seeded.chat.id, userId),
    );
    expect(checkpoint?.uptoSeq).toBe(seeded.targetUser.seq - 1);
    expect(checkpoint?.summary).toBe(transitionSummary);
    await sql`DELETE FROM chats WHERE id = ${seeded.chat.id}`;
  });

  it.each([
    {
      name: 'source model unavailable',
      sourceRun: true,
      models: {
        createClient: jest.fn(() => {
          throw new Error('gone');
        }),
      },
    },
    {
      name: 'source compaction fails',
      sourceRun: true,
      models: {
        createClient: jest.fn(() =>
          compactionClient({
            model: 'source-model',
            calls: [],
            error: new Error('compaction failed'),
          }),
        ),
      },
    },
    {
      name: 'public-fork-like history has no owned source run',
      sourceRun: false,
      switchMarker: false,
      models: { createClient: jest.fn() },
    },
    {
      name: 'one transition summary still exceeds the target window',
      sourceRun: true,
      models: {
        createClient: jest.fn(() =>
          compactionClient({
            model: 'source-model',
            calls: [],
            response: `## Objective\n${'z'.repeat(4_000)}`,
          }),
        ),
      },
    },
  ])(
    'fails context_incompatible before target inference when $name',
    async ({ sourceRun, switchMarker, models }) => {
      const seeded = await seedSwitch({ sourceRun, switchMarker });
      const targetCalls: ModelStreamInput[] = [];
      const target = createFakeModelClient(['must not run'], 500);
      const targetClient: ModelClient = {
        ...target,
        model: 'target-model',
        streamText(input) {
          targetCalls.push(input);
          return target.streamText(input);
        },
      };

      await expect(
        runService(
          new CompactionService(tenantDb, models as unknown as ModelsService),
        ).executeRun({
          runId: seeded.targetRun.id,
          chatId: seeded.chat.id,
          userId,
          userMessage: {
            id: seeded.targetUser.id,
            seq: seeded.targetUser.seq,
            parts: seeded.targetUser.parts as MessagePart[],
          },
          client: targetClient,
        }),
      ).rejects.toMatchObject({ code: 'context_incompatible' });

      expect(targetCalls).toHaveLength(0);
      const failed = await tenantDb.runAs(userId, async (tx: Db) => ({
        run: await new RunsRepository(tx).findById(seeded.targetRun.id, userId),
        events: await new RunEventsRepository(tx).listByRunId(
          seeded.targetRun.id,
          userId,
        ),
      }));
      expect(failed.run?.status).toBe('failed');
      expect(failed.run?.error).toMatchObject({ code: 'context_incompatible' });
      expect(
        failed.events.filter((event) => event.eventType === 'run.failed'),
      ).toHaveLength(1);
      await sql`DELETE FROM chats WHERE id = ${seeded.chat.id}`;
    },
  );
});
