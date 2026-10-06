/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';

import type {
  Chat,
  Message,
  RecencyDigestBaseline,
  Run,
  SkillCatalogBaseline,
  SystemPromptReceipt,
} from '../db/schema';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { createModelPromptLoader } from '../instance-config/prompt-loader';
import {
  formatTemporalAnchor,
  resolveInstanceTimezone,
} from '../prompts/temporal-anchor';
import { createFakeModelClient } from '../models/fake-model-client';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import {
  type ModelClientFactory,
  type ModelSelectionValidator,
} from '../models/models.service';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import { MemoryService } from '../memory/memory.service';
import { SearchIndexService } from '../search/search-index.service';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { type SkillCatalogPort } from '../skills/skill-catalog';
import { noopSkillCatalog } from '../skills/skill-catalog.stub';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import {
  RecencyDigestService,
  type RecencyDigestResolver,
} from '../chats/recency-digest.service';
import { type AuthoredContextItemPart } from '../chats/context-item';
import {
  checkpointSummary,
  createCompactionCheckpointPart,
  createModelChangeItem,
} from '../chats/context-item-producers';
import type { MessagePart } from '../chats/context-builder';
import {
  RUN_TIMEOUT_ABORT_REASON,
  RunExecutionService,
  RunNotRunnableError,
} from '../runs/run-execution.service';
import { SystemPromptReceiptsRepository } from '../runs/system-prompt-receipts.repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import {
  COMPACTION_INSTRUCTION,
  TRANSITION_COMPACTION_INSTRUCTION,
} from './compaction';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { CompactionService } from './compaction.service';
import { type KnowledgeToolResolver } from '../tools/types';
import type { KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import { TOOL_REGISTRY } from '../tools/registry';
import { contentText } from '../testing/support';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = Sql;
type ExecuteRunInput = Parameters<RunExecutionService['executeRun']>[0];

const SOURCE_MODEL = 'source-model';
const TARGET_MODEL = 'target-model';
const SUMMARY =
  '## Objective\nPreserve continuity.\n\n## Current State\nReady.';
/** Sized so a request carrying the two seeded rows cannot fit, a checkpoint can. */
const SMALL_WINDOW = 1000;
const OLD_REQUEST = `OLD REQUEST ${'x'.repeat(1200)}`;
const OLD_ANSWER = `OLD ANSWER ${'y'.repeat(1200)}`;

/**
 * The threshold variant summarizes with the attempt's own client, so most tests
 * here never reach `models.createClient`; the window variant tests stub it.
 */
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
    resolveHostPath: () =>
      Promise.reject(new Error('Knowledge adapter is not exercised')),
    isInsideSpace: () => Promise.resolve(true),
  }),
};

const executionModels: ModelSelectionValidator = {
  validateModelSelection: (modelId: string): SystemModelCatalogEntry => ({
    id: modelId,
    source: 'system',
    contextWindowTokens: 128_000,
    provider: 'fake',
    providerModelId: modelId,
    systemPromptTemplate: 'Test prompt: default',
    systemPromptSource: 'project_default',
    referencesSkills: false,
  }),
  resolveEffortSelection: () => undefined,
};

const knowledgeCandidates: KnowledgeToolCandidateResolverPort = {
  resolve: () =>
    Promise.resolve(
      [...TOOL_REGISTRY.values()].map((tool) => ({
        source: { type: 'code_owned' as const },
        state: 'available' as const,
        tool,
      })),
    ),
};

/**
 * A template that renders every epoch input a checkpoint re-bakes into the
 * system prompt: the temporal anchor (derived from the active checkpoint's
 * timestamp), the digest baseline's titles and the skill catalog's names.
 */
const EPOCH_TEMPLATE =
  'Epoch prompt at {{context.systemTime}}.{{#if chats}} Chats:{{#each chats.recent}} [{{title}}]{{/each}}{{/if}}{{#if skills}} Skills:{{#each skills.entries}} [{{name}}]{{/each}}{{/if}}';

const epochModels: ModelSelectionValidator = {
  validateModelSelection: (modelId: string): SystemModelCatalogEntry => ({
    id: modelId,
    source: 'system',
    contextWindowTokens: 128_000,
    provider: 'fake',
    providerModelId: modelId,
    systemPromptTemplate: EPOCH_TEMPLATE,
    systemPromptSource: 'project_default',
    referencesSkills: true,
  }),
  resolveEffortSelection: () => undefined,
};

const EPOCH_EXECUTOR_ID = 'compaction-epoch-host';
/** The chat's creation time, far from "now" so the anchors it and a checkpoint derive can never coincide. */
const CHAT_CREATED_AT = new Date('2026-01-15T10:30:00.000Z');

const STALE_DIGEST: RecencyDigestBaseline = {
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
/**
 * The told-set names a chat by id, and the digest's pin correction queries
 * those ids: a placeholder that is not a UUID would fail that read rather
 * than exercising it, so this names a chat the owner has since deleted.
 */
const STALE_SOURCE_CHAT_ID = '00000000-0000-4000-8000-0000000000a1';
const STALE_DIGEST_TOLD = [
  {
    chatId: STALE_SOURCE_CHAT_ID,
    pinned: false,
    title: 'Stale source',
  },
];
const STALE_SKILLS: SkillCatalogBaseline = {
  entries: [{ name: 'stale-skill', description: 'Retired skill.' }],
  omitted: 0,
};
const LIVE_SKILLS: SkillCatalogBaseline = {
  entries: [{ name: 'live-skill', description: 'Current skill.' }],
  omitted: 0,
};
const LIVE_CATALOG: SkillCatalogPort = {
  getSnapshot: () => ({
    available: true,
    directories: ['/opt/skills'],
    entries: [
      {
        name: 'live-skill',
        description: 'Current skill.',
        proactive: true,
        sourceDirectory: '/opt/skills',
        skillDirectory: '/opt/skills/live-skill',
        available: true,
        diagnostics: [],
      },
    ],
    diagnostics: [],
  }),
};

/** The epoch prompt exactly as the Run renders it for the given epoch inputs. */
function renderEpochPrompt(input: {
  instant: Date;
  chats: RecencyDigestBaseline | null;
  skills: SkillCatalogBaseline;
}): string {
  return new SystemPromptsService().render({
    model: epochModels.validateModelSelection(TARGET_MODEL),
    anchor: formatTemporalAnchor(input.instant, resolveInstanceTimezone()),
    chats: input.chats ?? undefined,
    skills: input.skills,
    admittedToolIds: [],
  });
}

/** A summary request, told apart from the Run's own request by its trailing instruction. */
function isSummaryRequest(request: ModelStreamInput): boolean {
  const last = request.messages.at(-1)?.content;
  return (
    last === COMPACTION_INSTRUCTION ||
    last === TRANSITION_COMPACTION_INSTRUCTION
  );
}

function sole<T>(rows: ReadonlyArray<T>): T {
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one row, found ${rows.length}`);
  }
  return rows[0];
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
    contextWindowTokens: input.contextWindowTokens ?? 200_000,
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

/**
 * One model client serving both halves of a threshold trigger: the attempt's
 * own summary request (answered by `summary`) and the request the Run then
 * sends (answered with `answer`, or never when `answer` is null — an attempt
 * that dies before its model answers). Every request is recorded in `calls`.
 */
function attemptClient(input: {
  calls: Array<ModelStreamInput>;
  summary?: {
    response?: string;
    toolCalls?: Array<{ toolName: string; input: unknown }>;
    error?: Error;
  };
  answer?: string | null;
  compactionThresholdTokens?: number;
}): ModelClient {
  const summaryClient = compactionClient({
    model: TARGET_MODEL,
    calls: [],
    ...input.summary,
  });
  const answerClient =
    input.answer === null
      ? compactionClient({
          model: TARGET_MODEL,
          calls: [],
          response: new Promise<string>(() => undefined),
        })
      : createFakeModelClient([input.answer ?? 'target response']);
  return {
    model: TARGET_MODEL,
    provider: 'fake',
    contextWindowTokens: 128_000,
    ...(input.compactionThresholdTokens !== undefined && {
      compactionThresholdTokens: input.compactionThresholdTokens,
    }),
    streamText(request) {
      input.calls.push(request);
      return isSummaryRequest(request)
        ? summaryClient.streamText(request)
        : answerClient.streamText(request);
    },
  };
}

/** The Run's own model with a window too small for the un-compacted history. */
function windowTarget(calls: Array<ModelStreamInput>): ModelClient {
  const delegate = createFakeModelClient(['target response'], SMALL_WINDOW);
  return {
    ...delegate,
    model: TARGET_MODEL,
    streamText(input) {
      calls.push(input);
      return delegate.streamText(input);
    },
  };
}

describeIfDb('snapshot-bound compaction continuity', () => {
  let sql: SqlClient;
  let tenantDb: TenantDbService;
  let userId: string;
  const doomedChats: Array<string> = [];
  const doomedDirectories: Array<string> = [];

  function createCompactionService(models: ModelClientFactory) {
    return new CompactionService(tenantDb, models);
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

  beforeEach(async () => {
    // Sharing is a per-owner setting that outlives a test: every test starts
    // with it off, and the ones that exercise the digest opt in.
    await new MemoryService(tenantDb).updateForOwner(userId, {
      shareRecentChats: false,
    });
  });

  afterEach(async () => {
    for (const chatId of doomedChats.splice(0)) {
      // Through the owner's transaction: the schema owner is FORCEd under RLS,
      // so a bare connection would match no row.
      await tenantDb.runAs(userId, (tx) =>
        tx.execute(
          dsql`DELETE FROM chats WHERE id = ${chatId} AND owner_user_id = ${userId}`,
        ),
      );
    }
    for (const directory of doomedDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  /**
   * A chat whose last completed Run executed on `sourceModel` and whose next
   * user turn, with its queued Run, is the one under test. The Run has not
   * started, so each test drives `executeRun` itself.
   */
  async function seedSwitch(options?: {
    sourceRun?: boolean;
    switchMarker?: boolean;
    toolObservation?: boolean;
    /** Model the SOURCE run executed on. */
    sourceModel?: string;
    /** Effort persisted on the SOURCE run, as its accepting API stored it. */
    sourceEffort?: string;
    /** Effort persisted on the run under test. */
    targetEffort?: string;
  }): Promise<SeededSwitch> {
    const sourceModel = options?.sourceModel ?? SOURCE_MODEL;
    return tenantDb.runAs(userId, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: userId,
      });
      doomedChats.push(chat.id);
      const messages = new MessagesRepository(tx);
      const runs = new RunsRepository(tx);
      const oldUser = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: userId,
        parts: [{ type: 'text', text: OLD_REQUEST }],
      });
      const sourcePrompt = `<user_personalization>Preferred name: Ana</user_personalization> <user_chat_history>Other chat: private excerpt</user_chat_history> transition-source-${chat.id}`;
      let sourceReceipt: SystemPromptReceipt | undefined;
      if (options?.sourceRun !== false) {
        const sourceRun = await runs.create({
          chatId: chat.id,
          messageId: oldUser.id,
          userId,
          modelId: sourceModel,
          ...(options?.sourceEffort !== undefined && {
            effort: options.sourceEffort,
          }),
        });
        const started = await runs.markStarted(sourceRun.id, userId);
        const attemptId = started?.activeAttemptId;
        if (!attemptId) {
          throw new Error('Failed to assign a source run attempt');
        }
        sourceReceipt = await new SystemPromptReceiptsRepository(tx).create({
          ownerUserId: userId,
          runId: sourceRun.id,
          attemptId,
          source: 'project_default',
          systemPrompt: sourcePrompt,
          promptHash: `transition-source-prompt-${chat.id}`,
        });
        await runs.markFinished(sourceRun.id, userId, 'completed', {
          attemptId,
          turnToolAvailability: [
            { id: 'search_conversations', state: 'available' },
          ],
        });
      }
      await messages.create({
        chatId: chat.id,
        role: 'assistant',
        inReplyTo: oldUser.id,
        parts: [
          { type: 'text', text: OLD_ANSWER },
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
      // A model-change item asserts two DISTINCT models — the producer refuses
      // equal ids — so it is authored only for a turn that really switches.
      const switchPart =
        options?.switchMarker === false || sourceModel === TARGET_MODEL
          ? undefined
          : createModelChangeItem({
              oldModel: { id: sourceModel },
              newModel: { id: TARGET_MODEL },
              runId: targetRunId,
            });
      const targetUserParts: Array<MessagePart> = [
        ...(switchPart === undefined ? [] : [switchPart]),
        { type: 'text', text: 'CURRENT TRIGGER' },
      ];
      const targetUser = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: userId,
        parts: targetUserParts,
      });
      const targetRun = await runs.create({
        id: targetRunId,
        chatId: chat.id,
        messageId: targetUser.id,
        userId,
        modelId: TARGET_MODEL,
        ...(options?.targetEffort !== undefined && {
          effort: options.targetEffort,
        }),
      });
      return {
        chat,
        sourceReceipt,
        switchPart,
        targetUser,
        targetUserParts,
        targetRun,
      };
    });
  }

  /** What `seedSwitch` builds: the chat, the source run's receipt and the turn under test. */
  interface SeededSwitch {
    chat: Chat;
    sourceReceipt: SystemPromptReceipt | undefined;
    /** Absent when the seeded turn switches no model. */
    switchPart: AuthoredContextItemPart | undefined;
    targetUser: Message;
    targetUserParts: Array<MessagePart>;
    targetRun: Run;
  }

  /**
   * `seedSwitch` plus every epoch input a checkpoint re-bakes: a digest and a
   * skill catalog baseline that are stale against what a fresh resolution
   * yields, a bound Workspace whose root the chat has already been told, a
   * creation time far in the past, and sharing consent.
   */
  async function seedEpoch() {
    const seeded = await seedSwitch({
      switchMarker: false,
      sourceEffort: 'high',
      targetEffort: 'low',
    });
    const workspaceRoot = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'compaction-epoch-')),
    );
    doomedDirectories.push(workspaceRoot);
    await tenantDb.runAs(userId, (tx) =>
      tx.execute(dsql`
        UPDATE chats
        SET created_at = ${CHAT_CREATED_AT.toISOString()}::timestamptz,
            workspace_root = ${workspaceRoot},
            workspace_executor_id = ${EPOCH_EXECUTOR_ID},
            workspace_told = ${workspaceRoot}
        WHERE id = ${seeded.chat.id} AND owner_user_id = ${userId}
      `),
    );
    const freshSource = await tenantDb.runAs(userId, async (tx) => {
      const chats = new ChatsRepository(tx);
      await chats.setRecencyDigestIfAbsent(
        seeded.chat.id,
        userId,
        STALE_DIGEST,
        STALE_DIGEST_TOLD,
      );
      await chats.setSkillCatalogBaseline({
        chatId: seeded.chat.id,
        ownerUserId: userId,
        baseline: STALE_SKILLS,
        rebakedFrom: null,
      });
      const source = await chats.create({
        ownerUserId: userId,
        title: 'Fresh source',
      });
      doomedChats.push(source.id);
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
    return { ...seeded, freshSource, workspaceRoot };
  }

  type RunServiceOptions = {
    config?: {
      tools?: Partial<typeof BUILT_IN_DEFAULTS.tools>;
      skills?: Partial<typeof BUILT_IN_DEFAULTS.skills>;
      skillCatalog?: SkillCatalogPort;
    };
    models?: ModelSelectionValidator;
    recencyDigest?: RecencyDigestResolver;
  };

  function runService(
    compaction: CompactionService,
    options: RunServiceOptions = {},
  ) {
    const {
      config: {
        tools: toolConfig,
        skills: skillConfig,
        skillCatalog = noopSkillCatalog(),
      } = {},
    } = options;
    return new RunExecutionService(
      tenantDb,
      compaction,
      { maybeGenerateTitle: async () => {} },
      {
        config: {
          ...BUILT_IN_DEFAULTS,
          tools: {
            ...BUILT_IN_DEFAULTS.tools,
            allowed: ['search_conversations'],
            ...toolConfig,
          },
          skills: { ...BUILT_IN_DEFAULTS.skills, ...skillConfig },
        },
      },
      new SearchIndexService(tenantDb),
      noopReindexDispatch(),
      knowledgeResolver,
      skillCatalog,
      noopEmbedDispatch(),
      noopQueryEmbedder(),
      compileTestPermissionPolicy(),
      options.models ?? executionModels,
      new SystemPromptsService(),
      { resolvePromptUser: () => Promise.resolve(undefined) },
      knowledgeCandidates,
      { snapshotCandidates: () => [] },
      new MemoryService(tenantDb),
      options.recencyDigest ?? new RecencyDigestService(tenantDb),
      undefined,
    );
  }

  function epochService(compaction: CompactionService) {
    return runService(compaction, {
      config: {
        tools: {
          allowed: ['search_conversations', 'enter_workspace'],
          nativeExecutorId: EPOCH_EXECUTOR_ID,
        },
        skills: {
          directories: ['/opt/skills'],
        },
        skillCatalog: LIVE_CATALOG,
      },
      models: epochModels,
    });
  }

  /** One user turn and the queued Run that answers it. */
  type Turn = {
    chatId: string;
    runId: string;
    user: Message;
    parts: Array<MessagePart>;
  };

  function turnOf(seeded: SeededSwitch): Turn {
    return {
      chatId: seeded.chat.id,
      runId: seeded.targetRun.id,
      user: seeded.targetUser,
      parts: seeded.targetUserParts,
    };
  }

  function requestFor(
    turn: Turn,
    client: ModelClient,
    abortSignal?: AbortSignal,
  ): ExecuteRunInput {
    return {
      runId: turn.runId,
      chatId: turn.chatId,
      userId,
      userMessage: { id: turn.user.id, seq: turn.user.seq, parts: turn.parts },
      client,
      ...(abortSignal !== undefined && { abortSignal }),
    };
  }

  /** Appends a user turn and its queued Run to an existing chat. */
  async function addTurn(chatId: string, text: string): Promise<Turn> {
    return tenantDb.runAs(userId, async (tx) => {
      const parts: Array<MessagePart> = [{ type: 'text', text }];
      const user = await new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        senderUserId: userId,
        parts,
      });
      const run = await new RunsRepository(tx).create({
        chatId,
        messageId: user.id,
        userId,
        modelId: TARGET_MODEL,
      });
      return { chatId, runId: run.id, user, parts };
    });
  }

  const latestCheckpoint = async (chatId: string) => {
    const rows = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    return rows
      .filter((row) => row.role === 'checkpoint')
      .sort((a, b) => b.seq - a.seq)[0];
  };

  /** Everything a turn's attempts leave behind, read at one point in time. */
  const readTurnState = (turn: Turn) =>
    tenantDb.runAs(userId, async (tx: Db) => ({
      run: await new RunsRepository(tx).findById(turn.runId, userId),
      chat: await new ChatsRepository(tx).findById(turn.chatId, userId),
      checkpoints: (
        await new MessagesRepository(tx).findByChatId(turn.chatId, userId)
      ).filter((row) => row.role === 'checkpoint'),
      receipts: await new SystemPromptReceiptsRepository(tx).findByOwnedRun(
        turn.runId,
        userId,
      ),
      events: await new RunEventsRepository(tx).listByRunId(turn.runId, userId),
    }));

  describe('threshold trigger', () => {
    it('summarizes with the attempt model, its pre-re-bake prompt, schema-only declarations and effort, then sends and binds the re-baked prompt', async () => {
      const seeded = await seedEpoch();
      const turn = turnOf(seeded);
      const calls: Array<ModelStreamInput> = [];
      const createSourceClient = vi.fn<ModelClientFactory['createClient']>(
        () => {
          throw new Error('a threshold trigger must not resolve another model');
        },
      );

      const result = await epochService(
        createCompactionService({ createClient: createSourceClient }),
      ).executeRun(
        requestFor(
          turn,
          attemptClient({
            calls,
            summary: { response: SUMMARY },
            compactionThresholdTokens: 1,
          }),
        ),
      );
      await result.consumeStream?.();

      // The same request shape the full-current request would carry for this
      // prefix: the attempt's own model, the system prompt its FIRST pass
      // rendered against the epoch that is about to be replaced, the schema-only
      // declarations of that pass, its effort, and the trailing instruction.
      expect(createSourceClient).not.toHaveBeenCalled();
      const summaryRequest = sole(calls.filter(isSummaryRequest));
      const targetRequest = sole(
        calls.filter((call) => !isSummaryRequest(call)),
      );
      const staleSystem = renderEpochPrompt({
        instant: CHAT_CREATED_AT,
        chats: STALE_DIGEST,
        skills: STALE_SKILLS,
      });
      expect(staleSystem).toContain('[Stale source]');
      expect(staleSystem).toContain('[stale-skill]');
      expect(summaryRequest.system).toBe(staleSystem);
      expect(summaryRequest.toolChoice).toBe('none');
      expect(summaryRequest.effort).toBe('low');
      expect(summaryRequest.chat).toStrictEqual({
        id: seeded.chat.id,
        lane: 'main',
      });
      expect(summaryRequest.messages.at(-1)).toEqual({
        role: 'user',
        content: COMPACTION_INSTRUCTION,
      });
      expect(
        summaryRequest.messages.slice(0, -1).map((message) => ({
          role: message.role,
          text: contentText(message.content),
        })),
      ).toEqual([
        { role: 'user', text: OLD_REQUEST },
        { role: 'assistant', text: OLD_ANSWER },
      ]);
      const declared = Object.keys(summaryRequest.tools ?? {}).sort();
      expect(declared).toContain('search_conversations');
      expect(declared).toEqual(Object.keys(targetRequest.tools ?? {}).sort());
      for (const tool of Object.values(summaryRequest.tools ?? {})) {
        expect(tool.execute).toBeUndefined();
      }

      // The row, and the epoch state it re-based, are what the Run then sent.
      const state = await readTurnState(turn);
      const checkpoint = sole(state.checkpoints);
      expect(checkpointSummary(checkpoint)).toBe(SUMMARY);
      expect(checkpoint).toMatchObject({
        absorbedThroughSeq: seeded.targetUser.seq - 1,
        usage: { effort: 'low' },
      });
      const freshSystem = renderEpochPrompt({
        instant: checkpoint.createdAt,
        chats: state.chat?.recencyDigestBaseline ?? null,
        skills: LIVE_SKILLS,
      });
      expect(freshSystem).toContain('[Fresh source]');
      expect(freshSystem).toContain('[live-skill]');
      expect(freshSystem).not.toContain('[Stale source]');
      expect(freshSystem).not.toContain('[stale-skill]');
      expect(targetRequest.system).toBe(freshSystem);
      expect(targetRequest.effort).toBe('low');
      expect(state.chat?.recencyDigestBaseline?.recent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: 'Fresh source',
            excerpt: 'fresh opening',
          }),
        ]),
      );

      // Exactly one receipt, bound to the prompt that was actually sent.
      expect(sole(state.receipts).systemPrompt).toBe(targetRequest.system);
      expect(
        state.receipts.map((receipt) => receipt.systemPrompt),
      ).not.toContain(staleSystem);

      // The Workspace snapshot and the digest supersession ride the same
      // request: the checkpoint reset what the chat had been told.
      const railText = contentText(
        targetRequest.messages.at(-1)?.content ?? '',
      );
      expect(railText).toContain(`\`${seeded.workspaceRoot}\``);
      expect(railText).toContain('The chat list was refreshed.');
      expect(railText).toContain('CURRENT TRIGGER');
      expect(state.run?.status).toBe('completed');
      expect(state.run?.contextItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            producer: 'workspace',
            form: 'snapshot',
            text: expect.stringContaining(seeded.workspaceRoot),
          }),
          expect.objectContaining({
            producer: 'recency-digest',
            form: 'snapshot',
          }),
        ]),
      );
      // The catalog told state restarted with the baseline, so no notice rides.
      expect(state.run?.contextItems).not.toContainEqual(
        expect.objectContaining({ producer: 'skill-catalog' }),
      );
      expect(state.chat).toMatchObject({
        recencyDigestRebakedFrom: checkpoint.id,
        skillCatalogRebakedFrom: checkpoint.id,
        workspaceToldFrom: checkpoint.id,
        workspaceTold: seeded.workspaceRoot,
        skillCatalogBaseline: LIVE_SKILLS,
        skillCatalogTold: ['live-skill'],
      });
    });

    it('keeps the checkpoint and its re-baked epoch when the attempt dies, and the next attempt reuses them', async () => {
      const seeded = await seedEpoch();
      const turn = turnOf(seeded);
      const service = epochService(createCompactionService(unexercisedModels));
      const firstCalls: Array<ModelStreamInput> = [];

      // The first attempt publishes, then its model never answers: the worker
      // is gone and the Run stays claimed for the next delivery.
      await service.executeRun(
        requestFor(
          turn,
          attemptClient({
            calls: firstCalls,
            summary: { response: SUMMARY },
            answer: null,
            compactionThresholdTokens: 1,
          }),
        ),
      );

      const published = await readTurnState(turn);
      const checkpoint = sole(published.checkpoints);
      expect(published.run?.status).toBe('running_model');
      expect(checkpointSummary(checkpoint)).toBe(SUMMARY);
      expect(checkpoint).toMatchObject({
        absorbedThroughSeq: seeded.targetUser.seq - 1,
      });
      expect(published.chat).toMatchObject({
        recencyDigestRebakedFrom: checkpoint.id,
        recencyDigestTold: [
          {
            chatId: seeded.freshSource.id,
            pinned: false,
            title: 'Fresh source',
          },
        ],
        skillCatalogRebakedFrom: checkpoint.id,
        skillCatalogBaseline: LIVE_SKILLS,
        workspaceToldFrom: checkpoint.id,
        workspaceTold: null,
      });
      expect(published.chat?.recencyDigestBaseline?.recent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Fresh source' }),
        ]),
      );
      const firstRequest = sole(
        firstCalls.filter((call) => !isSummaryRequest(call)),
      );
      expect(sole(published.receipts).systemPrompt).toBe(firstRequest.system);

      // The retry: nothing lies between the boundary and the trigger, so it
      // pays no second summary and re-resolves nothing.
      const secondCalls: Array<ModelStreamInput> = [];
      const retried = await service.executeRun(
        requestFor(
          turn,
          attemptClient({
            calls: secondCalls,
            summary: { response: 'MUST NOT BE REQUESTED' },
            compactionThresholdTokens: 1,
          }),
        ),
      );
      await retried.consumeStream?.();

      expect(secondCalls.filter(isSummaryRequest)).toHaveLength(0);
      const secondRequest = sole(secondCalls);
      expect(secondRequest.system).toBe(firstRequest.system);
      expect(contentText(secondRequest.messages[0].content)).toContain(SUMMARY);
      expect(
        contentText(secondRequest.messages.at(-1)?.content ?? ''),
      ).toContain(`\`${seeded.workspaceRoot}\``);
      const after = await readTurnState(turn);
      expect(after.run?.status).toBe('completed');
      expect(sole(after.checkpoints).id).toBe(checkpoint.id);
      expect(after.chat?.recencyDigestBaseline).toEqual(
        published.chat?.recencyDigestBaseline,
      );
      expect(after.chat).toMatchObject({
        recencyDigestRebakedFrom: checkpoint.id,
        skillCatalogRebakedFrom: checkpoint.id,
        workspaceToldFrom: checkpoint.id,
        workspaceTold: seeded.workspaceRoot,
      });
      // One receipt per attempt, each the prompt that attempt sent.
      expect(after.receipts).toHaveLength(2);
      expect(
        new Set(after.receipts.map(({ attemptId }) => attemptId)).size,
      ).toBe(2);
      expect(after.receipts.map(({ systemPrompt }) => systemPrompt)).toEqual([
        firstRequest.system,
        firstRequest.system,
      ]);
    });

    it('does not start a second epoch for the Run after the one that published', async () => {
      const seeded = await seedEpoch();
      const publishing = turnOf(seeded);
      const service = epochService(createCompactionService(unexercisedModels));
      const publishingCalls: Array<ModelStreamInput> = [];

      const first = await service.executeRun(
        requestFor(
          publishing,
          attemptClient({
            calls: publishingCalls,
            summary: { response: SUMMARY },
            compactionThresholdTokens: 1,
          }),
        ),
      );
      await first.consumeStream?.();
      const published = await readTurnState(publishing);
      expect(published.run?.contextItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ producer: 'workspace', form: 'snapshot' }),
          expect.objectContaining({
            producer: 'recency-digest',
            form: 'snapshot',
          }),
        ]),
      );

      // Under the default threshold this turn needs no checkpoint of its own.
      const next = await addTurn(seeded.chat.id, 'NEXT TURN');
      const nextCalls: Array<ModelStreamInput> = [];
      const second = await service.executeRun(
        requestFor(next, attemptClient({ calls: nextCalls })),
      );
      await second.consumeStream?.();

      const settled = await readTurnState(next);
      expect(settled.run?.status).toBe('completed');
      expect(nextCalls.filter(isSummaryRequest)).toHaveLength(0);
      expect(settled.checkpoints).toHaveLength(1);
      // Neither the Workspace snapshot nor the digest supersession re-announce
      // themselves: the checkpoint's boundary sits below the publishing turn,
      // so each appears once, replayed from the publishing turn's own items.
      expect(settled.run?.contextItems).toContainEqual(
        expect.objectContaining({ producer: 'temporal' }),
      );
      for (const producer of ['workspace', 'recency-digest']) {
        expect(
          settled.run?.contextItems?.filter(
            (item) => item.producer === producer,
          ),
        ).toHaveLength(1);
      }
      const nextRequest = sole(nextCalls);
      const publishingRequest = sole(
        publishingCalls.filter((call) => !isSummaryRequest(call)),
      );
      expect(nextRequest.system).toBe(publishingRequest.system);
      expect(contentText(nextRequest.messages[0].content)).toContain(SUMMARY);
      expect(contentText(nextRequest.messages.at(-1)?.content ?? '')).toContain(
        'NEXT TURN',
      );
    });

    // The exclusion rides the trailing instruction, so the digest block is
    // replayed verbatim in the system prompt; the instruction and the packaged
    // template are authored in different files, and nothing else asserts the
    // delimiter one names is the delimiter the other emits. If they drift,
    // another owner's chat titles and opening excerpts get summarized into a
    // checkpoint that is replayed as history indefinitely — which neither
    // deleting that chat nor disabling the setting can reach.
    it('keeps the packaged prompt digest out of the persisted checkpoint', async () => {
      const seeded = await seedSwitch({ switchMarker: false });
      const digest: RecencyDigestBaseline = {
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
      };
      await tenantDb.runAs(userId, (tx) =>
        new ChatsRepository(tx).setRecencyDigestIfAbsent(
          seeded.chat.id,
          userId,
          digest,
          [],
        ),
      );
      const packagedTemplate = createModelPromptLoader({
        configPath: path.resolve(__dirname, '../../llame.config.jsonc'),
      }).resolve({ id: TARGET_MODEL, name: 'Test Model' }).systemPromptTemplate;
      const packagedEntry: SystemModelCatalogEntry = {
        ...executionModels.validateModelSelection(TARGET_MODEL),
        name: 'Test Model',
        systemPromptTemplate: packagedTemplate,
      };
      const packagedPrompt = new SystemPromptsService().render({
        model: packagedEntry,
        anchor: formatTemporalAnchor(
          seeded.chat.createdAt,
          resolveInstanceTimezone(),
        ),
        chats: digest,
        admittedToolIds: [],
      });
      // Guard the guard: if the block stopped rendering, every assertion below
      // would pass vacuously.
      expect(packagedPrompt).toContain('<user_chat_history>');
      expect(packagedPrompt).toContain('SECRET-PINNED-OPENING');
      const calls: Array<ModelStreamInput> = [];

      const result = await runService(
        createCompactionService(unexercisedModels),
        {
          models: {
            validateModelSelection: () => packagedEntry,
            resolveEffortSelection: () => undefined,
          },
        },
      ).executeRun(
        requestFor(
          turnOf(seeded),
          attemptClient({ calls, compactionThresholdTokens: 1 }),
        ),
      );
      await result.consumeStream?.();

      const summaryRequest = sole(calls.filter(isSummaryRequest));
      // Replayed verbatim — the exclusion rides the trailing instruction rather
      // than editing the bound prompt, which would cold-start the prefix cache
      // for the whole absorbed conversation.
      expect(summaryRequest.system).toBe(packagedPrompt);

      // The load-bearing assertion: the fence the TEMPLATE emits is character-
      // for-character the one the INSTRUCTION names. The tag name is extracted
      // from the rendered prompt with a generic pattern (not hardcoded as
      // `user_chat_history`) so a rename on the template side is actually
      // detected here rather than silently matched against itself; `user` is
      // undefined above, so `<user_personalization>` cannot also match and mask
      // a mismatch.
      const fence = /<([a-z][a-z0-9_]*)>/u.exec(packagedPrompt)?.[1];
      expect(fence).toBeDefined();
      expect(COMPACTION_INSTRUCTION).toContain(`<${fence!}>`);
      expect(TRANSITION_COMPACTION_INSTRUCTION).toContain(`<${fence!}>`);
      expect(summaryRequest.messages.at(-1)?.content).toBe(
        COMPACTION_INSTRUCTION,
      );

      // Nothing digest-shaped reaches the compactable history either: the
      // digest lives in the system prompt, so a message carrying it would mean
      // it had leaked onto the rail where the summarizer reads uninstructed.
      expect(summaryRequest.messages.slice(0, -1)).not.toContainEqual(
        expect.objectContaining({
          content: expect.stringContaining('SECRET-PINNED-OPENING'),
        }),
      );
      // Deliberately NOT asserted: that the persisted summary omits the
      // excerpts. The fake client returns a canned summary, so such an
      // assertion would pass no matter what the instruction said. Whether a
      // real model honours the exclusion is compliance, which the capability
      // spec already states is advisory rather than structurally enforced —
      // only the delimiter's integrity is guaranteed, and that is checked above.
    });

    it('sends no effort on the summary request when the Run carried none', async () => {
      const seeded = await seedSwitch({ switchMarker: false });
      const calls: Array<ModelStreamInput> = [];

      const result = await runService(
        createCompactionService(unexercisedModels),
      ).executeRun(
        requestFor(
          turnOf(seeded),
          attemptClient({ calls, compactionThresholdTokens: 1 }),
        ),
      );
      await result.consumeStream?.();

      expect(sole(calls.filter(isSummaryRequest)).effort).toBeUndefined();
      expect(
        (await latestCheckpoint(seeded.chat.id))?.usage,
      ).not.toHaveProperty('effort');
    });

    it.each([
      {
        name: 'answers with a tool call despite toolChoice none',
        summary: {
          toolCalls: [
            { toolName: 'search_conversations', input: { query: 'x' } },
          ],
        },
      },
      { name: 'comes back empty', summary: { response: '' } },
      {
        name: 'fails at the provider',
        summary: { error: new Error('provider unavailable') },
      },
    ])(
      'proceeds on the full request without a checkpoint when the summary $name',
      async ({ summary }) => {
        const seeded = await seedSwitch({ switchMarker: false });
        const calls: Array<ModelStreamInput> = [];

        const result = await runService(
          createCompactionService(unexercisedModels),
        ).executeRun(
          requestFor(
            turnOf(seeded),
            attemptClient({ calls, summary, compactionThresholdTokens: 1 }),
          ),
        );
        await result.consumeStream?.();

        // The summary tool declarations were schema-only: no executor ran.
        const summaryRequest = sole(calls.filter(isSummaryRequest));
        for (const tool of Object.values(summaryRequest.tools ?? {})) {
          expect(tool.execute).toBeUndefined();
        }
        const targetRequest = sole(
          calls.filter((call) => !isSummaryRequest(call)),
        );
        expect(contentText(targetRequest.messages[0].content)).toBe(
          OLD_REQUEST,
        );
        const state = await readTurnState(turnOf(seeded));
        expect(state.checkpoints).toHaveLength(0);
        expect(state.run?.status).toBe('completed');
        expect(
          state.events.filter((event) => event.eventType.startsWith('tool.')),
        ).toEqual([]);
        // Nothing published, so the first pass's prompt is the attempt's own.
        expect(sole(state.receipts).systemPrompt).toBe(targetRequest.system);
      },
    );

    it.each([
      {
        name: 'sharing was disabled before the checkpoint',
        sharing: false,
        recencyDigest: undefined,
      },
      {
        name: 'digest resolution fails during the checkpoint',
        sharing: true,
        recencyDigest: {
          resolveCandidate: () =>
            Promise.reject(new Error('candidate unavailable')),
        },
      },
    ])(
      'publishes the checkpoint but keeps the bound digest when $name',
      async ({ sharing, recencyDigest }) => {
        const seeded = await seedSwitch({ switchMarker: false });
        const told = [
          {
            chatId: '00000000-0000-4000-8000-0000000000a2',
            pinned: false,
            title: 'Previously shared source',
          },
        ];
        await tenantDb.runAs(userId, (tx) =>
          new ChatsRepository(tx).setRecencyDigestIfAbsent(
            seeded.chat.id,
            userId,
            STALE_DIGEST,
            told,
          ),
        );
        await new MemoryService(tenantDb).updateForOwner(userId, {
          shareRecentChats: sharing,
        });

        // The attempt's model never answers, so only the publication ran.
        await runService(createCompactionService(unexercisedModels), {
          ...(recencyDigest !== undefined && { recencyDigest }),
        }).executeRun(
          requestFor(
            turnOf(seeded),
            attemptClient({
              calls: [],
              answer: null,
              compactionThresholdTokens: 1,
            }),
          ),
        );

        const state = await readTurnState(turnOf(seeded));
        expect(state.checkpoints).toHaveLength(1);
        expect(state.chat?.recencyDigestBaseline).toEqual(STALE_DIGEST);
        expect(state.chat?.recencyDigestTold).toEqual(told);
        expect(state.chat?.recencyDigestRebakedFrom).toBeNull();
      },
    );
  });

  describe('window trigger', () => {
    // A9: the window variant reuses the SOURCE model and the SOURCE receipt's
    // system prompt, so the source run's effort is the one whose cache is at
    // stake. The incoming turn's effort is not part of that prefix, and was
    // validated against a different model's declared levels entirely.
    it('sends the source run effort on the window summary, not the incoming turn effort', async () => {
      const seeded = await seedSwitch({
        sourceEffort: 'high',
        targetEffort: 'low',
      });
      const sourceCalls: Array<ModelStreamInput> = [];
      const compaction = createCompactionService({
        createClient: vi.fn(() =>
          compactionClient({
            model: SOURCE_MODEL,
            calls: sourceCalls,
            response: SUMMARY,
            contextWindowTokens: 10_000,
          }),
        ),
      });
      const targetCalls: Array<ModelStreamInput> = [];

      const result = await runService(compaction).executeRun(
        requestFor(turnOf(seeded), windowTarget(targetCalls)),
      );
      await result.consumeStream?.();

      expect(sole(sourceCalls).effort).toBe('high');
      expect(sole(targetCalls).effort).toBe('low');
      // The recorded effort must match what was actually sent, or the receipt
      // would attribute this call's cost to the wrong level.
      expect((await latestCheckpoint(seeded.chat.id))?.usage).toMatchObject({
        effort: 'high',
      });
    });

    it('uses the source run model and receipt for one window checkpoint before invoking the smaller target', async () => {
      const seeded = await seedSwitch({ toolObservation: true });
      const sourceCalls: Array<ModelStreamInput> = [];
      const targetCalls: Array<ModelStreamInput> = [];
      const sourceClient = compactionClient({
        model: SOURCE_MODEL,
        calls: sourceCalls,
        response: SUMMARY,
        contextWindowTokens: 10_000,
      });
      const createSourceClient = vi.fn(() => sourceClient);
      const compaction = createCompactionService({
        createClient: createSourceClient,
      });
      // Synthetic bound, sized to fit exactly one checkpoint plus the switch
      // item and the live worker-admitted search declaration. The budget is
      // deliberately below the un-compacted history, so this still exercises
      // one checkpoint.
      const result = await runService(compaction).executeRun(
        requestFor(turnOf(seeded), windowTarget(targetCalls)),
      );
      await result.consumeStream?.();

      const sourceRequest = sole(sourceCalls);
      expect(createSourceClient).toHaveBeenCalledWith(SOURCE_MODEL);
      expect(sourceRequest.system).toBe(seeded.sourceReceipt?.systemPrompt);
      expect(sourceRequest.toolChoice).toBe('none');
      expect(sourceRequest.tools).toBeUndefined();
      expect(sourceRequest.messages.at(-1)).toEqual({
        role: 'user',
        content: TRANSITION_COMPACTION_INSTRUCTION,
      });

      // D7: a run whose source receipt carried personalization still compacts,
      // the owner text is replayed VERBATIM (the prefix must stay byte-identical
      // or the whole call goes cold), and the exclusion rides in the trailing
      // instruction — the only part outside the cached prefix.
      expect(sourceRequest.system).toContain('<user_personalization>');
      expect(sourceRequest.system).toContain('Preferred name: Ana');
      expect(sourceRequest.system).toContain('<user_chat_history>');
      expect(sourceRequest.system).toContain('private excerpt');
      expect(TRANSITION_COMPACTION_INSTRUCTION).toContain(
        '<user_personalization>',
      );
      expect(TRANSITION_COMPACTION_INSTRUCTION).toMatch(
        /do not carry any content out of/i,
      );
      expect(TRANSITION_COMPACTION_INSTRUCTION).toContain(
        '<user_chat_history>',
      );
      expect(JSON.stringify(sourceRequest.messages)).not.toContain(
        'CURRENT TRIGGER',
      );
      expect(JSON.stringify(sourceRequest.messages)).toContain(
        'PRIVATE TRANSITION INPUT',
      );

      const targetRequest = sole(targetCalls);
      // D5: compaction shares the turn's identity — literally the value the
      // target turn's own request carried, not a re-derived lookalike.
      expect(sourceRequest.chat).toStrictEqual(targetRequest.chat);
      expect(targetRequest.chat).toStrictEqual({
        id: seeded.chat.id,
        lane: 'main',
      });
      expect(targetRequest.system).toBe('Test prompt: default');
      expect(Object.keys(targetRequest.tools ?? {})).toEqual([
        'search_conversations',
      ]);
      expect(targetRequest.messages[0]).toEqual({
        role: 'user',
        content: [
          {
            type: 'text',
            text: expect.stringMatching(
              /^<system-reminder producer="compaction" form="checkpoint">/u,
            ),
          },
        ],
      });
      expect(contentText(targetRequest.messages[0].content)).toContain(SUMMARY);
      const targetTrigger = targetRequest.messages.at(-1);
      expect(targetTrigger?.role).toBe('user');
      const targetTriggerText = contentText(targetTrigger?.content ?? '');
      const stagedSwitch = seeded.switchPart;
      if (stagedSwitch === undefined) {
        throw new Error('Expected this turn to stage a model-change item');
      }
      expect(targetTriggerText).toContain(stagedSwitch.data.text);
      expect(targetTriggerText).toContain('Message received:');
      // The run-derived item names the model the catalog resolves for the
      // target client (`executionModels` echoes the requested id through).
      expect(targetTriggerText).toContain(
        'You are now target-model (internal ID `target-model`, provider ID `target-model`).',
      );
      expect(targetTriggerText).toMatch(/CURRENT TRIGGER$/u);
      expect(JSON.stringify(targetRequest)).not.toContain(
        seeded.sourceReceipt?.systemPrompt ?? '',
      );
      expect(JSON.stringify(targetRequest.messages)).not.toContain(
        'transition-tool-call',
      );
      expect(JSON.stringify(targetRequest.messages)).not.toContain(
        'Outcome: timeout',
      );
      expect(JSON.stringify(targetRequest.messages)).not.toContain(
        'PRIVATE TRANSITION INPUT',
      );
      expect(JSON.stringify(targetRequest.messages)).not.toContain(
        'PRIVATE TRANSITION ERROR',
      );

      const state = await readTurnState(turnOf(seeded));
      const checkpoint = sole(state.checkpoints);
      expect(checkpoint.role).toBe('checkpoint');
      expect(checkpoint.absorbedThroughSeq).toBe(seeded.targetUser.seq - 1);
      expect(checkpointSummary(checkpoint)).toBe(SUMMARY);
      // The one receipt is the prompt the target was actually sent, never the
      // source run's.
      expect(sole(state.receipts).systemPrompt).toBe(targetRequest.system);
    });

    it('takes the window variant for any request that does not fit, with no model switch staged', async () => {
      const seeded = await seedSwitch({
        sourceModel: TARGET_MODEL,
        switchMarker: false,
      });
      const sourceCalls: Array<ModelStreamInput> = [];
      const createSourceClient = vi.fn(() =>
        compactionClient({
          model: TARGET_MODEL,
          calls: sourceCalls,
          response: SUMMARY,
          contextWindowTokens: 10_000,
        }),
      );
      const targetCalls: Array<ModelStreamInput> = [];

      const result = await runService(
        createCompactionService({ createClient: createSourceClient }),
      ).executeRun(requestFor(turnOf(seeded), windowTarget(targetCalls)));
      await result.consumeStream?.();

      expect(createSourceClient).toHaveBeenCalledWith(TARGET_MODEL);
      expect(sole(sourceCalls).messages.at(-1)).toEqual({
        role: 'user',
        content: TRANSITION_COMPACTION_INSTRUCTION,
      });
      expect(sole(sourceCalls).system).toBe(seeded.sourceReceipt?.systemPrompt);
      const targetRequest = sole(targetCalls);
      expect(contentText(targetRequest.messages[0].content)).toContain(SUMMARY);
      expect(
        contentText(targetRequest.messages.at(-1)?.content ?? ''),
      ).not.toContain('You are now');
      expect(checkpointSummary(await latestCheckpoint(seeded.chat.id))).toBe(
        SUMMARY,
      );
    });

    it('settles a cancel requested before the claim without spending on a summary', async () => {
      const seeded = await seedSwitch();
      const sourceCalls: Array<ModelStreamInput> = [];
      const targetCalls: Array<ModelStreamInput> = [];
      const compaction = createCompactionService({
        createClient: vi.fn(() =>
          compactionClient({ model: SOURCE_MODEL, calls: sourceCalls }),
        ),
      });

      await tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).requestCancel(seeded.targetRun.id, userId),
      );

      await expect(
        runService(compaction).executeRun(
          requestFor(turnOf(seeded), windowTarget(targetCalls)),
        ),
      ).rejects.toBeInstanceOf(RunNotRunnableError);

      expect(sourceCalls).toHaveLength(0);
      expect(targetCalls).toHaveLength(0);
      const settled = await readTurnState(turnOf(seeded));
      expect(settled.run?.status).toBe('cancelled');
      expect(settled.events.map((event) => event.eventType)).toEqual([
        'run.cancelled',
      ]);
    });

    it('aborts an in-flight window summary and settles the claimed run as expired', async () => {
      const seeded = await seedSwitch();
      const sourceCalls: Array<ModelStreamInput> = [];
      const targetCalls: Array<ModelStreamInput> = [];
      let sourceStarted!: () => void;
      const sourceStartedPromise = new Promise<void>((resolve) => {
        sourceStarted = resolve;
      });
      const sourceClient = compactionClient({
        model: SOURCE_MODEL,
        calls: sourceCalls,
        response: new Promise<string>(() => undefined),
        onStart: sourceStarted,
      });
      const compaction = createCompactionService({
        createClient: vi.fn(() => sourceClient),
      });
      const abort = new AbortController();

      const execution = runService(compaction).executeRun(
        requestFor(turnOf(seeded), windowTarget(targetCalls), abort.signal),
      );
      await sourceStartedPromise;
      abort.abort(RUN_TIMEOUT_ABORT_REASON);

      await expect(execution).rejects.toBeInstanceOf(RunNotRunnableError);
      expect(sourceCalls[0]?.abortSignal).toBe(abort.signal);
      expect(targetCalls).toHaveLength(0);
      const settled = await readTurnState(turnOf(seeded));
      expect(settled.run?.status).toBe('expired');
      expect(settled.events.map((event) => event.eventType)).toEqual([
        'run.started',
        'run.expired',
      ]);
      expect(settled.checkpoints).toHaveLength(0);
    });

    it('uses the checkpoint a concurrent attempt published at the same cutoff instead of its own summary', async () => {
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
        model: SOURCE_MODEL,
        calls: [],
        response: summaryPromise,
        onStart: sourceStarted,
      });
      const compaction = createCompactionService({
        createClient: vi.fn(() => sourceClient),
      });

      const execution = runService(compaction).executeRun(
        requestFor(turnOf(seeded), windowTarget(targetCalls)),
      );
      await sourceStartedPromise;
      const concurrentSummary = '## Objective\nUse the newer checkpoint.';
      await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).createCheckpoint({
          chatId: seeded.chat.id,
          absorbedThroughSeq: seeded.targetUser.seq - 1,
          part: createCompactionCheckpointPart(concurrentSummary),
          usage: null,
        }),
      );
      resolveSummary('## Objective\nDiscard this stale summary.');

      const result = await execution;
      await result.consumeStream?.();

      const targetRequest = sole(targetCalls);
      expect(targetRequest.messages[0].role).toBe('user');
      expect(contentText(targetRequest.messages[0].content)).toContain(
        concurrentSummary,
      );
      const settled = await readTurnState(turnOf(seeded));
      expect(settled.run?.status).toBe('completed');
      expect(checkpointSummary(sole(settled.checkpoints))).toBe(
        concurrentSummary,
      );
    });

    it('publishes its own cutoff when a concurrent checkpoint covers less of the history', async () => {
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
        model: SOURCE_MODEL,
        calls: [],
        response: summaryPromise,
        onStart: sourceStarted,
      });
      const compaction = createCompactionService({
        createClient: vi.fn(() => sourceClient),
      });

      const execution = runService(compaction).executeRun(
        requestFor(turnOf(seeded), windowTarget(targetCalls)),
      );
      await sourceStartedPromise;
      await tenantDb.runAs(userId, (tx) =>
        new MessagesRepository(tx).createCheckpoint({
          chatId: seeded.chat.id,
          // Absorbs the old request but not the assistant turn that answered it.
          absorbedThroughSeq: seeded.targetUser.seq - 2,
          part: createCompactionCheckpointPart(
            '## Objective\nOrdinary checkpoint is not far enough.',
          ),
          usage: null,
        }),
      );
      const windowSummary = '## Objective\nUse the complete window checkpoint.';
      resolveSummary(windowSummary);

      const result = await execution;
      await result.consumeStream?.();

      const targetRequest = sole(targetCalls);
      expect(targetRequest.messages[0].role).toBe('user');
      expect(contentText(targetRequest.messages[0].content)).toContain(
        windowSummary,
      );
      const checkpoint = await latestCheckpoint(seeded.chat.id);
      expect(checkpoint?.absorbedThroughSeq).toBe(seeded.targetUser.seq - 1);
      expect(checkpoint && checkpointSummary(checkpoint)).toBe(windowSummary);
    });

    it.each([
      {
        name: 'the source model is unavailable',
        sourceRun: true,
        published: false,
        models: {
          createClient: vi.fn(() => {
            throw new Error('gone');
          }),
        },
      },
      {
        name: 'the source summary fails',
        sourceRun: true,
        published: false,
        models: {
          createClient: vi.fn(() =>
            compactionClient({
              model: SOURCE_MODEL,
              calls: [],
              error: new Error('compaction failed'),
            }),
          ),
        },
      },
      {
        name: 'the source summary is empty',
        sourceRun: true,
        published: false,
        models: {
          createClient: vi.fn(() =>
            compactionClient({ model: SOURCE_MODEL, calls: [], response: '' }),
          ),
        },
      },
      {
        name: 'the source answers with a tool call despite toolChoice none',
        sourceRun: true,
        published: false,
        models: {
          createClient: vi.fn(() =>
            compactionClient({
              model: SOURCE_MODEL,
              calls: [],
              toolCalls: [{ toolName: 'search_conversations', input: {} }],
            }),
          ),
        },
      },
      {
        name: 'the source model cannot fit the history either',
        sourceRun: true,
        published: false,
        models: {
          createClient: vi.fn(() =>
            compactionClient({
              model: SOURCE_MODEL,
              calls: [],
              contextWindowTokens: 100,
            }),
          ),
        },
      },
      {
        name: 'no previous completed run can summarize the history',
        sourceRun: false,
        published: false,
        models: { createClient: vi.fn() },
      },
      {
        name: 'one summary still exceeds the target window',
        sourceRun: true,
        published: true,
        models: {
          createClient: vi.fn(() =>
            compactionClient({
              model: SOURCE_MODEL,
              calls: [],
              response: `## Objective\n${'z'.repeat(4000)}`,
            }),
          ),
        },
      },
    ])(
      'fails context_incompatible before target inference when $name',
      async ({ sourceRun, published, models }) => {
        const seeded = await seedSwitch({ sourceRun, switchMarker: false });
        const targetCalls: Array<ModelStreamInput> = [];

        await expect(
          runService(createCompactionService(models)).executeRun(
            requestFor(turnOf(seeded), windowTarget(targetCalls)),
          ),
        ).rejects.toMatchObject({ code: 'context_incompatible' });

        expect(targetCalls).toHaveLength(0);
        const failed = await readTurnState(turnOf(seeded));
        expect(failed.run?.status).toBe('failed');
        expect(failed.run?.error).toMatchObject({
          code: 'context_incompatible',
        });
        expect(
          failed.events.filter((event) => event.eventType === 'run.failed'),
        ).toHaveLength(1);
        // A rejected summary persists nothing; a summary that was accepted
        // stays published even though the request still does not fit.
        expect(failed.checkpoints.length > 0).toBe(published);
      },
    );
  });
});
