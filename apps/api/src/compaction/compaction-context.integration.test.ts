/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import path from 'node:path';

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { asSchema, streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';

import * as schema from '../db/schema';
import {
  type CompactionReplacementMessage,
  type ModelToolDeclaration,
} from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import {
  createModelPromptLoader,
  renderSystemPromptTemplate,
  type TemporalAnchor,
} from '../instance-config/prompt-loader';

const TEST_ANCHOR: TemporalAnchor = {
  systemTime: '2026-08-19 16:36+02:00',
  systemTimezone: 'Europe/Madrid',
};
import { createFakeModelClient } from '../models/fake-model-client';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import { type ModelClientFactory } from '../models/models.service';
import { MemoryService } from '../memory/memory.service';
import { SearchIndexService } from '../search/search-index.service';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from '../chats/chats-repository';
import {
  RecencyDigestService,
  type RecencyDigestResolver,
} from '../chats/recency-digest.service';
import {} from '../chats/context-item';
import {
  COMPACTION_CHECKPOINT_ENVELOPE_PREFIX,
  createModelChangeItem,
} from '../chats/context-item-producers';
import {
  renderConversationCheckpoint,
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
import { type KnowledgeToolResolver } from '../tools/types';
import { isRecord, isString, type UnknownRecord } from '../unknown-record';
import { contentText } from '../testing/support';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = Sql;

/** These tests pass a real `client` straight to `maybeCompact`, so `models.createClient` is never exercised. */
const unexercisedModels: ModelClientFactory = {
  createClient: () => {
    throw new Error('createClient was not stubbed for this test');
  },
};

const knowledgeResolver: KnowledgeToolResolver = {
  listForOwnerPage: () => Promise.resolve({ spaces: [] }),
  resolveBindingForOwnerById: () => Promise.resolve(undefined),
  createAdapter: () => ({
    search: () => Promise.resolve([]),
    read: () => Promise.reject(new Error('Knowledge adapter is not exercised')),
  }),
};

function replacementHistoryFor(
  summary: string,
): Array<CompactionReplacementMessage> {
  return [
    {
      role: 'user',
      parts: [{ type: 'text', text: renderConversationCheckpoint(summary) }],
    },
  ];
}

function replacementToolParts(
  history: Array<CompactionReplacementMessage>,
): Array<UnknownRecord> {
  return history.slice(1).flatMap((record) => {
    const part = record.parts[0];
    return record.role === 'assistant' &&
      record.parts.length === 1 &&
      isRecord(part) &&
      isString(part.type) &&
      part.type.startsWith('tool-')
      ? [part]
      : [];
  });
}

function compactionClient(input: {
  model: string;
  calls: Array<ModelStreamInput>;
  response?: string | Promise<string>;
  toolCalls?: Array<{ toolName: string; input: unknown }>;
  error?: Error;
  contextWindowTokens?: number;
  onStart?: () => void;
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
      const response = Promise.resolve(
        input.response ?? '## Objective\nContinue.',
      );
      const toolCalls = input.toolCalls ?? [];
      const model = new MockLanguageModelV3({
        provider: 'fake',
        modelId: input.model,
        doStream: ({ abortSignal }) => {
          input.onStart?.();
          return Promise.resolve({
            stream: new ReadableStream<LanguageModelV3StreamPart>({
              async start(controller) {
                let aborted = false;
                const onAbort = () => {
                  aborted = true;
                  controller.error(abortSignal?.reason);
                };
                if (abortSignal?.aborted) {
                  onAbort();
                  return;
                }
                abortSignal?.addEventListener('abort', onAbort, { once: true });
                try {
                  const text = await response;
                  if (aborted) {
                    return;
                  }
                  controller.enqueue({ type: 'stream-start', warnings: [] });
                  controller.enqueue({ type: 'text-start', id: 'summary' });
                  if (text.length > 0) {
                    controller.enqueue({
                      type: 'text-delta',
                      id: 'summary',
                      delta: text,
                    });
                  }
                  controller.enqueue({ type: 'text-end', id: 'summary' });
                  for (const [index, toolCall] of toolCalls.entries()) {
                    controller.enqueue({
                      type: 'tool-call',
                      toolCallId: `compaction-tool-${index}`,
                      toolName: toolCall.toolName,
                      input: JSON.stringify(toolCall.input),
                    });
                  }
                  controller.enqueue({
                    type: 'finish',
                    finishReason: {
                      unified: toolCalls.length > 0 ? 'tool-calls' : 'stop',
                      raw: undefined,
                    },
                    usage: {
                      inputTokens: {
                        total: 0,
                        noCache: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                      },
                      outputTokens: { total: 0, text: 0, reasoning: 0 },
                    },
                  });
                  controller.close();
                } catch (error) {
                  controller.error(error);
                } finally {
                  abortSignal?.removeEventListener('abort', onAbort);
                }
              },
            }),
          });
        },
      });
      const toolOptions: Pick<ModelStreamInput, 'tools' | 'toolChoice'> = {};
      if (request.tools) {
        toolOptions.tools = request.tools;
        if (request.toolChoice !== undefined) {
          toolOptions.toolChoice = request.toolChoice;
        }
      }
      return streamText({
        model,
        messages: request.messages,
        system: request.system,
        abortSignal: request.abortSignal,
        ...toolOptions,
      });
    },
  };
}

describeIfDb('snapshot-bound compaction continuity', () => {
  let sql: SqlClient;
  let tenantDb: TenantDbService;
  let userId: string;

  function createCompactionService(
    models: ModelClientFactory,
    recencyDigest: RecencyDigestResolver = new RecencyDigestService(tenantDb),
  ) {
    return new CompactionService(
      tenantDb,
      models,
      new MemoryService(tenantDb),
      recencyDigest,
    );
  }

  beforeAll(async () => {
    const postgres = await import('postgres');
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
    const calls: Array<ModelStreamInput> = [];
    const client = compactionClient({ model: 'source-model', calls });
    const service = createCompactionService(unexercisedModels);
    const declarations: Array<ModelToolDeclaration> = [
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
    const lookupTool = calls[0].tools?.['lookup'];
    if (!lookupTool) {
      throw new Error('Expected compaction request to declare lookup');
    }
    expect(lookupTool.execute).toBeUndefined();
    expect(await asSchema(lookupTool.inputSchema).jsonSchema).toEqual(
      declarations[0].inputSchema,
    );

    const persisted = await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(chat.id, userId),
    );
    expect(persisted?.summary).toBe('## Objective\nContinue.');
    await sql`DELETE FROM chats WHERE id = ${chat.id}`;
  });

  // Every other test here drives compaction with a synthetic `system:` string
  // that merely CONTAINS `<user_chat_history>`. This one renders the real
  // packaged prompt (`chat-default.md`) with a digest and pushes THAT through
  // compaction, because the exclusion instruction and the packaged fence are
  // authored in different files by different layers: the instruction names a
  // delimiter, the template emits one, and nothing until now asserted the two
  // are the same string. If they ever drift, another owner's chat titles and
  // opening excerpts get summarized into a checkpoint that is replayed as
  // history indefinitely — which neither deleting that chat nor disabling the
  // setting can reach.
  it('keeps the packaged prompt digest out of the persisted checkpoint', async () => {
    const chat = await seedHistory();
    const calls: Array<ModelStreamInput> = [];
    const client = compactionClient({ model: 'source-model', calls });
    const service = createCompactionService(unexercisedModels);

    const model = { id: 'system:openai:test', name: 'Test Model' };
    const packagedPrompt = renderSystemPromptTemplate({
      template: createModelPromptLoader({
        configPath: path.resolve(__dirname, '../../llame.config.json'),
      }).resolve(model).systemPromptTemplate,
      model,
      anchor: TEST_ANCHOR,
      chats: {
        pinned: [
          {
            title: 'Quarterly planning',
            date: '2026-08-10',
            messageCount: 8,
            excerpt: 'SECRET-PINNED-OPENING',
          },
        ],
        recent: [
          {
            title: 'Debugging the worker',
            date: '2026-08-09',
            messageCount: 3,
            excerpt: 'SECRET-RECENT-OPENING',
          },
        ],
        pinnedShown: 1,
        pinnedTotal: 1,
        recentShown: 1,
        recentTotal: 4,
        compiledOn: '2026-08-10',
      },
    });
    // Guard the guard: if the block stopped rendering, every assertion below
    // would pass vacuously.
    expect(packagedPrompt).toContain('<user_chat_history>');
    expect(packagedPrompt).toContain('SECRET-PINNED-OPENING');

    await service.maybeCompact({
      chatId: chat.id,
      userId,
      client,
      system: packagedPrompt,
      toolDeclarations: [],
      lastTurnTotalTokens: 10,
    });

    // Replayed verbatim — the exclusion rides the trailing instruction rather
    // than editing the bound prompt, which would cold-start the prefix cache
    // for the whole absorbed conversation.
    expect(calls[0]?.system).toBe(packagedPrompt);

    // The load-bearing assertion: the fence the TEMPLATE emits is character-for
    // -character the one the INSTRUCTION names. The tag name is extracted from
    // the rendered prompt with a generic pattern (not hardcoded as
    // `user_chat_history`) so a rename on the template side is actually
    // detected here rather than silently matched against itself; `user` is
    // undefined above, so `<user_personalization>` cannot also match and mask
    // a mismatch. Renaming either the template or the instruction without the
    // other fails this test — which is the only way the two files can drift.
    const fence = /<([a-z][a-z0-9_]*)>/u.exec(packagedPrompt)?.[1];
    expect(fence).toBeDefined();
    expect(COMPACTION_INSTRUCTION).toContain(`<${fence!}>`);
    expect(TRANSITION_COMPACTION_INSTRUCTION).toContain(`<${fence!}>`);
    expect(calls[0]?.messages.at(-1)?.content).toBe(COMPACTION_INSTRUCTION);

    // Nothing digest-shaped reaches the compactable history either: the digest
    // lives in the system prompt, so a message carrying it would mean it had
    // leaked onto the rail where the summarizer reads uninstructed.
    expect(calls[0]?.messages.slice(0, -1)).not.toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining('SECRET-PINNED-OPENING'),
      }),
    );

    // Deliberately NOT asserted: that the persisted summary omits the excerpts.
    // The fake client returns a canned summary, so such an assertion would pass
    // no matter what the instruction said. Whether a real model honours the
    // exclusion is compliance, which the capability spec already states is
    // advisory rather than structurally enforced — only the delimiter's
    // integrity is guaranteed, and that is what is checked above.
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
    const calls: Array<ModelStreamInput> = [];
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
    const compaction = await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(chat.id, userId),
    );
    expect(rebaked?.recencyDigestRebakedFrom).toBe(compaction?.id);
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
    expect(unchanged?.recencyDigestRebakedFrom).toBeNull();
    await sql`DELETE FROM chats WHERE id = ${chat.id}`;
  });

  it('leaves no re-bake record when digest resolution fails during compaction', async () => {
    const chat = await seedHistory();
    const baseline = {
      pinned: [],
      recent: [],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-08-01',
    };
    await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).setRecencyDigestIfAbsent(
        chat.id,
        userId,
        baseline,
        [],
      ),
    );
    await new MemoryService(tenantDb).updateForOwner(userId, {
      shareRecentChats: true,
    });

    await createCompactionService(unexercisedModels, {
      resolveCandidate: () =>
        Promise.reject(new Error('candidate unavailable')),
    }).maybeCompact({
      chatId: chat.id,
      userId,
      client: compactionClient({ model: 'source-model', calls: [] }),
      system: 'BOUND DIGEST PROMPT',
      toolDeclarations: [],
      lastTurnTotalTokens: 10,
    });

    const [unchanged, compaction] = await tenantDb.runAs(userId, (tx) =>
      Promise.all([
        new ChatsRepository(tx).findById(chat.id, userId),
        new CompactionsRepository(tx).findLatestByChatId(chat.id, userId),
      ]),
    );
    expect(compaction).toBeDefined();
    expect(unchanged?.recencyDigestBaseline).toEqual(baseline);
    expect(unchanged?.recencyDigestTold).toEqual([]);
    expect(unchanged?.recencyDigestRebakedFrom).toBeNull();
    await sql`DELETE FROM chats WHERE id = ${chat.id}`;
  });

  it('persists final cleared replacement records and carries them across lineage', async () => {
    const chat = await seedHistory(5, true);
    const calls: Array<ModelStreamInput> = [];
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
    expect(first?.replacementHistory[0]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text' }],
    });
    expect(first?.replacementHistory[0]?.parts[0]).toMatchObject({
      text: expect.stringContaining(first?.summary ?? ''),
    });
    expect(replacementToolParts(first?.replacementHistory ?? [])).toEqual([
      {
        type: 'tool-search_conversations',
        toolCallId: 'history-call-0',
        state: 'output-available',
        input: {},
        output: expect.stringContaining('Outcome: success'),
        outcome: 'success',
      },
    ]);
    expect(JSON.stringify(first?.replacementHistory)).not.toContain(
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
    expect(replacementToolParts(second?.replacementHistory ?? [])).toEqual([
      {
        type: 'tool-search_conversations',
        toolCallId: 'history-call-0',
        state: 'output-available',
        input: {},
        output: expect.stringContaining('Outcome: success'),
        outcome: 'success',
      },
      {
        type: 'tool-search_conversations',
        toolCallId: 'history-call-1',
        state: 'output-available',
        input: {},
        output: expect.stringContaining('Outcome: success'),
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
    const calls: Array<ModelStreamInput> = [];
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

    expect(calls[0].tools?.['lookup']?.execute).toBeUndefined();
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
    /** Effort persisted on the SOURCE run, as its accepting API stored it. */
    sourceEffort?: string;
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
        parts: [{ type: 'text', text: `OLD REQUEST ${'x'.repeat(1200)}` }],
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
          ...(options?.sourceEffort !== undefined && {
            effort: options.sourceEffort,
          }),
          modelContextSnapshotId: sourceSnapshot.id,
        });
        await runs.markFinished(sourceRun.id, userId, 'completed');
      }
      await messages.create({
        chatId: chat.id,
        role: 'assistant',
        inReplyTo: oldUser.id,
        parts: [
          { type: 'text', text: `OLD ANSWER ${'y'.repeat(1200)}` },
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
      const switchPart = createModelChangeItem({
        fromModelId: 'source-model',
        toModelId: 'target-model',
        runId: targetRunId,
      });
      const targetUserParts: Array<MessagePart> = [
        ...(options?.switchMarker === false ? [] : [switchPart]),
        { type: 'text', text: 'CURRENT TRIGGER' },
      ];
      const targetUser = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: userId,
        parts: targetUserParts,
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
        targetUserParts,
        targetSnapshot,
        targetRun,
      };
    });
  }

  function runService(compaction: CompactionService) {
    return new RunExecutionService(
      tenantDb,
      compaction,
      { maybeGenerateTitle: async () => {} },
      { config: BUILT_IN_DEFAULTS },
      new SearchIndexService(tenantDb),
      noopReindexDispatch(),
      knowledgeResolver,

      noopEmbedDispatch(),
    );
  }

  it('fails transition compaction closed when a legacy snapshot schema cannot be rebound', async () => {
    const seeded = await seedSwitch({ incompatibleSourceSchema: true });
    const sourceCalls: Array<ModelStreamInput> = [];
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

  // Compaction inherits effort for ONE reason: it reproduces the finished
  // turn's system prompt and message prefix so the call lands on the
  // provider's still-warm prompt cache. Sending a different effort would
  // invalidate the message blocks that request shape exists to reuse.
  it('sends the triggering run effort on the compaction call and records it', async () => {
    const chat = await seedHistory();
    const calls: Array<ModelStreamInput> = [];
    const client = compactionClient({ model: 'source-model', calls });

    await createCompactionService(unexercisedModels).maybeCompact({
      chatId: chat.id,
      userId,
      client,
      system: 'EXACT SNAPSHOTTED PROMPT',
      toolDeclarations: [],
      effort: 'xhigh',
      lastTurnTotalTokens: 10,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.effort).toBe('xhigh');

    const persisted = await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(chat.id, userId),
    );
    expect(persisted?.usage).toMatchObject({ effort: 'xhigh' });
  });

  it('sends no effort on the compaction call when the triggering run carried none', async () => {
    const chat = await seedHistory();
    const calls: Array<ModelStreamInput> = [];
    const client = compactionClient({ model: 'source-model', calls });

    await createCompactionService(unexercisedModels).maybeCompact({
      chatId: chat.id,
      userId,
      client,
      system: 'EXACT SNAPSHOTTED PROMPT',
      toolDeclarations: [],
      lastTurnTotalTokens: 10,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.effort).toBeUndefined();
  });

  // A9: transition compaction reuses the SOURCE model and the SOURCE
  // snapshot's system prompt, so the source run's effort is the one whose
  // cache is at stake. The incoming turn's effort is not part of that prefix,
  // and was validated against a different model's declared levels entirely.
  it('sends the source run effort on transition compaction, not the incoming turn effort', async () => {
    const seeded = await seedSwitch({ sourceEffort: 'high' });
    const sourceCalls: Array<ModelStreamInput> = [];
    const sourceClient = compactionClient({
      model: 'source-model',
      calls: sourceCalls,
      response:
        '## Objective\nPreserve continuity.\n\n## Current State\nReady.',
      contextWindowTokens: 10_000,
    });
    const compaction = createCompactionService({
      createClient: vi.fn(() => sourceClient),
    });
    const targetDelegate = createFakeModelClient(['target response'], 600);
    const targetClient: ModelClient = {
      ...targetDelegate,
      model: 'target-model',
      streamText: (input) => targetDelegate.streamText(input),
    };

    const result = await runService(compaction).executeRun({
      runId: seeded.targetRun.id,
      chatId: seeded.chat.id,
      userId,
      userMessage: {
        id: seeded.targetUser.id,
        seq: seeded.targetUser.seq,
        parts: seeded.targetUserParts,
      },
      client: targetClient,
    });
    await result.consumeStream?.();

    expect(sourceCalls).toHaveLength(1);
    expect(sourceCalls[0]?.effort).toBe('high');

    const persisted = await tenantDb.runAs(userId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(seeded.chat.id, userId),
    );
    // The recorded effort must match what was actually sent, or the receipt
    // would attribute this call's cost to the wrong level.
    expect(persisted?.usage).toMatchObject({ effort: 'high' });
  });

  it('uses one source-snapshot transition checkpoint before invoking the smaller target', async () => {
    const seeded = await seedSwitch({ toolObservation: true });
    const sourceCalls: Array<ModelStreamInput> = [];
    const targetCalls: Array<ModelStreamInput> = [];
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
    // Synthetic bound, sized to fit exactly one transition checkpoint plus the
    // switch item. Raised from 500 when the unified envelope added a measured
    // ~17 tokens to a checkpoint and ~24 to a notice (attributes plus the
    // one-line provenance statement) — the budget was calibrated to the old
    // per-producer delimiters, not to a behaviour change.
    const targetDelegate = createFakeModelClient(['target response'], 600);
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
        parts: seeded.targetUserParts,
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
      content: [
        {
          type: 'text',
          text: expect.stringMatching(
            new RegExp(
              `^${COMPACTION_CHECKPOINT_ENVELOPE_PREFIX.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`,
            ),
          ),
        },
      ],
    });
    expect(contentText(targetCalls[0].messages[0].content)).toContain(summary);
    expect(targetCalls[0].messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: seeded.switchPart.data.text },
        { type: 'text', text: 'CURRENT TRIGGER' },
      ],
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
    expect(replacementToolParts(checkpoint?.replacementHistory ?? [])).toEqual([
      {
        type: 'tool-search_conversations',
        toolCallId: 'transition-tool-call',
        state: 'output-available',
        input: {},
        output: expect.stringContaining('Outcome: timeout'),
        outcome: 'timeout',
      },
    ]);
    await sql`DELETE FROM chats WHERE id = ${seeded.chat.id}`;
  });

  it('settles a cancel requested before the claim without spending on transition compaction', async () => {
    const seeded = await seedSwitch();
    const sourceCalls: Array<ModelStreamInput> = [];
    const targetCalls: Array<ModelStreamInput> = [];
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
          parts: seeded.targetUserParts,
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
    const sourceCalls: Array<ModelStreamInput> = [];
    const targetCalls: Array<ModelStreamInput> = [];
    let sourceStarted!: () => void;
    const sourceStartedPromise = new Promise<void>((resolve) => {
      sourceStarted = resolve;
    });
    const summaryPromise = new Promise<string>(() => undefined);
    const sourceClient = compactionClient({
      model: 'source-model',
      calls: sourceCalls,
      response: summaryPromise,
      onStart: sourceStarted,
    });
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
        parts: seeded.targetUserParts,
      },
      client: targetClient,
      abortSignal: abort.signal,
    });
    await sourceStartedPromise;
    abort.abort(RUN_TIMEOUT_ABORT_REASON);

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
    const targetCalls: Array<ModelStreamInput> = [];
    let resolveSummary!: (summary: string) => void;
    let sourceStarted!: () => void;
    const sourceStartedPromise = new Promise<void>((resolve) => {
      sourceStarted = resolve;
    });
    const summaryPromise = new Promise<string>((resolve) => {
      resolveSummary = resolve;
    });
    const sourceClient = compactionClient({
      model: 'source-model',
      calls: [],
      response: summaryPromise,
      onStart: sourceStarted,
    });
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
        parts: seeded.targetUserParts,
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
        replacementHistory: replacementHistoryFor(concurrentSummary),
      }),
    );
    resolveSummary('## Objective\nDiscard this stale summary.');

    const result = await execution;
    await result.consumeStream?.();

    expect(targetCalls).toHaveLength(1);
    expect(targetCalls[0]?.messages[0].role).toBe('user');
    expect(contentText(targetCalls[0]?.messages[0].content ?? '')).toContain(
      concurrentSummary,
    );
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
    const targetCalls: Array<ModelStreamInput> = [];
    let resolveSummary!: (summary: string) => void;
    let sourceStarted!: () => void;
    const sourceStartedPromise = new Promise<void>((resolve) => {
      sourceStarted = resolve;
    });
    const summaryPromise = new Promise<string>((resolve) => {
      resolveSummary = resolve;
    });
    const sourceClient = compactionClient({
      model: 'source-model',
      calls: [],
      response: summaryPromise,
      onStart: sourceStarted,
    });
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
        parts: seeded.targetUserParts,
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
        replacementHistory: replacementHistoryFor(
          '## Objective\nOrdinary checkpoint is not far enough.',
        ),
      }),
    );
    const transitionSummary =
      '## Objective\nUse the complete transition checkpoint.';
    resolveSummary(transitionSummary);

    const result = await execution;
    await result.consumeStream?.();

    expect(targetCalls).toHaveLength(1);
    expect(targetCalls[0]?.messages[0].role).toBe('user');
    expect(contentText(targetCalls[0]?.messages[0].content ?? '')).toContain(
      transitionSummary,
    );
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
            response: `## Objective\n${'z'.repeat(4000)}`,
          }),
        ),
      },
    },
  ])(
    'fails context_incompatible before target inference when $name',
    async ({ sourceRun, switchMarker, models }) => {
      const seeded = await seedSwitch({ sourceRun, switchMarker });
      const targetCalls: Array<ModelStreamInput> = [];
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
            parts: seeded.targetUserParts,
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
