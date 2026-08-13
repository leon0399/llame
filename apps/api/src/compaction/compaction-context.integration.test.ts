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
import { type ModelClientFactory } from '../models/models.service';
import { MemoryService } from '../memory/memory.service';
import { SearchIndexService } from '../search/search-index.service';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from '../chats/chats-repository';
import { RecencyDigestService } from '../chats/recency-digest.service';
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
import {
  CompactionService,
  TransitionCompactionError,
} from './compaction.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

/** These tests pass a real `client` straight to `maybeCompact`, so `models.createClient` is never exercised. */
const unexercisedModels: ModelClientFactory = {
  createClient: () => {
    throw new Error('createClient was not stubbed for this test');
  },
};

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

  function createCompactionService(models: ModelClientFactory) {
    return new CompactionService(
      tenantDb,
      models,
      new MemoryService(tenantDb),
      new RecencyDigestService(tenantDb),
    );
  }

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

  async function seedHistory(messagePairs = 5, withToolObservations = false) {
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
          parts: withToolObservations
            ? [
                {
                  type: 'tool-search_conversations',
                  toolCallId: `history-call-${index}`,
                  state: 'output-available',
                  input: { query: `query-${index}` },
                  output: {
                    status: 'success',
                    value: `PRIVATE-PAYLOAD-${index}`,
                  },
                  outcome: 'success',
                },
                { type: 'text', text: `answer-${index}` },
              ]
            : [{ type: 'text', text: `answer-${index}` }],
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
    const service = createCompactionService(unexercisedModels);
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
      system:
        'EXACT SNAPSHOTTED PROMPT\n<user_personalization>Ada</user_personalization>\n<user_chat_history>Other chat</user_chat_history>',
      toolDeclarations: declarations,
      lastTurnTotalTokens: 10,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(
      'EXACT SNAPSHOTTED PROMPT\n<user_personalization>Ada</user_personalization>\n<user_chat_history>Other chat</user_chat_history>',
    );
    expect(calls[0].messages.at(-1)).toEqual({
      role: 'user',
      content: COMPACTION_INSTRUCTION,
    });
    expect(calls[0].messages.slice(0, -1)).not.toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining('<user_personalization>'),
      }),
    );
    expect(COMPACTION_INSTRUCTION).toContain('<user_personalization>');
    expect(COMPACTION_INSTRUCTION).toContain('<user_chat_history>');
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

  it('re-bakes the digest only after compaction and resets the told-set to the fresh baseline', async () => {
    const chat = await seedHistory();
    const staleBaseline = {
      pinned: [],
      recent: [
        {
          title: 'Stale source',
          date: '2026-08-01',
          messageCount: 1,
          excerpt: 'old opening',
        },
      ],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 1,
      recentTotal: 1,
      compiledOn: '2026-08-01',
    };
    const staleTold = [
      { chatId: 'stale-source', pinned: false, title: 'Stale source' },
    ];
    const freshSource = await tenantDb.runAs(userId, async (tx) => {
      const chats = new ChatsRepository(tx);
      await chats.setRecencyDigestIfAbsent(
        chat.id,
        userId,
        staleBaseline,
        staleTold,
      );
      const source = await chats.create({
        ownerUserId: userId,
        title: 'Fresh source',
      });
      await new MessagesRepository(tx).create({
        chatId: source.id,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'fresh opening' }],
      });
      return source;
    });
    await new MemoryService(tenantDb).updateForOwner(userId, {
      shareRecentChats: true,
    });
    const calls: ModelStreamInput[] = [];
    const service = createCompactionService(unexercisedModels);

    await service.maybeCompact({
      chatId: chat.id,
      userId,
      client: compactionClient({ model: 'source-model', calls }),
      system: 'SNAPSHOT BEFORE RE-BAKE',
      toolDeclarations: [],
      lastTurnTotalTokens: 10,
    });

    expect(calls[0]?.system).toBe('SNAPSHOT BEFORE RE-BAKE');
    const rebaked = await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).findById(chat.id, userId),
    );
    expect(rebaked?.recencyDigestBaseline?.recent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Fresh source',
          excerpt: 'fresh opening',
        }),
      ]),
    );
    expect(rebaked?.recencyDigestBaseline?.recent).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Stale source' }),
      ]),
    );
    expect(rebaked?.recencyDigestTold).toEqual([
      { chatId: freshSource.id, pinned: false, title: 'Fresh source' },
    ]);
    await sql`DELETE FROM chats WHERE id = ${chat.id}`;
  });

  it('keeps a bound digest unchanged when sharing was disabled before compaction', async () => {
    const chat = await seedHistory();
    const baseline = {
      pinned: [],
      recent: [
        {
          title: 'Previously shared source',
          date: '2026-08-01',
          messageCount: 1,
          excerpt: 'existing opening',
        },
      ],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 1,
      recentTotal: 1,
      compiledOn: '2026-08-01',
    };
    const told = [
      {
        chatId: 'previously-shared-source',
        pinned: false,
        title: 'Previously shared source',
      },
    ];
    await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).setRecencyDigestIfAbsent(
        chat.id,
        userId,
        baseline,
        told,
      ),
    );
    await new MemoryService(tenantDb).updateForOwner(userId, {
      shareRecentChats: false,
    });

    await createCompactionService(unexercisedModels).maybeCompact({
      chatId: chat.id,
      userId,
      client: compactionClient({ model: 'source-model', calls: [] }),
      system: 'BOUND DIGEST PROMPT',
      toolDeclarations: [],
      lastTurnTotalTokens: 10,
    });

    const unchanged = await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).findById(chat.id, userId),
    );
    expect(unchanged?.recencyDigestBaseline).toEqual(baseline);
    expect(unchanged?.recencyDigestTold).toEqual(told);
    await sql`DELETE FROM chats WHERE id = ${chat.id}`;
  });

  it('persists a cleared first ledger and carries it with newly absorbed observations across lineage', async () => {
    const chat = await seedHistory(5, true);
    const calls: ModelStreamInput[] = [];
    const client = compactionClient({ model: 'source-model', calls });
    const service = createCompactionService(unexercisedModels);

    await service.maybeCompact({
      chatId: chat.id,
      userId,
      client,
      system: 'LEDGER PROMPT',
      toolDeclarations: [],
      lastTurnTotalTokens: 10,
    });
    const first = await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(chat.id, userId),
    );
    expect(first?.toolObservationLedger).toEqual({
      version: 1,
      omittedCount: 0,
      observations: [
        {
          toolCallId: 'history-call-0',
          toolName: 'search_conversations',
          outcome: 'success',
        },
      ],
    });
    expect(JSON.stringify(first?.toolObservationLedger)).not.toContain(
      'PRIVATE-PAYLOAD-0',
    );
    expect(JSON.stringify(calls[0]?.messages)).toContain('PRIVATE-PAYLOAD-0');

    await tenantDb.runAs(userId, async (tx) => {
      const messages = new MessagesRepository(tx);
      const user = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: 'request-5' }],
      });
      await messages.create({
        chatId: chat.id,
        role: 'assistant',
        inReplyTo: user.id,
        parts: [
          {
            type: 'tool-search_conversations',
            toolCallId: 'history-call-5',
            state: 'output-error',
            input: { query: 'query-5' },
            errorText: 'Bad input',
            outcome: 'invalid_input',
          },
        ],
        usage: { status: 'completed' },
      });
    });

    await service.maybeCompact({
      chatId: chat.id,
      userId,
      client,
      system: 'LEDGER PROMPT',
      toolDeclarations: [],
      lastTurnTotalTokens: 10,
    });
    const second = await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(chat.id, userId),
    );

    expect(second?.parentId).toBe(first?.id);
    expect(second?.toolObservationLedger.observations).toEqual([
      {
        toolCallId: 'history-call-0',
        toolName: 'search_conversations',
        outcome: 'success',
      },
      {
        toolCallId: 'history-call-1',
        toolName: 'search_conversations',
        outcome: 'success',
      },
    ]);
    const secondRequest = JSON.stringify(calls[1]?.messages);
    expect(secondRequest).toContain('history-call-0');
    expect(secondRequest).toContain('history-call-1');
    expect(secondRequest).not.toContain('PRIVATE-PAYLOAD-0');
    expect(secondRequest).toContain('PRIVATE-PAYLOAD-1');

    await sql`DELETE FROM chats WHERE id = ${chat.id}`;
  });

  it('rejects a provider tool call without persisting a checkpoint or exposing an executor', async () => {
    const chat = await seedHistory();
    const calls: ModelStreamInput[] = [];
    const service = createCompactionService(unexercisedModels);

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
    incompatibleSourceSchema?: boolean;
    switchMarker?: boolean;
    toolObservation?: boolean;
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
      let sourceSnapshot = await seedModelContextSnapshot(
        tx,
        userId,
        // The seeded prompt carries both standing-context blocks: the replayed
        // prefix remains byte-identical while the trailing instruction forbids
        // freezing either owner's profile or another chat's excerpt.
        `<user_personalization>Preferred name: Ana</user_personalization> <user_chat_history>Other chat: private excerpt</user_chat_history> transition-source-${chat.id}`,
        ['search_conversations'],
      );
      if (options?.incompatibleSourceSchema) {
        const [legacySnapshot] = await tx
          .insert(schema.modelContextSnapshots)
          .values({
            ownerUserId: userId,
            availabilityHash:
              '8c150f84f99edb30ec7fb866968b27db1bfc2d26e1be8a7e94ee61e565adf11e',
            contentHash: `legacy-content-${chat.id}`,
            promptHash: sourceSnapshot.promptHash,
            toolHash: `legacy-tools-${chat.id}`,
            source: sourceSnapshot.source,
            systemPrompt: sourceSnapshot.systemPrompt,
            toolAvailabilityManifest: {
              version: 0,
              state: 'unobserved',
            },
            toolDeclarations: [
              {
                id: 'legacy_tool',
                description: 'Persisted before this dialect was understood',
                inputSchema: {
                  $schema: 'https://legacy.invalid/unsupported-schema',
                  type: 'object',
                },
              },
            ],
          })
          .returning();
        if (!legacySnapshot) {
          throw new Error('Failed to seed the legacy model-context snapshot');
        }
        sourceSnapshot = legacySnapshot;
      }
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
        parts: [
          { type: 'text', text: `OLD ANSWER ${'y'.repeat(1_200)}` },
          ...(options?.toolObservation
            ? [
                {
                  type: 'tool-search_conversations',
                  toolCallId: 'transition-tool-call',
                  state: 'output-error',
                  input: { query: 'PRIVATE TRANSITION INPUT' },
                  errorText: 'PRIVATE TRANSITION ERROR',
                  outcome: 'timeout',
                },
              ]
            : []),
        ],
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

  it('fails transition compaction closed when a legacy snapshot schema cannot be rebound', async () => {
    const seeded = await seedSwitch({ incompatibleSourceSchema: true });
    const sourceCalls: ModelStreamInput[] = [];
    const service = createCompactionService({
      createClient: vi.fn(() =>
        compactionClient({ model: 'source-model', calls: sourceCalls }),
      ),
    });

    await expect(
      service.compactForTransition({
        chatId: seeded.chat.id,
        userId,
        triggeringUserSeq: seeded.targetUser.seq,
        reservedOutputTokens: null,
      }),
    ).rejects.toMatchObject({
      name: TransitionCompactionError.name,
      message:
        'Source-model transition compaction returned no valid text summary.',
    });

    expect(sourceCalls).toHaveLength(0);
    await expect(
      tenantDb.runAs(userId, (tx) =>
        new CompactionsRepository(tx).findLatestByChatId(
          seeded.chat.id,
          userId,
        ),
      ),
    ).resolves.toBeUndefined();
    await sql`DELETE FROM chats WHERE id = ${seeded.chat.id}`;
  });

  it('uses one source-snapshot transition checkpoint before invoking the smaller target', async () => {
    const seeded = await seedSwitch({ toolObservation: true });
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
    const createSourceClient = vi.fn(() => sourceClient);
    const compaction = createCompactionService({
      createClient: createSourceClient,
    });
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

    // D7: a run whose bound prompt carried personalization still compacts, the
    // owner text is replayed VERBATIM (the prefix must stay byte-identical or
    // the whole call goes cold), and the exclusion rides in the trailing
    // instruction — the only part outside the cached prefix.
    expect(sourceCalls[0].system).toContain('<user_personalization>');
    expect(sourceCalls[0].system).toContain('Preferred name: Ana');
    expect(sourceCalls[0].system).toContain('<user_chat_history>');
    expect(sourceCalls[0].system).toContain('private excerpt');
    expect(TRANSITION_COMPACTION_INSTRUCTION).toContain(
      '<user_personalization>',
    );
    expect(TRANSITION_COMPACTION_INSTRUCTION).toMatch(
      /do not carry any content out of/i,
    );
    expect(TRANSITION_COMPACTION_INSTRUCTION).toContain('<user_chat_history>');
    expect(JSON.stringify(sourceCalls[0].messages)).not.toContain(
      'CURRENT TRIGGER',
    );
    expect(JSON.stringify(sourceCalls[0].messages)).toContain(
      'PRIVATE TRANSITION INPUT',
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
    expect(JSON.stringify(targetCalls[0].messages)).toContain(
      'transition-tool-call',
    );
    expect(JSON.stringify(targetCalls[0].messages)).toContain(
      'Outcome: timeout',
    );
    expect(JSON.stringify(targetCalls[0].messages)).not.toContain(
      'PRIVATE TRANSITION INPUT',
    );
    expect(JSON.stringify(targetCalls[0].messages)).not.toContain(
      'PRIVATE TRANSITION ERROR',
    );

    const checkpoint = await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(seeded.chat.id, userId),
    );
    expect(checkpoint?.uptoSeq).toBeLessThan(seeded.targetUser.seq);
    expect(checkpoint?.summary).toBe(summary);
    expect(checkpoint?.toolObservationLedger).toEqual({
      version: 1,
      omittedCount: 0,
      observations: [
        {
          toolCallId: 'transition-tool-call',
          toolName: 'search_conversations',
          outcome: 'timeout',
        },
      ],
    });
    await sql`DELETE FROM chats WHERE id = ${seeded.chat.id}`;
  });

  it('settles a cancel requested before the claim without spending on transition compaction', async () => {
    const seeded = await seedSwitch();
    const sourceCalls: ModelStreamInput[] = [];
    const targetCalls: ModelStreamInput[] = [];
    const compaction = createCompactionService({
      createClient: vi.fn(() =>
        compactionClient({ model: 'source-model', calls: sourceCalls }),
      ),
    });
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
    const compaction = createCompactionService({
      createClient: vi.fn(() => sourceClient),
    });
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
    const compaction = createCompactionService({
      createClient: vi.fn(() => sourceClient),
    });
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
    const compaction = createCompactionService({
      createClient: vi.fn(() => sourceClient),
    });
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
        createClient: vi.fn(() => {
          throw new Error('gone');
        }),
      },
    },
    {
      name: 'source compaction fails',
      sourceRun: true,
      models: {
        createClient: vi.fn(() =>
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
      models: { createClient: vi.fn() },
    },
    {
      name: 'one transition summary still exceeds the target window',
      sourceRun: true,
      models: {
        createClient: vi.fn(() =>
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
        runService(createCompactionService(models)).executeRun({
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
