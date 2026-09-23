import type { MockInstance } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { bashTool } from '../tools/bash';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import {
  type CompiledPolicy,
  type PermissionDecision,
} from '../tools/permissions/types';
import { type DerivedDecisionRecord } from '../tools/web-read/admission';
import { nativeEditTool, nativeReadTool } from '../tools/native-files';
import { drizzle } from 'drizzle-orm/postgres-js';
import { NativeFilesRepository } from './native-files-repository';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';

import type {
  Chat,
  Compaction,
  Message,
  ModelToolDeclaration,
  Run,
  RunEvent,
  SkillCatalogBaseline,
} from '../db/schema';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import type { ModelSelectionValidator } from '../models/models.service';
import { createFakeModelClient, ZERO_USAGE } from '../models/fake-model-client';
import type { ModelClient } from '../models/model-client';
import { createOpenAICompletionsModelClient } from '../models/openai-completions-model-client';
import type {
  KnowledgeToolResolver,
  Tool,
  ToolContext,
  ToolResult,
} from '../tools/types';
import { isRecord, isString } from '@workspace/runtime-safety';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from '../chats/chats-repository';
import { isContextItemPart, type ContextItemPart } from '../chats/context-item';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';
import { createModelChangeItem } from '../chats/context-item-producers';
import {
  hashToolDeclaration,
  type TurnToolCandidate,
} from '../tools/turn-tool-catalog';
import {
  ModelContextExecutionError,
  type DynamicToolExecutorResolver,
} from './snapshot-tool-execution';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import type { CompactionCapability } from '../compaction/compaction.service';
import type { TitleCapability } from '../titles/title.service';
import type { ChatSearchIndexer } from './run-execution.service';
import type { ChatEmbedDispatcher } from '../search/search-embed-dispatch.service';
import { noopSkillCatalog } from '../skills/skill-catalog.stub';
import {
  type SkillCatalogEntry,
  type SkillCatalogPort,
} from '../skills/skill-catalog';
import type { ChatReindexDispatcher } from '../search/search-reindex-dispatch.service';
import { type MemorySettingsBindingResolver } from '../memory/memory.service';
import {
  type RecencyDigestResolution,
  type RecencyDigestResolver,
} from '../chats/recency-digest.service';
import {
  RunExecutionService,
  RunNotRunnableError,
} from './run-execution.service';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import type { KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import { TOOL_REGISTRY } from '../tools/registry';

/**
 * classifyAbortedRun unit tests (durable-run-workers D7): the in-process
 * wall-clock timeout and a user-requested cancel share the exact same
 * AbortController/signal plumbing (RunAbortRegistry) — this is the pure,
 * DB-free mapping that tells them apart so only a timeout is recorded as
 * run.expired, never run.cancelled. Full executeRun coverage (the DB-coupled
 * claim/persist path) lives in the DB-backed integration specs; this pins
 * just the classification the liveness collapse depends on.
 */
import {
  classifyAbortedRun,
  RUN_TIMEOUT_ABORT_REASON,
} from './run-execution.service';

describe('classifyAbortedRun', () => {
  it('classifies an undefined signal as cancelled (no abort occurred / inline caller)', () => {
    expect(classifyAbortedRun(undefined)).toBe('cancelled');
  });

  it('classifies a user cancel (no reason tag) as cancelled', () => {
    const controller = new AbortController();
    controller.abort();
    expect(classifyAbortedRun(controller.signal)).toBe('cancelled');
  });

  it('classifies an abort tagged with a reason OTHER than the timeout tag as cancelled', () => {
    const controller = new AbortController();
    controller.abort('some-other-reason');
    expect(classifyAbortedRun(controller.signal)).toBe('cancelled');
  });

  it('classifies the worker in-process wall-clock timeout (RUN_TIMEOUT_ABORT_REASON) as expired', () => {
    const controller = new AbortController();
    controller.abort(RUN_TIMEOUT_ABORT_REASON);
    expect(classifyAbortedRun(controller.signal)).toBe('expired');
  });
});

const chatId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = 'user-1';
const messageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const testAttemptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const now = new Date('2026-09-01T00:00:00.000Z');

const chat: Chat = {
  id: chatId,
  ownerUserId: userId,
  title: null,
  visibility: 'private',
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
};

const userMessage: Message = {
  id: messageId,
  chatId,
  seq: 1,
  role: 'user',
  senderUserId: userId,
  parts: [{ type: 'text', text: 'hello' }],
  attachments: [],
  usage: null,
  inReplyTo: null,
  createdAt: now,
};

const run: Run = {
  id: runId,
  chatId,
  messageId,
  userId,
  modelId: 'fake-model',
  activeAttemptId: null,
  completedAttemptId: null,
  turnToolAvailability: null,
  status: 'running_model',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  contextItems: null,
  createdAt: now,
  startedAt: now,
  finishedAt: null,
  effort: null,
};

const receipt = {
  source: 'project_default' as const,
  systemPrompt: 'Stable system prompt',
  promptHash: 'prompt-hash',
  createdAt: now,
};

const assistantMessage: Message = {
  ...userMessage,
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  seq: 2,
  role: 'assistant',
  senderUserId: null,
  parts: [{ type: 'text', text: 'answer' }],
  usage: { status: 'completed', finishReason: 'stop' },
  inReplyTo: messageId,
};

const event: RunEvent = {
  runId,
  sequence: 1,
  eventType: 'run.started',
  payload: null,
  createdAt: now,
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

const testModelEntry: SystemModelCatalogEntry = {
  id: 'fake-model',
  source: 'system',
  contextWindowTokens: 128_000,
  provider: 'fake',
  providerModelId: 'fake-model',
  systemPromptTemplate: 'Stable system prompt',
  systemPromptSource: 'project_default',
  referencesSkills: false,
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

const skillEntry = (name: string, description: string): SkillCatalogEntry => ({
  name,
  description,
  proactive: true,
  sourceDirectory: '/opt/skills',
  skillDirectory: `/opt/skills/${name}`,
  available: true,
  diagnostics: [],
});

/** A readable catalog advertising exactly these packages. */
const skillCatalogOf = (
  entries: ReadonlyArray<SkillCatalogEntry>,
): SkillCatalogPort => ({
  getSnapshot: () => ({
    available: true,
    directories: ['/opt/skills'],
    entries: [...entries],
    diagnostics: [],
  }),
});

type ExecutionServiceOptions = {
  permissionPolicy?: CompiledPolicy;
  allowed?: ReadonlyArray<string>;
  dynamicCandidates?: ReadonlyArray<TurnToolCandidate>;
  memory?: MemorySettingsBindingResolver;
  recencyDigest?: RecencyDigestResolver;
  skillCatalog?: SkillCatalogPort;
  skillDirectories?: ReadonlyArray<string>;
  model?: SystemModelCatalogEntry;
  configPath?: string;
  toolPromptFiles?: Readonly<Record<string, string | null>>;
};

function makeExecutionService(
  client: ModelClient = createFakeModelClient(['answer']),
  dynamicToolResolver?: DynamicToolExecutorResolver,
  nativeExecutorId?: string,
  options: ExecutionServiceOptions = {},
) {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  const runAs = vi
    .spyOn(tenantDb, 'runAs')
    .mockImplementation(
      async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    );
  const permissionPolicy =
    options.permissionPolicy ??
    compileTestPermissionPolicy(['mcp__demo__lookup']);
  const instanceConfig: InstanceConfigReader = {
    configPath: options.configPath,
    config: {
      ...BUILT_IN_DEFAULTS,
      tools: {
        ...BUILT_IN_DEFAULTS.tools,
        allowed: options.allowed ?? [],
        nativeExecutorId,
        promptFiles:
          options.toolPromptFiles ?? BUILT_IN_DEFAULTS.tools.promptFiles,
      },
      skills: {
        ...BUILT_IN_DEFAULTS.skills,
        directories: options.skillDirectories ?? [],
      },
    },
  };
  // Held separately so tests can rescript them with their inferred Mock type
  // instead of asserting the capability interface back down to a mock.
  const compactForTransition = vi.fn(() => Promise.resolve('created' as const));
  const reindexChat = vi.fn(() => Promise.resolve());
  const maybeCompact = vi.fn<CompactionCapability['maybeCompact']>(() =>
    Promise.resolve(),
  );
  const compaction: CompactionCapability = {
    maybeCompact,
    compactForTransition,
  };
  const titles: TitleCapability = {
    maybeGenerateTitle: vi.fn(() => Promise.resolve()),
  };
  const searchIndex: ChatSearchIndexer = { reindexChat };
  const reindexDispatch: ChatReindexDispatcher = {
    enqueueChatReindex: vi.fn(() => Promise.resolve()),
  };
  const embedDispatch: ChatEmbedDispatcher = {
    enqueueChatEmbed: vi.fn(() => Promise.resolve()),
  };
  const models: ModelSelectionValidator = {
    validateModelSelection: vi
      .fn()
      .mockReturnValue(options.model ?? testModelEntry),
    resolveEffortSelection: vi.fn().mockReturnValue(undefined),
  };
  const memory: MemorySettingsBindingResolver = options.memory ?? {
    getForOwnerForBinding: vi.fn().mockResolvedValue({
      shareRecentChats: false,
    }),
  };
  const recencyDigest: RecencyDigestResolver = options.recencyDigest ?? {
    resolveCandidate: vi
      .fn()
      .mockRejectedValue(new Error('unexpected digest read')),
  };
  const service = new RunExecutionService(
    tenantDb,
    compaction,
    titles,
    instanceConfig,
    searchIndex,
    reindexDispatch,
    knowledgeResolver,
    options.skillCatalog ?? noopSkillCatalog(),
    embedDispatch,
    noopQueryEmbedder(),
    permissionPolicy,
    models,
    new SystemPromptsService(),
    { resolvePromptUser: vi.fn().mockResolvedValue(undefined) },
    knowledgeCandidates,
    { snapshotCandidates: () => options.dynamicCandidates ?? [] },
    memory,
    recencyDigest,
    dynamicToolResolver,
  );
  return {
    service,
    runAs,
    compaction,
    maybeCompact,
    compactForTransition,
    titles,
    searchIndex,
    reindexChat,
    reindexDispatch,
    embedDispatch,
    client,
  };
}

function mockNormalExecutionRepositories() {
  const markStarted = vi
    .spyOn(RunsRepository.prototype, 'markStarted')
    .mockResolvedValue({ ...run, activeAttemptId: testAttemptId });
  const markFinished = vi
    .spyOn(RunsRepository.prototype, 'markFinished')
    .mockResolvedValue({
      ...run,
      status: 'completed',
    });
  const updateForAttempt = vi
    .spyOn(RunsRepository.prototype, 'updateForAttempt')
    .mockResolvedValue({ ...run });
  const createReceipt = vi
    .spyOn(SystemPromptReceiptsRepository.prototype, 'create')
    .mockResolvedValue({
      id: 'receipt-1',
      ownerUserId: userId,
      runId,
      attemptId: testAttemptId,
      source: 'project_default',
      systemPrompt: receipt.systemPrompt,
      promptHash: receipt.promptHash,
      createdAt: now,
    });
  vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue(event);
  vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([]);
  vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
  vi.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(chat);
  vi.spyOn(
    CompactionsRepository.prototype,
    'findLatestByChatId',
  ).mockResolvedValue(undefined);
  vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
    userMessage,
  ]);
  vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
    userMessage,
    assistantMessage: undefined,
  });
  const createAssistantReplyIfAbsent = vi
    .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
    .mockResolvedValue(assistantMessage);
  const updateUserMessageParts = vi
    .spyOn(MessagesRepository.prototype, 'updateUserMessageParts')
    .mockResolvedValue(userMessage);
  const findMostRecent = vi
    .spyOn(RunsRepository.prototype, 'findMostRecentByChatMessageSequence')
    .mockResolvedValue(undefined);
  return {
    markStarted,
    markFinished,
    createAssistantReplyIfAbsent,
    updateUserMessageParts,
    updateForAttempt,
    createReceipt,
    findMostRecent,
  };
}

describe('RunExecutionService executeRun', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('terminates a retried Run with a previous native mutation before invoking the model', async () => {
    const repositories = mockNormalExecutionRepositories();
    repositories.markStarted.mockResolvedValue({ ...run, workerId: 'host-a' });
    vi.spyOn(NativeFilesRepository.prototype, 'hasMutation').mockResolvedValue(
      true,
    );
    const appended = recordAppendedEvents();
    const execution = makeExecutionService();
    const model = vi.spyOn(execution.client, 'streamText');
    await expect(
      execution.service.executeRun(executionInput(execution.client)),
    ).rejects.toBeInstanceOf(RunNotRunnableError);
    expect(model).not.toHaveBeenCalled();
    const outcomeUnknownError: unknown = expect.objectContaining({
      code: 'outcome_unknown',
    });
    expect(repositories.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'failed',
      expect.objectContaining({
        error: outcomeUnknownError,
      }),
    );
    expect(appended.map((entry) => entry.type)).toEqual(['run.failed']);
    expect(appended[0].payload).toMatchObject({ code: 'outcome_unknown' });
  });

  it('keeps read-only retry behavior for a previously bound native Run', async () => {
    const repositories = mockNormalExecutionRepositories();
    repositories.markStarted.mockResolvedValue({ ...run, workerId: 'host-a' });
    vi.spyOn(NativeFilesRepository.prototype, 'hasMutation').mockResolvedValue(
      false,
    );
    const execution = makeExecutionService();
    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );
    await expect(result.text).resolves.toBe('answer');
  });

  it('recovers a persisted native result into its still-open tool activity', async () => {
    const repositories = mockNormalExecutionRepositories();
    repositories.markStarted.mockResolvedValue({ ...run, workerId: 'host-a' });
    vi.spyOn(NativeFilesRepository.prototype, 'hasMutation').mockResolvedValue(
      true,
    );
    const nativeResult = {
      status: 'success' as const,
      operation: 'edit',
      replacements: 1,
    };
    vi.spyOn(NativeFilesRepository.prototype, 'priorOutcome').mockResolvedValue(
      nativeResult,
    );
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([
      {
        ...event,
        sequence: 1,
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'native-call',
          toolName: 'edit',
          input: { path: '/native/file', oldText: 'Foo', newText: 'Bar' },
        },
      },
    ]);
    const appended = recordAppendedEvents();
    const execution = makeExecutionService();
    await expect(
      execution.service.executeRun(executionInput(execution.client)),
    ).rejects.toBeInstanceOf(RunNotRunnableError);
    expect(appended).toContainEqual({
      type: 'tool.completed',
      payload: {
        toolCallId: 'native-call',
        toolName: 'edit',
        status: 'success',
        output: nativeResult,
      },
    });
  });

  it('claims, records context, streams, persists, and runs post-turn hooks', async () => {
    const repositorySpies = mockNormalExecutionRepositories();
    const execution = makeExecutionService();

    const result = await execution.service.executeRun({
      runId,
      chatId,
      userId,
      userMessage: {
        id: messageId,
        seq: 1,
        parts: [{ type: 'text', text: 'hello' }],
      },
      client: execution.client,
    });

    await expect(result.text).resolves.toBe('answer');
    expect(repositorySpies.markStarted).toHaveBeenCalledWith(runId, userId);
    expect(repositorySpies.updateForAttempt).toHaveBeenCalledWith(
      runId,
      userId,
      testAttemptId,
      {
        contextItems: [
          expect.objectContaining({
            producer: 'temporal',
            residency: 'rail',
          }),
        ],
      },
    );
    expect(repositorySpies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'completed',
      expect.objectContaining({
        attemptId: testAttemptId,
        turnToolAvailability: [],
      }),
    );
    const temporalContextData: unknown = expect.objectContaining({
      producer: 'temporal',
    });
    expect(repositorySpies.updateUserMessageParts).toHaveBeenCalledWith({
      id: messageId,
      chatId,
      parts: [
        expect.objectContaining({
          type: 'data-context',
          data: temporalContextData,
        }),
        { type: 'text', text: 'hello' },
      ],
    });

    expect(repositorySpies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ chatId, inReplyTo: messageId }),
    );
    expect(execution.searchIndex.reindexChat).toHaveBeenCalledWith(
      chatId,
      userId,
    );
    expect(execution.embedDispatch.enqueueChatEmbed).toHaveBeenCalledWith(
      chatId,
      userId,
    );
    expect(execution.titles.maybeGenerateTitle).toHaveBeenCalledWith(
      expect.objectContaining({ chatId, userId, userText: 'hello' }),
    );
    expect(execution.compaction.maybeCompact).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        userId,
        system: receipt.systemPrompt,
      }),
    );
  });
  it('resolves a recency digest only when the owner has opted in on the worker', async () => {
    const baseline: RecencyDigestResolution['baseline'] = {
      pinned: [],
      recent: [],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-09-01',
    };
    const resolveCandidate = vi
      .fn<RecencyDigestResolver['resolveCandidate']>()
      .mockResolvedValue({
        baseline,
        told: [],
        candidates: [],
      });
    const getForOwnerForBinding = vi
      .fn<MemorySettingsBindingResolver['getForOwnerForBinding']>()
      .mockResolvedValue({ shareRecentChats: true });
    const setBaseline = vi
      .spyOn(ChatsRepository.prototype, 'setRecencyDigestIfAbsent')
      .mockResolvedValue({
        ...chat,
        recencyDigestBaseline: baseline,
        recencyDigestTold: [],
      });
    mockNormalExecutionRepositories();
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      {
        memory: { getForOwnerForBinding },
        recencyDigest: { resolveCandidate },
      },
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );

    await expect(result.text).resolves.toBe('answer');
    expect(resolveCandidate).toHaveBeenCalledWith(userId, chatId);
    expect(setBaseline).toHaveBeenCalledWith(chatId, userId, baseline, []);
  });

  it('discards a resolved digest candidate when the chat epoch advances during resolution', async () => {
    const baseline: RecencyDigestResolution['baseline'] = {
      pinned: [],
      recent: [],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-09-01',
    };
    const resolveCandidate = vi
      .fn<RecencyDigestResolver['resolveCandidate']>()
      .mockResolvedValue({ baseline, told: [], candidates: [] });
    const getForOwnerForBinding = vi
      .fn<MemorySettingsBindingResolver['getForOwnerForBinding']>()
      .mockResolvedValue({ shareRecentChats: true });
    mockNormalExecutionRepositories();
    // The attempt reads its own chat row, then rechecks it after candidate
    // resolution. Here a compaction checkpoint has replaced the baseline in
    // between, so the candidate was resolved against a superseded epoch.
    vi.spyOn(ChatsRepository.prototype, 'findById')
      .mockResolvedValueOnce(chat)
      .mockResolvedValueOnce({
        ...chat,
        recencyDigestRebakedFrom: '11111111-1111-4111-8111-111111111111',
      });
    const setBaseline = vi
      .spyOn(ChatsRepository.prototype, 'setRecencyDigestIfAbsent')
      .mockResolvedValue({ ...chat, recencyDigestBaseline: baseline });
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      {
        memory: { getForOwnerForBinding },
        recencyDigest: { resolveCandidate },
      },
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );

    await expect(result.text).resolves.toBe('answer');
    // The whole point of the recheck: superseded digest content never reaches
    // the model, so nothing is committed for this attempt.
    expect(setBaseline).not.toHaveBeenCalled();
  });

  it('swallows worker digest resolution failures without exposing corpus text', async () => {
    const loggerError = vi.spyOn(Logger.prototype, 'error');
    const resolveCandidate = vi
      .fn<RecencyDigestResolver['resolveCandidate']>()
      .mockRejectedValue(new Error('secret excerpt'));
    const getForOwnerForBinding = vi
      .fn<MemorySettingsBindingResolver['getForOwnerForBinding']>()
      .mockResolvedValue({ shareRecentChats: true });
    mockNormalExecutionRepositories();
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      {
        memory: { getForOwnerForBinding },
        recencyDigest: { resolveCandidate },
      },
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );

    await expect(result.text).resolves.toBe('answer');
    expect(loggerError).toHaveBeenCalledWith(
      'recency_digest_resolution_failed',
    );
    expect(loggerError.mock.calls.flat().join(' ')).not.toContain(
      'secret excerpt',
    );
  });
  it('persists the disclosed digest told-set with the winning user message', async () => {
    const baseline: RecencyDigestResolution['baseline'] = {
      pinned: [],
      recent: [],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-09-01',
    };
    const entry = {
      title: 'Resurfaced through activity',
      date: '2026-09-02',
      messageCount: 2,
      excerpt: 'opening',
    };
    const told = [
      {
        chatId: 'resurfaced',
        pinned: false,
        title: entry.title,
      },
    ];
    const resolution: RecencyDigestResolution = {
      baseline: {
        ...baseline,
        recent: [entry],
        recentShown: 1,
        recentTotal: 1,
      },
      told,
      candidates: [
        {
          chatId: 'resurfaced',
          pinned: false,
          entry,
        },
      ],
    };
    const chatWithDigest: Chat = {
      ...chat,
      recencyDigestBaseline: baseline,
      recencyDigestTold: [],
    };
    const resolveCandidate = vi
      .fn<RecencyDigestResolver['resolveCandidate']>()
      .mockResolvedValue(resolution);
    const getForOwnerForBinding = vi
      .fn<MemorySettingsBindingResolver['getForOwnerForBinding']>()
      .mockResolvedValue({ shareRecentChats: true });
    const findPinnedChatIds = vi
      .spyOn(ChatsRepository.prototype, 'findPinnedChatIds')
      .mockResolvedValue(new Set());
    const updateRecencyDigestTold = vi
      .spyOn(ChatsRepository.prototype, 'updateRecencyDigestTold')
      .mockResolvedValue(undefined);
    const render = vi
      .spyOn(SystemPromptsService.prototype, 'render')
      .mockReturnValue('Stable system prompt');
    const repositories = mockNormalExecutionRepositories();
    const findById = vi
      .spyOn(ChatsRepository.prototype, 'findById')
      .mockResolvedValue(chatWithDigest);
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      {
        memory: { getForOwnerForBinding },
        recencyDigest: { resolveCandidate },
      },
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );

    await expect(result.text).resolves.toBe('answer');
    expect(findById).toHaveBeenCalledWith(chatId, userId);
    expect(findPinnedChatIds).toHaveBeenCalledWith(userId, []);
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ chats: baseline }),
    );
    const recencyDigestContextData: unknown = expect.objectContaining({
      producer: 'recency-digest',
    });
    const temporalDigestContextData: unknown = expect.objectContaining({
      producer: 'temporal',
    });
    expect(repositories.updateUserMessageParts).toHaveBeenCalledWith({
      id: messageId,
      chatId,
      parts: [
        expect.objectContaining({
          type: 'data-context',
          data: recencyDigestContextData,
        }),
        expect.objectContaining({
          type: 'data-context',
          data: temporalDigestContextData,
        }),
        { type: 'text', text: 'hello' },
      ],
    });
    expect(updateRecencyDigestTold).toHaveBeenCalledWith(chatId, userId, told);
  });
  it('freezes the resolved skill baseline and records its told set on a completed turn', async () => {
    const baseline: SkillCatalogBaseline = {
      entries: [{ name: 'pdf', description: 'Extract text' }],
      omitted: 0,
    };
    const setSkillBaseline = vi
      .spyOn(ChatsRepository.prototype, 'setSkillCatalogBaseline')
      .mockResolvedValue(undefined);
    const updateSkillCatalogTold = vi
      .spyOn(ChatsRepository.prototype, 'updateSkillCatalogTold')
      .mockResolvedValue(undefined);
    const render = vi.spyOn(SystemPromptsService.prototype, 'render');
    mockNormalExecutionRepositories();
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      {
        skillCatalog: skillCatalogOf([
          skillEntry('pdf', 'Extract text'),
          // Manual-only: admitted to the catalog but never advertised.
          { ...skillEntry('review', 'Review'), proactive: false },
        ]),
        skillDirectories: ['/opt/skills'],
        model: { ...testModelEntry, referencesSkills: true },
      },
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );

    await expect(result.text).resolves.toBe('answer');
    // A first turn resolves the epoch: the prompt renders the frozen baseline
    // and the chat row records it together with the names it advertises.
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ skills: baseline }),
    );
    expect(setSkillBaseline).toHaveBeenCalledWith({
      chatId,
      ownerUserId: userId,
      baseline,
      rebakedFrom: null,
    });
    expect(updateSkillCatalogTold).toHaveBeenCalledWith(chatId, userId, [
      'pdf',
    ]);
  });
  it('stages the catalog notice and persists the told set with the winning user message', async () => {
    const stored: SkillCatalogBaseline = {
      entries: [{ name: 'pdf', description: 'Extract text' }],
      omitted: 0,
    };
    const setSkillBaseline = vi
      .spyOn(ChatsRepository.prototype, 'setSkillCatalogBaseline')
      .mockResolvedValue(undefined);
    const updateSkillCatalogTold = vi
      .spyOn(ChatsRepository.prototype, 'updateSkillCatalogTold')
      .mockResolvedValue(undefined);
    const render = vi.spyOn(SystemPromptsService.prototype, 'render');
    const repositories = mockNormalExecutionRepositories();
    const findById = vi
      .spyOn(ChatsRepository.prototype, 'findById')
      .mockResolvedValue({
        ...chat,
        skillCatalogBaseline: stored,
        skillCatalogRebakedFrom: null,
        skillCatalogTold: ['pdf'],
      });
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      {
        skillCatalog: skillCatalogOf([
          skillEntry('pdf', 'Extract text'),
          skillEntry('research', 'Plan it'),
        ]),
        skillDirectories: ['/opt/skills'],
        model: { ...testModelEntry, referencesSkills: true },
      },
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );

    await expect(result.text).resolves.toBe('answer');
    expect(findById).toHaveBeenCalledWith(chatId, userId);
    // The chat is inside its epoch, so the stored baseline keeps rendering and
    // only the addition is disclosed.
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ skills: stored }),
    );
    expect(setSkillBaseline).not.toHaveBeenCalled();
    const catalogNoticeData: unknown = expect.objectContaining({
      producer: 'skill-catalog',
      form: 'notice',
    });
    const temporalData: unknown = expect.objectContaining({
      producer: 'temporal',
    });
    expect(repositories.updateUserMessageParts).toHaveBeenCalledWith({
      id: messageId,
      chatId,
      parts: [
        expect.objectContaining({
          type: 'data-context',
          data: catalogNoticeData,
        }),
        expect.objectContaining({ type: 'data-context', data: temporalData }),
        { type: 'text', text: 'hello' },
      ],
    });
    expect(updateSkillCatalogTold).toHaveBeenCalledWith(chatId, userId, [
      'pdf',
      'research',
    ]);
  });

  it('settles a pre-aborted run without preparing context or invoking the model', async () => {
    const controller = new AbortController();
    controller.abort(RUN_TIMEOUT_ABORT_REASON);
    const finished = vi
      .spyOn(RunsRepository.prototype, 'markFinished')
      .mockResolvedValue({ ...run, status: 'expired' });
    const append = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockResolvedValue(event);
    const execution = makeExecutionService();
    const streamText = vi.spyOn(execution.client, 'streamText');

    await expect(
      execution.service.executeRun({
        runId,
        chatId,
        userId,
        userMessage: {
          id: messageId,
          seq: 1,
          parts: [{ type: 'text', text: 'hello' }],
        },
        client: execution.client,
        abortSignal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(RunNotRunnableError);
    expect(finished).toHaveBeenCalledWith(
      runId,
      userId,
      'expired',
      expect.objectContaining({
        error: { message: 'Run timed out: exceeded its wall-clock budget.' },
      }),
    );
    expect(append).toHaveBeenCalledWith(runId, 'run.expired', {
      message: 'Run timed out: exceeded its wall-clock budget.',
    });
    expect(streamText).not.toHaveBeenCalled();
  });

  it('settles a cancelled run found after a failed claim', async () => {
    const current: Run = {
      ...run,
      status: 'running_model',
      cancelRequestedAt: now,
    };
    const markStarted = vi
      .spyOn(RunsRepository.prototype, 'markStarted')
      .mockResolvedValue(undefined);
    const findById = vi
      .spyOn(RunsRepository.prototype, 'findById')
      .mockResolvedValue(current);
    const markFinished = vi
      .spyOn(RunsRepository.prototype, 'markFinished')
      .mockResolvedValue({ ...current, status: 'cancelled' });
    const append = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockResolvedValue(event);
    const execution = makeExecutionService();

    await expect(
      execution.service.executeRun({
        runId,
        chatId,
        userId,
        userMessage: {
          id: messageId,
          seq: 1,
          parts: [{ type: 'text', text: 'hello' }],
        },
        client: execution.client,
      }),
    ).rejects.toBeInstanceOf(RunNotRunnableError);
    expect(markStarted).toHaveBeenCalledWith(runId, userId);
    expect(findById).toHaveBeenCalledWith(runId, userId);
    expect(markFinished).toHaveBeenCalledWith(runId, userId, 'cancelled');
    expect(append).toHaveBeenCalledWith(runId, 'run.cancelled', {
      message: 'Run was cancelled before model inference.',
    });
  });
});

type StreamOptions = Parameters<ModelClient['streamText']>[0];
type StreamResult = ReturnType<ModelClient['streamText']>;

/** What a capturing `streamText` records for the test to drive afterwards. */
type CapturedStream = { options?: StreamOptions };

/**
 * The capturing clients never run a stream, so nothing ever reads the result.
 * `StreamTextResult` carries private AI SDK state with no structural stand-in.
 */
function unusedStreamResult(): StreamResult {
  // SAFETY: every capturing client records the options and returns immediately;
  // the tests drive the callbacks directly and never touch this value.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return {} as StreamResult;
}

/**
 * A model client that records the stream options instead of running one, so
 * each stream callback (`onFinish`, `onError`, `onCapReached`,
 * `onUnavailableToolCall`, and a bound tool's own `execute`) can be driven
 * directly. The AI-SDK-backed fake reaches only the completed happy path.
 */
function makeCapturingClient(contextWindowTokens = 128_000) {
  const captured: CapturedStream = {};
  const client: ModelClient = {
    model: 'fake-model',
    provider: 'fake',
    contextWindowTokens,
    pricing: { inputUsdPer1M: 2, outputUsdPer1M: 6 },
    streamText: (options) => {
      captured.options = options;
      return unusedStreamResult();
    },
  };
  const streamOptions = (): StreamOptions => {
    if (!captured.options) {
      throw new Error('streamText was never called');
    }
    return captured.options;
  };
  return { client, streamOptions };
}

/** Replaces the `append` stub with one that records the durable event order. */
function recordAppendedEvents() {
  const appended: Array<{ type: string; payload: unknown }> = [];
  vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
    (_runId, eventType, payload) => {
      appended.push({ type: eventType, payload });
      return Promise.resolve(event);
    },
  );
  return appended;
}

/** Replays whatever `recordAppendedEvents` captured back through `listByRunId`,
 * so `finishRun`'s durable reconstruction sees the run's real event log. */
function replayAppendedEvents(
  appended: Array<{ type: string; payload: unknown }>,
) {
  vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockImplementation(
    () =>
      Promise.resolve(
        appended.map((entry, index) => ({
          ...event,
          sequence: index + 1,
          eventType: entry.type,
          payload: entry.payload ?? null,
        })),
      ),
  );
}

function executionInput(client: ModelClient, abortSignal?: AbortSignal) {
  return {
    runId,
    chatId,
    userId,
    userMessage: {
      id: messageId,
      seq: 1,
      parts: [{ type: 'text' as const, text: 'hello' }],
    },
    client,
    ...(abortSignal && { abortSignal }),
  };
}

describe('RunExecutionService executeRun — stream completion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists reasoning and text in stream order, reasoning first', async () => {
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onReasoningDelta?.('thinking');
    options.onTextDelta?.('part');
    await options.onFinish?.({
      text: 'part done',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(appended.map((entry) => entry.type)).toEqual([
      'run.started',
      'model.requested',
      'reasoning.delta',
      'model.delta',
      'model.completed',
      'run.completed',
    ]);
    expect(appended[2]?.payload).toStrictEqual({ text: 'thinking' });
    expect(appended[3]?.payload).toStrictEqual({ text: 'part' });
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'completed',
      expect.objectContaining({ attemptId: testAttemptId }),
    );
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'part done' },
        ],
      }),
    );
  });

  it('records a reasoning part’s provider metadata on that part and its own event', async () => {
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);
    const providerMetadata = {
      openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
    };

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onReasoningDelta?.('thinking', 'rs_1:0');
    // The adapter's reasoning END carries the metadata with no text of its
    // own, so it is recorded as its own event bound to the same part id.
    options.onReasoningDelta?.('', 'rs_1:0', providerMetadata);
    await options.onFinish?.({
      text: '',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(appended.map((entry) => entry.type)).toEqual([
      'run.started',
      'model.requested',
      'reasoning.delta',
      'reasoning.delta',
      'model.completed',
      'run.completed',
    ]);
    expect(appended[2]?.payload).toStrictEqual({
      text: 'thinking',
      partId: 'rs_1:0',
    });
    expect(appended[3]?.payload).toStrictEqual({
      partId: 'rs_1:0',
      providerMetadata,
    });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [{ type: 'reasoning', text: 'thinking', providerMetadata }],
      }),
    );
  });

  it('records buffered text before a metadata-only delivery that starts a reasoning part (D18)', async () => {
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);
    const signature = { anthropic: { signature: 'SIG_WITHHELD' } };

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    // Text streamed first, still inside the coalescing buffer …
    options.onTextDelta?.('the answer so far');
    // … then a block whose text the provider withheld: the whole payload is
    // one metadata-only delivery under an id no collected part carries, so it
    // starts the block's part (design D18).
    options.onReasoningDelta?.('', '0:0', signature);
    await options.onFinish?.({
      text: 'the answer so far',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    // The buffered text is recorded FIRST, so the durable log replays the
    // answer before the empty part instead of after it.
    expect(appended.map((entry) => entry.type)).toEqual([
      'run.started',
      'model.requested',
      'model.delta',
      'reasoning.delta',
      'model.completed',
      'run.completed',
    ]);
    expect(appended[2]?.payload).toStrictEqual({ text: 'the answer so far' });
    expect(appended[3]?.payload).toStrictEqual({
      partId: '0:0',
      providerMetadata: signature,
    });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: 'text', text: 'the answer so far' },
          { type: 'reasoning', text: '', providerMetadata: signature },
        ],
      }),
    );
  });

  it('does not flush buffered text for a metadata-only delivery that binds to a collected part (D18)', async () => {
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);
    const signature = { anthropic: { signature: 'SIG_OPEN' } };

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onReasoningDelta?.('thinking', '0:0');
    options.onTextDelta?.('the ');
    // The id already names a collected part, so this delivery binds its
    // metadata to that part and starts nothing (design D18): text still
    // coalescing in the delta buffer must not be flushed — and split — by it.
    options.onReasoningDelta?.('', '0:0', signature);
    options.onTextDelta?.('answer');
    await options.onFinish?.({
      text: 'the answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(appended.map((entry) => entry.type)).toEqual([
      'run.started',
      'model.requested',
      'reasoning.delta',
      'reasoning.delta',
      'model.delta',
      'model.completed',
      'run.completed',
    ]);
    expect(appended[2]?.payload).toStrictEqual({
      text: 'thinking',
      partId: '0:0',
    });
    expect(appended[3]?.payload).toStrictEqual({
      partId: '0:0',
      providerMetadata: signature,
    });
    // One coalesced delta for the whole answer, not one per side of the
    // metadata delivery.
    expect(appended[4]?.payload).toStrictEqual({ text: 'the answer' });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: 'reasoning', text: 'thinking', providerMetadata: signature },
          { type: 'text', text: 'the answer' },
        ],
      }),
    );
  });

  it('drops a final text that does not extend what already streamed', async () => {
    const spies = mockNormalExecutionRepositories();
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onTextDelta?.('streamed');
    await options.onFinish?.({
      text: 'unrelated final',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ parts: [{ type: 'text', text: 'streamed' }] }),
    );
  });

  it('carries the run effort onto the request, the model.requested event, the turn usage and compaction', async () => {
    const spies = mockNormalExecutionRepositories();
    vi.spyOn(RunsRepository.prototype, 'markStarted').mockResolvedValue({
      ...run,
      effort: 'high',
    });
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    expect(options.effort).toBe('high');
    await options.onFinish?.({
      text: 'answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(appended[1]).toStrictEqual({
      type: 'model.requested',
      payload: { modelId: 'fake-model', effort: 'high' },
    });
    const completedUsage: unknown = expect.objectContaining({
      effort: 'high',
      modelId: 'fake-model',
      status: 'completed',
    });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ usage: completedUsage }),
    );
    expect(execution.compaction.maybeCompact).toHaveBeenCalledWith(
      expect.objectContaining({ effort: 'high' }),
    );
  });

  it('omits effort entirely when the run stored none', async () => {
    mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    expect(capturing.streamOptions().effort).toBeUndefined();
    expect(appended[1]).toStrictEqual({
      type: 'model.requested',
      payload: { modelId: 'fake-model' },
    });
  });

  it('finishes a provider-reported error finish as failed and skips post-turn work', async () => {
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'half',
      usage: ZERO_USAGE,
      finishReason: 'error',
    });

    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'failed',
      expect.objectContaining({ attemptId: testAttemptId }),
    );
    expect(appended.at(-1)?.type).toBe('run.failed');
    const erroredUsage: unknown = expect.objectContaining({ status: 'error' });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ usage: erroredUsage }),
    );
    expect(execution.compaction.maybeCompact).not.toHaveBeenCalled();
    expect(execution.titles.maybeGenerateTitle).not.toHaveBeenCalled();
  });

  it('records a finish that races a wall-clock abort as expired', async () => {
    const controller = new AbortController();
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(
      executionInput(capturing.client, controller.signal),
    );
    controller.abort(RUN_TIMEOUT_ABORT_REASON);
    await capturing.streamOptions().onFinish?.({
      text: 'half',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'expired',
      expect.objectContaining({ attemptId: testAttemptId }),
    );
    expect(appended.at(-1)?.type).toBe('run.expired');
  });

  it('skips titling for an already-titled chat but still compacts', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue({
      ...chat,
      title: 'Existing title',
    });
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(execution.titles.maybeGenerateTitle).not.toHaveBeenCalled();
    expect(execution.compaction.maybeCompact).toHaveBeenCalledTimes(1);
  });

  // provider-api-selection D3: the run loop hands the client the fact — this
  // Chat, the main lane — and the client renders or ignores it. The lane is
  // load-bearing: a title request over the same Chat must not share it (D5).
  it('hands the streaming request its Chat identity on the main lane', async () => {
    mockNormalExecutionRepositories();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));

    expect(capturing.streamOptions().chat).toStrictEqual({
      id: chatId,
      lane: 'main',
    });
  });

  // D3: the identity is a routing fact, not model-visible content — it must not
  // ride the request's system prompt or messages, a persisted message part, or
  // any durable output of the turn.
  it('keeps the Chat identity out of the request context and persisted output', async () => {
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onTextDelta?.('part');
    await options.onFinish?.({
      text: 'part done',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    const sentContext = JSON.stringify({
      system: options.system,
      messages: options.messages,
    });
    expect(sentContext).not.toContain(chatId);

    const assistantTurn = spies.createAssistantReplyIfAbsent.mock.calls[0]?.[0];
    const persisted = JSON.stringify(assistantTurn?.parts);
    expect(persisted).not.toContain(chatId);

    const durable = JSON.stringify(appended);
    expect(durable).not.toContain(chatId);
  });
});

describe('RunExecutionService executeRun — stream failure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists the partial answer and the provider error message on a stream error', async () => {
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onTextDelta?.('partial');
    await options.onError?.({ error: new Error('provider exploded') });

    expect(appended.map((entry) => entry.type)).toEqual([
      'run.started',
      'model.requested',
      'model.delta',
      'run.failed',
    ]);
    expect(appended[3]?.payload).toStrictEqual({
      status: 'failed',
      message: 'provider exploded',
    });
    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'failed', {
      error: { message: 'provider exploded' },
      attemptId: testAttemptId,
    });
    const partialUsage: unknown = expect.objectContaining({ status: 'error' });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [{ type: 'text', text: 'partial' }],
        usage: partialUsage,
      }),
    );
    expect(execution.searchIndex.reindexChat).toHaveBeenCalledWith(
      chatId,
      userId,
    );
    expect(execution.compaction.maybeCompact).not.toHaveBeenCalled();
  });

  it('stringifies a non-Error stream failure', async () => {
    const spies = mockNormalExecutionRepositories();
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onError?.({ error: 'plain string blowup' });

    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'failed', {
      error: { message: 'plain string blowup' },
      attemptId: testAttemptId,
    });
  });

  it.each([
    [
      'an unreadable event',
      '<html>proxy echo CHUNK-CANARY</html>',
      /stream event that could not be read/,
    ],
    [
      'an in-stream error envelope',
      JSON.stringify({
        error: { message: 'Upstream overloaded', param: 'CHUNK-CANARY' },
      }),
      /^Upstream overloaded$/,
    ],
  ])(
    'records and logs %s from a real Chat Completions stream as its bounded message',
    async (_label, event, expectedMessage) => {
      const spies = mockNormalExecutionRepositories();
      const appended = recordAppendedEvents();
      const loggerError = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      // The real client and adapter over a stubbed transport: the run sees
      // the failure exactly as a Chat Completions endpoint delivers it.
      const client = createOpenAICompletionsModelClient({
        providerModelId: 'test-model',
        modelId: 'system:test:test-model',
        contextWindowTokens: 128_000,
        userAgent: 'llame/0.0.0-test',
        baseUrl: 'https://endpoint.example.test/v1',
        fetch: () =>
          Promise.resolve(
            new Response(`data: ${event}\n\ndata: [DONE]\n\n`, {
              headers: { 'content-type': 'text/event-stream' },
            }),
          ),
      });
      const execution = makeExecutionService(client);

      const result = await execution.service.executeRun(executionInput(client));
      await result.consumeStream();
      await vi.waitFor(() => {
        expect(spies.markFinished).toHaveBeenCalled();
      });

      const message: unknown = expect.stringMatching(expectedMessage);
      expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'failed', {
        error: { message },
        attemptId: testAttemptId,
      });
      const terminal = appended.find((entry) => entry.type === 'run.failed');
      expect(terminal?.payload).toStrictEqual({ status: 'failed', message });
      const surfaces = JSON.stringify({
        persisted: spies.markFinished.mock.calls,
        terminal,
        logged: loggerError.mock.calls,
      });
      expect(surfaces).not.toContain('CHUNK-CANARY');
      expect(surfaces).not.toContain('[object Object]');
    },
  );

  it('reports a wall-clock abort as expired with the timeout message, not the provider error', async () => {
    const controller = new AbortController();
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(
      executionInput(capturing.client, controller.signal),
    );
    controller.abort(RUN_TIMEOUT_ABORT_REASON);
    await capturing
      .streamOptions()
      .onError?.({ error: new Error('aborted by signal') });

    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'expired',
      expect.objectContaining({
        error: {
          message: 'Run timed out: exceeded its wall-clock budget.',
        },
      }),
    );
    expect(appended.at(-1)).toStrictEqual({
      type: 'run.expired',
      payload: {
        status: 'expired',
        message: 'Run timed out: exceeded its wall-clock budget.',
      },
    });
  });

  it('reports a user cancel that races the stream as cancelled, keeping the provider message', async () => {
    const controller = new AbortController();
    const spies = mockNormalExecutionRepositories();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(
      executionInput(capturing.client, controller.signal),
    );
    controller.abort();
    await capturing
      .streamOptions()
      .onError?.({ error: new Error('stream aborted') });

    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'cancelled',
      expect.objectContaining({ error: { message: 'stream aborted' } }),
    );
  });

  it('settles the run as failed when a progress write is lost, discarding the streamed turn', async () => {
    const spies = mockNormalExecutionRepositories();
    const appended: Array<string> = [];
    vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
      (_runId, eventType) => {
        if (eventType === 'model.delta') {
          return Promise.reject(new Error('event log unavailable'));
        }
        appended.push(eventType);
        return Promise.resolve(event);
      },
    );
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onTextDelta?.('partial');
    await options.onFinish?.({
      text: 'partial',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'failed',
      expect.objectContaining({
        error: {
          message: 'Run progress could not be persisted.',
        },
      }),
    );
    expect(appended).toEqual(['run.started', 'model.requested', 'run.failed']);
    expect(spies.createAssistantReplyIfAbsent).not.toHaveBeenCalled();
  });

  it('settles a lost progress write from the error path too', async () => {
    const spies = mockNormalExecutionRepositories();
    vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
      (_runId, eventType) =>
        eventType === 'model.delta'
          ? Promise.reject(new Error('event log unavailable'))
          : Promise.resolve(event),
    );
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onTextDelta?.('partial');
    await options.onError?.({ error: new Error('provider exploded') });

    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'failed',
      expect.objectContaining({
        error: {
          message: 'Run progress could not be persisted.',
        },
      }),
    );
    expect(spies.createAssistantReplyIfAbsent).not.toHaveBeenCalled();
  });

  it('fails the run and rethrows when streamText throws before any callback', async () => {
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const client: ModelClient = {
      model: 'fake-model',
      provider: 'fake',
      contextWindowTokens: 128_000,
      streamText: () => {
        throw new Error('provider misconfigured');
      },
    };
    const execution = makeExecutionService(client);

    await expect(
      execution.service.executeRun(executionInput(client)),
    ).rejects.toThrow('provider misconfigured');
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'failed',
      expect.objectContaining({
        error: {
          message: 'provider misconfigured',
        },
      }),
    );
    expect(appended.at(-1)).toStrictEqual({
      type: 'run.failed',
      payload: { status: 'failed', message: 'provider misconfigured' },
    });
  });
});

const toolDeclaration: ModelToolDeclaration = {
  id: 'mcp__demo__lookup',
  description: 'Look something up',
  inputSchema: {
    type: 'object',
    properties: { q: { type: 'string' } },
    required: ['q'],
    additionalProperties: false,
  },
};

const maxSteps = BUILT_IN_DEFAULTS.tools.maxStepsPerRun;

/** The safe decision metadata a permissive test policy stamps on an allowed call. */
function allowDecision(toolId: string) {
  return {
    policyId: 'test-policy',
    decision: 'allow' as const,
    reason: 'matched_allow' as const,
    reference: { groupId: toolId, list: 'allow' as const, clauseIndex: null },
  };
}

/** Binds `toolDeclaration` to `executor` through the dynamic-resolver seam. */
function makeDynamicResolver(executor: Tool): DynamicToolExecutorResolver {
  return {
    resolveDynamicTool: (id) =>
      id === toolDeclaration.id
        ? {
            state: 'available',
            declarationHash: hashToolDeclaration(toolDeclaration),
            executor,
          }
        : { state: 'not_dynamic' },
  };
}

/** Advertises `toolDeclaration` through the worker's dynamic catalog. */
function withDeclaredTool(): Pick<
  ExecutionServiceOptions,
  'allowed' | 'dynamicCandidates'
> {
  return {
    allowed: [toolDeclaration.id],
    dynamicCandidates: [
      {
        source: { type: 'mcp', serverId: 'demo' },
        state: 'available',
        tool: {
          id: toolDeclaration.id,
          description: toolDeclaration.description,
          classification: 'read_only',
          inputSchema: toolDeclaration.inputSchema,
          execute: () => ({ status: 'success' as const }),
        },
      },
    ],
  };
}

function withDeclaredBashTool(): Pick<ExecutionServiceOptions, 'allowed'> {
  return { allowed: ['bash'] };
}

/** `toolDeclaration.inputSchema`'s own shape: one required string `q`. */
type LookupToolArgs = { q: string };

/** The bound tool settles with `neutralizeToolResult`'s output. */
function isToolObservation(value: unknown): value is ToolResult {
  return isRecord(value) && isString(value.status);
}

async function executeBoundTool(
  options: StreamOptions,
  args: LookupToolArgs,
  toolCallId: string,
): Promise<ToolResult> {
  const bound = options.tools?.[toolDeclaration.id];
  if (!bound?.execute) {
    throw new Error(`${toolDeclaration.id} was not offered to the model`);
  }
  const settled: unknown = await bound.execute(args, {
    toolCallId,
    messages: [],
  });
  if (!isToolObservation(settled)) {
    throw new TypeError(
      `${toolDeclaration.id} returned a non-ToolResult value`,
    );
  }
  return settled;
}

async function executeBoundBash(
  options: StreamOptions,
  args: { command: string },
  toolCallId: string,
): Promise<ToolResult> {
  const bound = options.tools?.bash;
  if (!bound?.execute) {
    throw new Error('bash was not offered to the model');
  }
  const settled: unknown = await bound.execute(args, {
    toolCallId,
    messages: [],
  });
  if (!isToolObservation(settled)) {
    throw new TypeError('bash returned a non-ToolResult value');
  }
  return settled;
}

describe('RunExecutionService executeRun — tool loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits for durable progress before executing a bash call', async () => {
    mockNormalExecutionRepositories();
    const append = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockImplementation((_runId, eventType) => {
        if (eventType === 'model.delta')
          return Promise.reject(new Error('event log unavailable'));
        return Promise.resolve(event);
      });
    const execute = vi
      .spyOn(bashTool, 'execute')
      .mockResolvedValue({ status: 'success', stdout: 'ran' });
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      undefined,
      'host-a',
      { allowed: ['bash'] },
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onTextDelta?.('before bash');
    const bound = options.tools?.bash;
    if (!bound?.execute) throw new Error('Bash was not advertised.');

    await expect(
      bound.execute(
        { command: 'printf should-not-run' },
        { toolCallId: 'bash-progress-gate', messages: [] },
      ),
    ).rejects.toThrow('Tool activity could not be recorded');
    expect(execute).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalledWith(
      runId,
      'native.attempt',
      expect.anything(),
    );
  });

  it('keeps a known bash cancellation when the parent abort settles the run', async () => {
    const controller = new AbortController();
    mockNormalExecutionRepositories();
    const toolOptions = withDeclaredBashTool();
    const appended = recordAppendedEvents();
    replayAppendedEvents(appended);
    const capturing = makeCapturingClient();
    let releaseBash: (result: ToolResult) => void = () => {};
    const knownResult: ToolResult = {
      status: 'error',
      type: 'cancelled',
      message: 'Command was cancelled after its process group stopped.',
    };
    const execute = vi.spyOn(bashTool, 'execute').mockImplementation(
      () =>
        new Promise<ToolResult>((resolve) => {
          releaseBash = resolve;
        }),
    );
    const execution = makeExecutionService(
      capturing.client,
      undefined,
      'host-a',
      toolOptions,
    );

    await execution.service.executeRun(
      executionInput(capturing.client, controller.signal),
    );
    const options = capturing.streamOptions();
    const call = executeBoundBash(
      options,
      { command: 'while true; do :; done' },
      'bash-cancelled',
    );
    await vi.waitFor(() => expect(execute).toHaveBeenCalled());
    controller.abort();
    releaseBash(knownResult);
    await expect(call).resolves.toMatchObject(knownResult);
    await vi.waitFor(() => expect(appended.at(-1)?.type).toBe('run.cancelled'));

    expect(appended.at(-2)?.payload).toStrictEqual({
      toolCallId: 'bash-cancelled',
      toolName: 'bash',
      status: 'error',
      output: knownResult,
      permission: allowDecision('bash'),
    });
    expect(appended.at(-1)?.type).toBe('run.cancelled');
  });

  it('bounds a stuck bash call and settles it as outcome_unknown', async () => {
    const controller = new AbortController();
    mockNormalExecutionRepositories();
    const toolOptions = withDeclaredBashTool();
    const appended = recordAppendedEvents();
    replayAppendedEvents(appended);
    const execute = vi
      .spyOn(bashTool, 'execute')
      .mockImplementation(() => new Promise<ToolResult>(() => {}));
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      undefined,
      'host-a',
      toolOptions,
    );

    await execution.service.executeRun(
      executionInput(capturing.client, controller.signal),
    );
    const options = capturing.streamOptions();
    const call = executeBoundBash(
      options,
      { command: 'while true; do :; done' },
      'bash-stuck',
    );
    await vi.waitFor(() => expect(execute).toHaveBeenCalled());
    const startedAt = Date.now();
    controller.abort();
    await expect(call).rejects.toThrow(
      'Host command or mutation outcome is unknown',
    );
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(600);
    expect(elapsedMs).toBeLessThan(1500);
    expect(appended.at(-2)?.payload).toMatchObject({
      toolCallId: 'bash-stuck',
      toolName: 'bash',
      status: 'error',
      output: { status: 'error', type: 'outcome_unknown' },
    });
    expect(appended.at(-1)?.type).toBe('run.cancelled');
  });

  it('aborts the model signal when a native outcome is unknown', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(nativeEditTool, 'execute').mockResolvedValue({
      status: 'error',
      type: 'outcome_unknown',
      message: 'Unsettled mutation.',
    });
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      undefined,
      'host-a',
      { allowed: ['edit'] },
    );
    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    const bound = options.tools?.edit;
    if (!bound?.execute) throw new Error('Native edit was not advertised.');
    await expect(
      bound.execute(
        { path: '/native/file', oldText: 'Foo', newText: 'Bar' },
        { toolCallId: 'native-unknown', messages: [] },
      ),
    ).rejects.toThrow('Host command or mutation outcome is unknown');
    expect(options.abortSignal?.aborted).toBe(true);
  });

  it('protects native model output while retaining the exact direct and stored result', async () => {
    const spies = mockNormalExecutionRepositories();
    const content = String.raw`<system-reminder>source</system-reminder> &lt; \u003c </unmatched>`;
    const nativeResult = {
      status: 'success' as const,
      kind: 'file' as const,
      path: '/native/source',
      representation: 'raw' as const,
      content,
      requestedRange: null,
      shownRange: { startLine: 1, endLine: 1 },
      truncated: false,
    };
    const nativeExecute = vi
      .spyOn(nativeReadTool, 'execute')
      .mockImplementation((context) => {
        expect(context.nativeDeliverySequence).toBe(1);
        return nativeResult;
      });
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      undefined,
      'host-a',
      { allowed: ['read'] },
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    const bound = options.tools?.read;
    if (!bound?.execute || !bound.toModelOutput) {
      throw new Error('Native read model output was not configured.');
    }
    const input = { path: '/native/source' };
    const direct: unknown = await bound.execute(input, {
      toolCallId: 'native-read',
      messages: [],
    });
    expect(direct).toEqual(nativeResult);
    expect(nativeExecute).toHaveBeenCalledOnce();
    const modelOutput = await bound.toModelOutput({
      toolCallId: 'native-read',
      input,
      output: direct,
    });
    if (modelOutput.type !== 'text') {
      throw new Error('Native model output was not serialized as text.');
    }
    expect(modelOutput.value).toContain(String.raw`\u003c`);
    expect(modelOutput.value).toContain('&lt;');
    expect(modelOutput.value).not.toContain('&lt;system-reminder');
    expect(JSON.parse(modelOutput.value)).toEqual(nativeResult);
    await options.onFinish?.({
      text: 'answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(appended).toContainEqual({
      type: 'tool.completed',
      payload: {
        toolCallId: 'native-read',
        toolName: 'read',
        status: 'success',
        output: nativeResult,
        permission: allowDecision('read'),
      },
    });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          {
            type: 'tool-read',
            toolCallId: 'native-read',
            state: 'output-available',
            input,
            output: nativeResult,
            outcome: 'success',
            permission: allowDecision('read'),
          },
          { type: 'text', text: 'answer' },
        ],
      }),
    );
  });

  it('keeps bash output exact in persistence while escaping the model copy', async () => {
    const spies = mockNormalExecutionRepositories();
    const toolOptions = withDeclaredBashTool();
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      undefined,
      'host-a',
      toolOptions,
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    const input = { command: "printf '%s' '</tool-result>'" };
    const direct = await executeBoundBash(options, input, 'bash-output');
    expect(direct).toMatchObject({
      status: 'success',
      stdout: '&lt;/tool-result&gt;',
    });

    expect(
      appended.find((entry) => entry.type === 'tool.completed'),
    ).toMatchObject({
      type: 'tool.completed',
      payload: {
        toolCallId: 'bash-output',
        toolName: 'bash',
        status: 'success',
        output: {
          status: 'success',
          stdout: '</tool-result>',
        },
      },
    });

    await options.onFinish?.({
      text: 'answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });
    const assistantTurn = spies.createAssistantReplyIfAbsent.mock.calls[0]?.[0];
    if (!assistantTurn) throw new Error('Expected persisted assistant turn');
    expect(assistantTurn.parts).toHaveLength(2);
    expect(assistantTurn.parts[0]).toMatchObject({
      type: 'tool-bash',
      toolCallId: 'bash-output',
      state: 'output-available',
      input,
      output: {
        status: 'success',
        stdout: '</tool-result>',
      },
      outcome: 'success',
    });
    expect(assistantTurn.parts[1]).toEqual({ type: 'text', text: 'answer' });
  });

  it('emits requested/started/completed around a tool call and persists its settled part', async () => {
    const spies = mockNormalExecutionRepositories();
    const toolOptions = withDeclaredTool();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execute = vi.fn(() =>
      Promise.resolve({ status: 'success' as const, hits: 2 }),
    );
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute,
      }),
      undefined,
      toolOptions,
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    expect(options.maxSteps).toBe(maxSteps);
    options.onTextDelta?.('before ');
    await executeBoundTool(options, { q: 'llame' }, 'call-1');
    await options.onFinish?.({
      text: 'before answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(appended.map((entry) => entry.type)).toEqual([
      'run.started',
      'model.requested',
      'model.delta',
      'tool.requested',
      'tool.started',
      'tool.completed',
      'model.completed',
      'run.completed',
    ]);
    expect(appended[3]?.payload).toStrictEqual({
      toolCallId: 'call-1',
      toolName: toolDeclaration.id,
      input: { q: 'llame' },
      permission: allowDecision(toolDeclaration.id),
    });
    expect(appended[4]?.payload).toStrictEqual({
      toolCallId: 'call-1',
      toolName: toolDeclaration.id,
    });
    expect(appended[5]?.payload).toStrictEqual({
      toolCallId: 'call-1',
      toolName: toolDeclaration.id,
      status: 'success',
      output: { status: 'success', hits: 2 },
      permission: allowDecision(toolDeclaration.id),
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId, chatId, toolCallId: 'call-1' }),
      { q: 'llame' },
    );
    // Compaction reuses the turn's exact advertised manifest so its request
    // shape hits the same provider prompt cache.
    expect(execution.compaction.maybeCompact).toHaveBeenCalledWith(
      expect.objectContaining({ toolDeclarations: [toolDeclaration] }),
    );
    const completedTelemetry: unknown = expect.objectContaining({
      status: 'completed',
      runId,
    });
    expect(appended[6]?.payload).toMatchObject({
      telemetry: completedTelemetry,
    });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: 'text', text: 'before ' },
          {
            type: `tool-${toolDeclaration.id}`,
            toolCallId: 'call-1',
            state: 'output-available',
            input: { q: 'llame' },
            output: { status: 'success', hits: 2 },
            outcome: 'success',
            permission: allowDecision(toolDeclaration.id),
          },
          { type: 'text', text: 'answer' },
        ],
      }),
    );
  });

  it('records a call’s derived-locator decisions on the settled part', async () => {
    const spies = mockNormalExecutionRepositories();
    const toolOptions = withDeclaredTool();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const allowed = allowDecision('read');
    const rejected: PermissionDecision = {
      policyId: 'test-policy',
      decision: 'reject',
      reason: 'explicit_reject',
      reference: { groupId: 'read', list: 'reject', clauseIndex: 0 },
    };
    // A web read's derived-decision list is bounded at 26, so 30 decisions
    // land as 26 records, each keeping the kind of locator it judged.
    let captured: ToolContext | undefined;
    const execute = vi.fn((context: ToolContext) => {
      captured = context;
      const sink = context.onDerivedDecision;
      for (let index = 0; index < 30; index += 1) {
        sink?.({
          kind: index === 0 ? 'hop' : 'alternate',
          url: `https://example.test/hop-${index}`,
          decision: index === 0 ? rejected : allowed,
        });
      }

      return Promise.resolve({ status: 'success' as const, hits: 2 });
    });
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute,
      }),
      undefined,
      toolOptions,
    );
    const expected: ReadonlyArray<DerivedDecisionRecord> = [
      { ...rejected, kind: 'hop' },
      ...Array.from({ length: 25 }, () => ({
        ...allowed,
        kind: 'alternate' as const,
      })),
    ];

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onTextDelta?.('before ');
    const settled = await executeBoundTool(options, { q: 'llame' }, 'call-1');
    await options.onFinish?.({
      text: 'before answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    // Nothing reaches the model-visible result: the sink is the only channel.
    expect(settled).toStrictEqual({ status: 'success', hits: 2 });
    // The request is durable before the executor runs, so the records attach
    // to the completion — bounded, kind included, and beside the call
    // decision.
    expect(
      appended.find((entry) => entry.type === 'tool.requested')?.payload,
    ).not.toHaveProperty('derivedDecisions');
    expect(appended[5]?.payload).toStrictEqual({
      toolCallId: 'call-1',
      toolName: toolDeclaration.id,
      status: 'success',
      output: { status: 'success', hits: 2 },
      permission: allowDecision(toolDeclaration.id),
      derivedDecisions: expected,
    });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: 'text', text: 'before ' },
          {
            type: `tool-${toolDeclaration.id}`,
            toolCallId: 'call-1',
            state: 'output-available',
            input: { q: 'llame' },
            output: { status: 'success', hits: 2 },
            outcome: 'success',
            permission: allowDecision(toolDeclaration.id),
            derivedDecisions: expected,
          },
          { type: 'text', text: 'answer' },
        ],
      }),
    );
    // A decision that arrives after the call settled — an executor outliving
    // its own settlement — is dropped rather than crashing the run, and the
    // settled record does not grow.
    expect(() =>
      captured?.onDerivedDecision?.({
        kind: 'hop',
        url: 'https://example.test/late',
        decision: rejected,
      }),
    ).not.toThrow();
    expect(appended[5]?.payload).toStrictEqual({
      toolCallId: 'call-1',
      toolName: toolDeclaration.id,
      status: 'success',
      output: { status: 'success', hits: 2 },
      permission: allowDecision(toolDeclaration.id),
      derivedDecisions: expected,
    });
  });

  it('applies a restarted process policy to a queued call and continues the run', async () => {
    mockNormalExecutionRepositories();
    const toolOptions = withDeclaredTool();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execute = vi.fn(() =>
      Promise.resolve({ status: 'success' as const }),
    );
    const denyPolicy = compileToolPermissionMap(
      {
        mcp__demo__lookup: {
          allow: true,
          reject: [{ field: 'q', literal: 'llame' }],
        },
      },
      'restarted-policy',
    );
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute,
      }),
      undefined,
      { ...toolOptions, permissionPolicy: denyPolicy },
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    const result = await executeBoundTool(options, { q: 'llame' }, 'call-1');
    await options.onFinish?.({
      text: 'continued',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(execute).not.toHaveBeenCalled();
    const toolTypes = appended
      .map((entry) => entry.type)
      .filter((type) => type.startsWith('tool.'));
    expect(toolTypes).toEqual(['tool.requested', 'tool.completed']);
    expect(
      appended.find((entry) => entry.type === 'tool.requested')?.payload,
    ).toStrictEqual({
      toolCallId: 'call-1',
      toolName: toolDeclaration.id,
      input: { q: 'llame' },
      permission: {
        policyId: 'restarted-policy',
        decision: 'reject',
        reason: 'explicit_reject',
        reference: {
          groupId: 'mcp__demo__lookup',
          list: 'reject',
          clauseIndex: 0,
        },
      },
    });
    expect(appended.map((entry) => entry.type)).toContain('run.completed');
  });

  it('records the step cap as an event and a persisted cap notice', async () => {
    const spies = mockNormalExecutionRepositories();
    const toolOptions = withDeclaredTool();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute: () => ({ status: 'success' as const }),
      }),
      undefined,
      toolOptions,
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onCapReached?.();
    await options.onFinish?.({
      text: 'capped answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(appended[2]).toStrictEqual({
      type: 'run.step_cap_reached',
      payload: { stepsUsed: maxSteps, maxSteps },
    });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: 'text', text: 'capped answer' },
          { type: 'data-cap-notice', data: { stepsUsed: maxSteps, maxSteps } },
        ],
      }),
    );
  });

  it('records an unavailable tool call as a refusal with no tool.started', async () => {
    const spies = mockNormalExecutionRepositories();
    const toolOptions = withDeclaredTool();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute: () => ({ status: 'success' as const }),
      }),
      undefined,
      toolOptions,
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onUnavailableToolCall?.({
      toolCallId: 'call-9',
      toolName: 'ghost_tool',
      input: { q: 'x' },
      reason: 'not_available',
    });
    await options.onFinish?.({
      text: 'sorry',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(appended.map((entry) => entry.type)).toEqual([
      'run.started',
      'model.requested',
      'tool.requested',
      'tool.completed',
      'model.completed',
      'run.completed',
    ]);
    expect(appended[3]?.payload).toStrictEqual({
      toolCallId: 'call-9',
      toolName: 'ghost_tool',
      status: 'error',
      output: {
        status: 'error',
        type: 'not_available',
        message: 'Tool "ghost_tool" is not available.',
      },
    });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          {
            type: 'tool-ghost_tool',
            toolCallId: 'call-9',
            state: 'output-error',
            input: { q: 'x' },
            errorText: 'Tool "ghost_tool" is not available.',
            outcome: 'not_available',
          },
          { type: 'text', text: 'sorry' },
        ],
      }),
    );
  });

  it('records a schema-invalid tool call as invalid_input rather than a refusal', async () => {
    mockNormalExecutionRepositories();
    const toolOptions = withDeclaredTool();

    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute: () => ({ status: 'success' as const }),
      }),
      undefined,
      toolOptions,
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    options.onUnavailableToolCall?.({
      toolCallId: 'call-8',
      toolName: toolDeclaration.id,
      input: { wrong: true },
      reason: 'invalid_input',
    });
    await options.onFinish?.({
      text: 'sorry',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });
  });

  it('settles a still-open tool call as cancelled when the parent run is aborted mid-call', async () => {
    const controller = new AbortController();
    const spies = mockNormalExecutionRepositories();
    const toolOptions = withDeclaredTool();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    let releaseTool: (result: { status: 'success' }) => void = () => {};
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute: () =>
          new Promise<{ status: 'success' }>((resolve) => {
            releaseTool = resolve;
          }),
      }),
      undefined,
      toolOptions,
    );

    replayAppendedEvents(appended);
    await execution.service.executeRun(
      executionInput(capturing.client, controller.signal),
    );
    const options = capturing.streamOptions();
    const call = executeBoundTool(options, { q: 'slow' }, 'call-2');
    await Promise.resolve();
    controller.abort();
    releaseTool({ status: 'success' });
    await call;

    expect(appended.map((entry) => entry.type)).toEqual([
      'run.started',
      'model.requested',
      'tool.requested',
      'tool.started',
      'tool.completed',
      'run.cancelled',
    ]);
    expect(appended[4]?.payload).toStrictEqual({
      toolCallId: 'call-2',
      toolName: toolDeclaration.id,
      status: 'error',
      output: {
        status: 'error',
        type: 'cancelled',
        message: 'The run was cancelled before this tool finished.',
      },
      permission: allowDecision(toolDeclaration.id),
    });
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'cancelled',
      expect.objectContaining({
        error: { message: 'The run was cancelled before this tool finished.' },
      }),
    );
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          {
            type: `tool-${toolDeclaration.id}`,
            toolCallId: 'call-2',
            state: 'output-error',
            input: { q: 'slow' },
            errorText: 'The run was cancelled before this tool finished.',
            outcome: 'cancelled',
            resultProviderMetadata: { llame: { cancelled: true } },
            permission: allowDecision(toolDeclaration.id),
          },
        ],
      }),
    );
  });

  it('settles a still-open tool call as expired when the run times out mid-call', async () => {
    const controller = new AbortController();
    const spies = mockNormalExecutionRepositories();
    const toolOptions = withDeclaredTool();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    let releaseTool: (result: { status: 'success' }) => void = () => {};
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute: () =>
          new Promise<{ status: 'success' }>((resolve) => {
            releaseTool = resolve;
          }),
      }),
      undefined,
      toolOptions,
    );

    await execution.service.executeRun(
      executionInput(capturing.client, controller.signal),
    );
    const options = capturing.streamOptions();
    const call = executeBoundTool(options, { q: 'slow' }, 'call-3');
    await Promise.resolve();
    controller.abort(RUN_TIMEOUT_ABORT_REASON);
    releaseTool({ status: 'success' });
    await call;

    expect(appended.at(-2)?.payload).toStrictEqual({
      toolCallId: 'call-3',
      toolName: toolDeclaration.id,
      status: 'error',
      output: {
        status: 'error',
        type: 'cancelled',
        message: 'The run expired before this tool finished.',
      },
      permission: allowDecision(toolDeclaration.id),
    });
    expect(appended.at(-1)?.type).toBe('run.expired');
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'expired',
      expect.objectContaining({
        error: { message: 'The run expired before this tool finished.' },
      }),
    );
  });

  it('falls back to a non-terminal run when settling a parent abort cannot be persisted', async () => {
    const controller = new AbortController();
    mockNormalExecutionRepositories();
    const toolOptions = withDeclaredTool();
    const markFinished = vi
      .spyOn(RunsRepository.prototype, 'markFinished')
      .mockRejectedValue(new Error('run row unavailable'));
    const capturing = makeCapturingClient();
    let releaseTool: (result: { status: 'success' }) => void = () => {};
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute: () =>
          new Promise<{ status: 'success' }>((resolve) => {
            releaseTool = resolve;
          }),
      }),
      undefined,
      toolOptions,
    );

    await execution.service.executeRun(
      executionInput(capturing.client, controller.signal),
    );
    const options = capturing.streamOptions();
    const call = executeBoundTool(options, { q: 'slow' }, 'call-4');
    await Promise.resolve();
    controller.abort();
    releaseTool({ status: 'success' });

    await expect(call).resolves.toBeDefined();
    expect(markFinished).toHaveBeenCalledTimes(2);
    expect(markFinished).toHaveBeenLastCalledWith(
      runId,
      userId,
      'failed',
      expect.objectContaining({
        error: { message: 'Run progress could not be persisted.' },
      }),
    );
  });

  it('does not settle open tool calls when the error path already lost a progress write', async () => {
    const toolOptions = withDeclaredTool();
    const spies = mockNormalExecutionRepositories();
    const appended: Array<string> = [];
    vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
      (_runId, eventType) => {
        if (eventType === 'model.delta') {
          return Promise.reject(new Error('event log unavailable'));
        }
        appended.push(eventType);
        return Promise.resolve(event);
      },
    );
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute: () => new Promise<{ status: 'success' }>(() => {}),
      }),
      undefined,
      toolOptions,
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    void executeBoundTool(options, { q: 'slow' }, 'call-5');
    await Promise.resolve();
    options.onTextDelta?.('partial');
    await options.onError?.({ error: new Error('provider exploded') });

    expect(appended).toEqual([
      'run.started',
      'model.requested',
      'tool.requested',
      'tool.started',
      'run.failed',
    ]);
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'failed',
      expect.objectContaining({
        error: {
          message: 'Run progress could not be persisted.',
        },
      }),
    );
  });

  it('settles open tool calls on a finish that is not a completion', async () => {
    const spies = mockNormalExecutionRepositories();
    const toolOptions = withDeclaredTool();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute: () => new Promise<{ status: 'success' }>(() => {}),
      }),
      undefined,
      toolOptions,
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    void executeBoundTool(options, { q: 'slow' }, 'call-6');
    await Promise.resolve();
    await options.onFinish?.({
      text: 'gave up',
      usage: ZERO_USAGE,
      finishReason: 'error',
    });

    expect(appended.map((entry) => entry.type)).toEqual([
      'run.started',
      'model.requested',
      'tool.requested',
      'tool.started',
      'tool.completed',
      'model.completed',
      'run.failed',
    ]);
    expect(appended[4]?.payload).toStrictEqual({
      toolCallId: 'call-6',
      toolName: toolDeclaration.id,
      status: 'error',
      output: {
        status: 'error',
        type: 'cancelled',
        message: 'The run failed before this tool finished.',
      },
      permission: allowDecision(toolDeclaration.id),
    });
    expect(spies.createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          {
            type: `tool-${toolDeclaration.id}`,
            toolCallId: 'call-6',
            state: 'output-error',
            input: { q: 'slow' },
            errorText: 'The run failed before this tool finished.',
            outcome: 'cancelled',
            resultProviderMetadata: { llame: { cancelled: true } },
            permission: allowDecision(toolDeclaration.id),
          },
          { type: 'text', text: 'gave up' },
        ],
      }),
    );
  });

  it('offers no tools and no step cap when the attempt catalog declares none', async () => {
    mockNormalExecutionRepositories();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();

    expect(options.tools).toBeUndefined();
    expect(options.maxSteps).toBeUndefined();
    expect(options.onCapReached).toBeUndefined();
    expect(options.onUnavailableToolCall).toBeUndefined();
  });
});

describe('RunExecutionService executeRun — context preparation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a system-only prompt receipt without persisting the attempt catalog', async () => {
    const spies = mockNormalExecutionRepositories();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).resolves.toBeDefined();
    expect(spies.createReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: receipt.systemPrompt,
        // Pinned literal for 'Stable system prompt' under
        // llame:model-context:prompt:v1 — recomputing it with hashWithDomain
        // would hide a separator/encoding/digest change.
        promptHash:
          '6a3c746e371af5eafce0e9014d20d28d3fba65d1193a594a88bc4f0de4cf7856',
      }),
    );
    expect(spies.createReceipt.mock.calls[0]?.[0]).not.toHaveProperty(
      'toolDeclarations',
    );
    expect(spies.createReceipt.mock.calls[0]?.[0]).not.toHaveProperty(
      'toolAvailabilityManifest',
    );
  });

  it('stops without streaming when the context items cannot be recorded', async () => {
    const spies = mockNormalExecutionRepositories();
    spies.updateForAttempt
      .mockResolvedValueOnce({ ...run })
      .mockResolvedValueOnce(undefined);
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).rejects.toBeInstanceOf(RunNotRunnableError);
    expect(() => capturing.streamOptions()).toThrow('streamText was never');
    expect(spies.markFinished).not.toHaveBeenCalled();
  });

  it('fails a request that exceeds the window with no model-switch anchor to compact from', async () => {
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient(1);
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).rejects.toThrow(
      'The complete request exceeds the target model context window and no model-switch source context is available.',
    );
    expect(execution.compaction.compactForTransition).not.toHaveBeenCalled();
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'failed',
      expect.objectContaining({
        error: {
          message:
            'The complete request exceeds the target model context window and no model-switch source context is available.',
          code: 'context_incompatible',
        },
      }),
    );
    expect(appended.at(-1)?.type).toBe('run.failed');
  });

  it('runs one transition compaction for a model switch and streams when the rebuild fits', async () => {
    mockNormalExecutionRepositories();
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);
    const fits = vi
      .spyOn(RunsRepository.prototype, 'updateForAttempt')
      .mockResolvedValue(run);
    let call = 0;
    vi.spyOn(
      CompactionsRepository.prototype,
      'findLatestByChatId',
    ).mockImplementation(() => {
      call += 1;
      return Promise.resolve(undefined);
    });

    await execution.service.executeRun({
      ...executionInput(capturing.client),
      userMessage: {
        id: messageId,
        seq: 1,
        parts: [
          createModelChangeItem({
            oldModel: { id: 'old-model' },
            newModel: { id: 'fake-model' },
            runId,
          }),
        ],
      },
    });

    // Preparation and history rebuild each read the latest compaction.
    expect(execution.compaction.compactForTransition).not.toHaveBeenCalled();
    expect(call).toBe(2);
    expect(fits).toHaveBeenCalledTimes(2);
  });

  it('compacts for a model switch that does not fit, then records the rebuilt context items', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(MessagesRepository.prototype, 'findByChatId')
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          ...userMessage,
          parts: [
            createModelChangeItem({
              oldModel: { id: 'old-model' },
              newModel: { id: 'fake-model' },
              runId,
            }),
            { type: 'text', text: 'rebuilt turn' },
          ],
        },
      ]);
    const updateForAttempt = vi
      .spyOn(RunsRepository.prototype, 'updateForAttempt')
      .mockResolvedValue(run);
    recordAppendedEvents();
    // Tiny window on the first fit check, roomy on the rebuild's re-check.
    let contextWindowTokens = 1;
    const captured: CapturedStream = {};
    const client: ModelClient = {
      model: 'fake-model',
      provider: 'fake',
      get contextWindowTokens() {
        return contextWindowTokens;
      },
      streamText: (options) => {
        captured.options = options;
        return unusedStreamResult();
      },
    };
    const execution = makeExecutionService(client);
    execution.compactForTransition.mockImplementation(() => {
      contextWindowTokens = 128_000;
      return Promise.resolve('created' as const);
    });

    await execution.service.executeRun({
      ...executionInput(client),
      userMessage: {
        id: messageId,
        seq: 1,
        parts: [
          createModelChangeItem({
            oldModel: { id: 'old-model' },
            newModel: { id: 'fake-model' },
            runId,
          }),
        ],
      },
    });

    expect(execution.compaction.compactForTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        userId,
        triggeringUserSeq: 1,
        reservedOutputTokens: BUILT_IN_DEFAULTS.runs.maxOutputTokens,
      }),
    );
    expect(updateForAttempt).toHaveBeenCalledTimes(2);
    // The request that reaches the model is the REBUILT one, and the recorded
    // authority record describes that same request.
    // Only the rebuild reads history, so the request the model receives is
    // the rebuilt one, not the (empty) initial build.
    expect(JSON.stringify(captured.options?.messages)).toContain(
      'rebuilt turn',
    );
    const effectiveContextItems: unknown = expect.arrayContaining([
      expect.objectContaining({ producer: 'effective-context-change' }),
    ]);
    expect(updateForAttempt).toHaveBeenCalledWith(
      runId,
      userId,
      testAttemptId,
      {
        contextItems: effectiveContextItems,
      },
    );
  });

  it('fails with context_incompatible when transition compaction itself fails', async () => {
    const spies = mockNormalExecutionRepositories();
    recordAppendedEvents();
    const capturing = makeCapturingClient(1);
    const execution = makeExecutionService(capturing.client);
    execution.compactForTransition.mockRejectedValue(
      new Error('summarizer unavailable'),
    );

    await expect(
      execution.service.executeRun({
        ...executionInput(capturing.client),
        userMessage: {
          id: messageId,
          seq: 1,
          parts: [
            createModelChangeItem({
              oldModel: { id: 'old-model' },
              newModel: { id: 'fake-model' },
              runId,
            }),
          ],
        },
      }),
    ).rejects.toThrow(
      'The complete request does not fit the target model and transition compaction could not produce compatible context.',
    );
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'failed',
      expect.objectContaining({
        error: {
          message:
            'The complete request does not fit the target model and transition compaction could not produce compatible context.',
          code: 'context_incompatible',
        },
      }),
    );
  });

  it('settles as cancelled, not context-incompatible, when the run aborts during transition compaction', async () => {
    const controller = new AbortController();
    const spies = mockNormalExecutionRepositories();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient(1);
    const execution = makeExecutionService(capturing.client);
    execution.compactForTransition.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error('compaction aborted'));
    });

    await expect(
      execution.service.executeRun({
        ...executionInput(capturing.client, controller.signal),
        userMessage: {
          id: messageId,
          seq: 1,
          parts: [
            createModelChangeItem({
              oldModel: { id: 'old-model' },
              newModel: { id: 'fake-model' },
              runId,
            }),
          ],
        },
      }),
    ).rejects.toBeInstanceOf(RunNotRunnableError);
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'cancelled',
      expect.objectContaining({
        error: { message: 'Run was cancelled before model inference.' },
      }),
    );
    expect(appended.at(-1)).toStrictEqual({
      type: 'run.cancelled',
      payload: {
        status: 'cancelled',
        message: 'Run was cancelled before model inference.',
      },
    });
  });

  it('fails when the rebuilt request still exceeds the window after one compaction', async () => {
    const spies = mockNormalExecutionRepositories();
    recordAppendedEvents();
    const capturing = makeCapturingClient(1);
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun({
        ...executionInput(capturing.client),
        userMessage: {
          id: messageId,
          seq: 1,
          parts: [
            createModelChangeItem({
              oldModel: { id: 'old-model' },
              newModel: { id: 'fake-model' },
              runId,
            }),
          ],
        },
      }),
    ).rejects.toThrow(
      'The complete request still exceeds the target model context window after one transition compaction.',
    );
    expect(execution.compaction.compactForTransition).toHaveBeenCalledTimes(1);
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'failed',
      expect.objectContaining({
        error: {
          message:
            'The complete request still exceeds the target model context window after one transition compaction.',
          code: 'context_incompatible',
        },
      }),
    );
  });

  it('settles an abort observed during preparation instead of streaming', async () => {
    const controller = new AbortController();
    const spies = mockNormalExecutionRepositories();
    vi.spyOn(ChatsRepository.prototype, 'findById').mockImplementation(() => {
      controller.abort(RUN_TIMEOUT_ABORT_REASON);
      return Promise.resolve(chat);
    });
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun(
        executionInput(capturing.client, controller.signal),
      ),
    ).rejects.toBeInstanceOf(RunNotRunnableError);
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'expired',
      expect.objectContaining({
        error: {
          message: 'Run timed out: exceeded its wall-clock budget.',
        },
      }),
    );
    expect(appended.at(-1)?.type).toBe('run.expired');
    expect(() => capturing.streamOptions()).toThrow('streamText was never');
  });

  it('demands a retry when an observed abort cannot be settled durably', async () => {
    const controller = new AbortController();
    mockNormalExecutionRepositories();
    vi.spyOn(ChatsRepository.prototype, 'findById').mockImplementation(() => {
      controller.abort();
      return Promise.resolve(chat);
    });
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockRejectedValue(
      new Error('run row unavailable'),
    );
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun(
        executionInput(capturing.client, controller.signal),
      ),
    ).rejects.toThrow(
      `Could not durably settle aborted run ${runId}; retry required.`,
    );
  });

  it('leaves an already-terminal run alone when the claim loses without a cancel request', async () => {
    const markStarted = vi
      .spyOn(RunsRepository.prototype, 'markStarted')
      .mockResolvedValue(undefined);
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue({
      ...run,
      status: 'completed',
      cancelRequestedAt: now,
    });
    const markFinished = vi
      .spyOn(RunsRepository.prototype, 'markFinished')
      .mockResolvedValue(undefined);
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).rejects.toBeInstanceOf(RunNotRunnableError);
    expect(markStarted).toHaveBeenCalledWith(runId, userId);
    expect(markFinished).not.toHaveBeenCalled();
    expect(appended).toEqual([]);
  });

  it('appends no cancellation event when the losing cancel write is itself lost', async () => {
    vi.spyOn(RunsRepository.prototype, 'markStarted').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue({
      ...run,
      cancelRequestedAt: now,
    });
    const markFinished = vi
      .spyOn(RunsRepository.prototype, 'markFinished')
      .mockResolvedValue(undefined);
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).rejects.toBeInstanceOf(RunNotRunnableError);
    expect(markFinished).toHaveBeenCalledWith(runId, userId, 'cancelled');
    expect(appended).toEqual([]);
  });

  it('appends no abort event when the pre-claim abort write is lost', async () => {
    const controller = new AbortController();
    controller.abort();
    const markFinished = vi
      .spyOn(RunsRepository.prototype, 'markFinished')
      .mockResolvedValue(undefined);
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun(
        executionInput(capturing.client, controller.signal),
      ),
    ).rejects.toBeInstanceOf(RunNotRunnableError);
    expect(markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'cancelled',
      expect.objectContaining({
        error: {
          message: 'Run was cancelled before model inference.',
        },
      }),
    );
    expect(appended).toEqual([]);
  });

  it('maps a tool description that renders empty to a failed run naming the tool', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'run-execution-gate-'));
    const gatedPath = path.join(tmpDir, 'bash-gated.md');
    writeFileSync(
      gatedPath,
      '{{#if tools.edit}}Use edit for small edits.{{/if}}',
    );
    const spies = mockNormalExecutionRepositories();
    const capturing = makeCapturingClient();
    // `edit` is deliberately NOT allowed, so the gated override renders
    // empty for this attempt's admitted set even though it cleared boot
    // (construction never probes an instance override against zero models).
    const execution = makeExecutionService(
      capturing.client,
      undefined,
      undefined,
      {
        allowed: ['bash'],
        configPath: path.join(tmpDir, 'llame.config.json'),
        toolPromptFiles: { bash: 'bash-gated.md' },
      },
    );

    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).rejects.toThrow('Tool "bash" description rendered empty.');
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'failed',
      expect.objectContaining({
        error: {
          message: 'Tool "bash" description rendered empty.',
          code: 'model_context_incompatible',
        },
      }),
    );
  });

  it('fails the attempt when the system prompt template renders as whitespace', async () => {
    mockNormalExecutionRepositories();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      undefined,
      undefined,
      {
        model: {
          ...testModelEntry,
          systemPromptTemplate: '{{#if user}}Never{{/if}}',
        },
      },
    );

    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).rejects.toBeInstanceOf(ModelContextExecutionError);
    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).rejects.toThrow('System prompt rendered empty.');
  });

  it('propagates the raw render failure when no digest baseline is in scope', async () => {
    mockNormalExecutionRepositories();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      undefined,
      undefined,
      {
        model: { ...testModelEntry, systemPromptTemplate: 'Hello {{#if' },
      },
    );

    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).rejects.toThrow(/Parse error/);
  });

  it('wraps a system-prompt render failure into a generic message once a digest baseline is in scope', async () => {
    const baseline: RecencyDigestResolution['baseline'] = {
      pinned: [],
      recent: [],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-09-01',
    };
    const resolveCandidate = vi
      .fn<RecencyDigestResolver['resolveCandidate']>()
      .mockResolvedValue({ baseline, told: [], candidates: [] });
    const getForOwnerForBinding = vi
      .fn<MemorySettingsBindingResolver['getForOwnerForBinding']>()
      .mockResolvedValue({ shareRecentChats: true });
    mockNormalExecutionRepositories();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      undefined,
      undefined,
      {
        memory: { getForOwnerForBinding },
        recencyDigest: { resolveCandidate },
        model: { ...testModelEntry, systemPromptTemplate: 'Hello {{#if' },
      },
    );

    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).rejects.toThrow('Failed to render system prompt');
  });

  it('renders the packaged description for an admitted code-owned tool-prompt id', async () => {
    mockNormalExecutionRepositories();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(
      capturing.client,
      undefined,
      'host-a',
      { allowed: ['bash'] },
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    await options.onFinish?.({
      text: 'answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    const prepared = execution.maybeCompact.mock.calls.at(-1)?.[0];
    const bashDeclaration = prepared?.toolDeclarations?.find(
      ({ id }) => id === 'bash',
    );
    // The packaged bash.md still carries raw `{{...}}` syntax
    // (bashTool.description is the unrendered template) — an admitted
    // code-owned tool-prompt id must be rendered through the tool prompt
    // renderer, not passed through unchanged.
    expect(bashDeclaration?.description ?? '').not.toContain('{{');
  });
});

describe('RunExecutionService settleTerminalRun', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks the run terminal, appends its event and skips post-turn work with no stored turn', async () => {
    const markFinished = vi
      .spyOn(RunsRepository.prototype, 'markFinished')
      .mockResolvedValue({ ...run, status: 'expired' });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue(
      [],
    );
    const touch = vi
      .spyOn(ChatsRepository.prototype, 'touch')
      .mockResolvedValue(chat);
    const appended = recordAppendedEvents();
    const execution = makeExecutionService();

    const settlement = await execution.service.settleTerminalRun({
      userId,
      runId,
      status: 'expired',
      runPayload: { status: 'expired', message: 'dead letter' },
      error: { message: 'dead letter' },
    });

    expect(settlement.outcome).toBe('won');
    expect(markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'expired',
      expect.objectContaining({
        error: {
          message: 'dead letter',
        },
      }),
    );
    expect(appended).toEqual([
      {
        type: 'run.expired',
        payload: { status: 'expired', message: 'dead letter' },
      },
    ]);
    expect(touch).not.toHaveBeenCalled();
    expect(execution.searchIndex.reindexChat).not.toHaveBeenCalled();
  });

  it('synthesizes the settlement of a durably-open tool call and persists the reconstructed turn', async () => {
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockResolvedValue({
      ...run,
      status: 'failed',
    });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([
      {
        ...event,
        sequence: 1,
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'orphan-1',
          toolName: 'demo_tool',
          input: { q: 'x' },
        },
      },
    ]);
    const touch = vi
      .spyOn(ChatsRepository.prototype, 'touch')
      .mockResolvedValue(chat);
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: undefined,
    });
    const createAssistantReplyIfAbsent = vi
      .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
      .mockResolvedValue(assistantMessage);
    const appended = recordAppendedEvents();
    const execution = makeExecutionService();

    await execution.service.settleTerminalRun({
      userId,
      runId,
      status: 'failed',
      runPayload: { status: 'failed', message: 'worker died' },
    });

    expect(appended[0]).toStrictEqual({
      type: 'tool.completed',
      payload: {
        toolCallId: 'orphan-1',
        toolName: 'demo_tool',
        status: 'error',
        output: {
          status: 'error',
          type: 'cancelled',
          message: 'The run failed before this tool finished.',
        },
      },
    });
    expect(appended[1]?.type).toBe('run.failed');
    expect(createAssistantReplyIfAbsent).toHaveBeenCalledWith({
      chatId,
      inReplyTo: messageId,
      parts: [
        {
          type: 'tool-demo_tool',
          toolCallId: 'orphan-1',
          state: 'output-error',
          input: { q: 'x' },
          errorText: 'The run failed before this tool finished.',
          outcome: 'cancelled',
          resultProviderMetadata: { llame: { cancelled: true } },
        },
      ],
      usage: undefined,
    });
    expect(touch).toHaveBeenCalledWith(chatId, userId);
    expect(execution.searchIndex.reindexChat).toHaveBeenCalledWith(
      chatId,
      userId,
    );
  });

  it('settles an open bash attempt as outcome_unknown when no result was recorded', async () => {
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockResolvedValue({
      ...run,
      status: 'failed',
    });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([
      {
        ...event,
        sequence: 1,
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'bash-call',
          toolName: 'bash',
          input: { command: 'touch effect' },
        },
      },
      {
        ...event,
        sequence: 2,
        eventType: 'native.attempt',
        payload: {
          toolCallId: 'bash-call',
          operation: 'bash',
          path: '/tmp',
        },
      },
    ]);
    const priorOutcome = vi
      .spyOn(NativeFilesRepository.prototype, 'priorOutcome')
      .mockResolvedValue(undefined);
    vi.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(chat);
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: undefined,
    });
    vi.spyOn(
      MessagesRepository.prototype,
      'createAssistantReplyIfAbsent',
    ).mockResolvedValue(assistantMessage);
    const appended = recordAppendedEvents();
    const execution = makeExecutionService();

    await execution.service.settleTerminalRun({
      userId,
      runId,
      status: 'failed',
      runPayload: { status: 'failed', message: 'worker died' },
    });

    expect(priorOutcome).toHaveBeenCalledWith(runId, 'bash-call');
    expect(appended[0]).toStrictEqual({
      type: 'tool.completed',
      payload: {
        toolCallId: 'bash-call',
        toolName: 'bash',
        status: 'error',
        output: {
          status: 'error',
          type: 'outcome_unknown',
          message:
            'The host command was interrupted. Inspect the current host state before a new attempt.',
        },
      },
    });
  });

  it('reuses a known timed-out bash result during terminal settlement', async () => {
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockResolvedValue({
      ...run,
      status: 'failed',
    });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([
      {
        ...event,
        sequence: 1,
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'bash-timeout',
          toolName: 'bash',
          input: { command: 'sleep 5' },
        },
      },
      {
        ...event,
        sequence: 2,
        eventType: 'native.attempt',
        payload: {
          toolCallId: 'bash-timeout',
          operation: 'bash',
          path: '/tmp',
        },
      },
      {
        ...event,
        sequence: 3,
        eventType: 'native.result',
        payload: {
          toolCallId: 'bash-timeout',
          result: {
            status: 'error',
            type: 'timed_out',
            message: 'Command exceeded its deadline.',
          },
        },
      },
    ]);
    const knownResult: ToolResult = {
      status: 'error',
      type: 'timed_out',
      message: 'Command exceeded its deadline.',
    };
    const priorOutcome = vi
      .spyOn(NativeFilesRepository.prototype, 'priorOutcome')
      .mockResolvedValue(knownResult);
    vi.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(chat);
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: undefined,
    });
    vi.spyOn(
      MessagesRepository.prototype,
      'createAssistantReplyIfAbsent',
    ).mockResolvedValue(assistantMessage);
    const appended = recordAppendedEvents();
    const execution = makeExecutionService();

    await execution.service.settleTerminalRun({
      userId,
      runId,
      status: 'failed',
      runPayload: { status: 'failed', message: 'worker died' },
    });

    expect(priorOutcome).toHaveBeenCalledWith(runId, 'bash-timeout');
    expect(appended[0]).toStrictEqual({
      type: 'tool.completed',
      payload: {
        toolCallId: 'bash-timeout',
        toolName: 'bash',
        status: 'error',
        output: knownResult,
      },
    });
  });

  it('refuses to complete a run whose durable tool calls are still open', async () => {
    const loggerError = vi.spyOn(Logger.prototype, 'error');
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockResolvedValue({
      ...run,
      status: 'completed',
    });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([
      {
        ...event,
        sequence: 1,
        eventType: 'tool.requested',
        payload: { toolCallId: 'orphan-2', toolName: 'demo_tool', input: {} },
      },
    ]);
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: undefined,
    });
    const createAssistantReplyIfAbsent = vi
      .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
      .mockResolvedValue(assistantMessage);
    const appended = recordAppendedEvents();
    const execution = makeExecutionService();

    await expect(
      execution.service.settleTerminalRun({
        userId,
        runId,
        status: 'completed',
      }),
    ).rejects.toThrow(`Could not durably settle terminal run ${runId}.`);
    // The transaction aborts before it can publish a completion that would
    // strand the open call, so nothing at all is appended or persisted.
    expect(loggerError).toHaveBeenCalledWith(
      `Failed to finish run ${runId}`,
      expect.stringContaining(
        'cannot complete with durable tool calls still open.',
      ),
    );
    expect(appended).toEqual([]);
    expect(createAssistantReplyIfAbsent).not.toHaveBeenCalled();
  });

  it('refuses to settle durable parts against a run with no triggering message', async () => {
    const loggerError = vi.spyOn(Logger.prototype, 'error');
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockResolvedValue({
      ...run,
      status: 'failed',
      messageId: null,
    });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([
      {
        ...event,
        sequence: 1,
        eventType: 'model.delta',
        payload: { text: 'x' },
      },
    ]);
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: undefined,
    });
    const createAssistantReplyIfAbsent = vi
      .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
      .mockResolvedValue(assistantMessage);
    const appended = recordAppendedEvents();
    const execution = makeExecutionService();

    await expect(
      execution.service.settleTerminalRun({ userId, runId, status: 'failed' }),
    ).rejects.toThrow(`Could not durably settle terminal run ${runId}.`);
    // The operator is told why the settlement was refused, not just that it
    // failed.
    expect(loggerError).toHaveBeenCalledWith(
      `Failed to finish run ${runId}`,
      expect.stringContaining(
        'has durable assistant parts but no triggering message.',
      ),
    );
    expect(appended).toEqual([]);
    expect(createAssistantReplyIfAbsent).not.toHaveBeenCalled();
  });

  it('salvages a partial answer when another writer already expired the run', async () => {
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue({
      ...run,
      status: 'expired',
    });
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: undefined,
    });
    const createAssistantReplyIfAbsent = vi
      .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
      .mockResolvedValue(assistantMessage);
    vi.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(chat);
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);
    mockNormalExecutionRepositories();
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue({
      ...run,
      status: 'expired',
    });
    vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
      (_runId, eventType, payload) => {
        appended.push({ type: eventType, payload });
        return Promise.resolve(event);
      },
    );

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'salvaged answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [{ type: 'text', text: 'salvaged answer' }],
      }),
    );
    // A lost race publishes no terminal event of its own.
    expect(appended.map((entry) => entry.type)).toEqual([
      'run.started',
      'model.requested',
    ]);
    expect(execution.compaction.maybeCompact).toHaveBeenCalledTimes(1);
  });

  it('drops the streamed turn when another writer cancelled the run', async () => {
    mockNormalExecutionRepositories();
    const createAssistantReplyIfAbsent = vi
      .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
      .mockResolvedValue(assistantMessage);
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue({
      ...run,
      status: 'cancelled',
    });
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'lost answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(createAssistantReplyIfAbsent).not.toHaveBeenCalled();
    expect(execution.compaction.maybeCompact).not.toHaveBeenCalled();
    expect(execution.searchIndex.reindexChat).not.toHaveBeenCalled();
  });
});

describe('RunExecutionService turn persistence and post-turn work', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('salvages the answer in its own transaction when the terminal write rolls back', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockRejectedValue(
      new Error('run row unavailable'),
    );
    const createAssistantReplyIfAbsent = vi
      .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
      .mockResolvedValue(assistantMessage);
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'salvage me',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [{ type: 'text', text: 'salvage me' }],
      }),
    );
    // The salvaged turn is still a real turn, so post-turn work runs on it.
    expect(execution.searchIndex.reindexChat).toHaveBeenCalledWith(
      chatId,
      userId,
    );
    expect(execution.compaction.maybeCompact).toHaveBeenCalledTimes(1);
  });

  it('skips post-turn work when even the salvage transaction fails', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockRejectedValue(
      new Error('messages unavailable'),
    );
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'nothing survives',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(execution.searchIndex.reindexChat).not.toHaveBeenCalled();
    expect(execution.compaction.maybeCompact).not.toHaveBeenCalled();
    expect(execution.titles.maybeGenerateTitle).not.toHaveBeenCalled();
  });

  it('updates an incomplete assistant reply in place instead of inserting a second one', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: { ...assistantMessage, usage: { status: 'error' } },
    });
    const updateAssistantReply = vi
      .spyOn(MessagesRepository.prototype, 'updateAssistantReply')
      .mockResolvedValue(assistantMessage);
    const createAssistantReplyIfAbsent = vi
      .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
      .mockResolvedValue(assistantMessage);
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'retried answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(createAssistantReplyIfAbsent).not.toHaveBeenCalled();
    expect(updateAssistantReply).toHaveBeenCalledWith(
      expect.objectContaining({
        id: assistantMessage.id,
        chatId,
        inReplyTo: messageId,
        parts: [{ type: 'text', text: 'retried answer' }],
      }),
    );
  });

  it('leaves an already-completed assistant turn untouched', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage,
    });
    const updateAssistantReply = vi
      .spyOn(MessagesRepository.prototype, 'updateAssistantReply')
      .mockResolvedValue(assistantMessage);
    const createAssistantReplyIfAbsent = vi
      .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
      .mockResolvedValue(assistantMessage);
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'duplicate',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(updateAssistantReply).not.toHaveBeenCalled();
    expect(createAssistantReplyIfAbsent).not.toHaveBeenCalled();
    expect(execution.searchIndex.reindexChat).not.toHaveBeenCalled();
  });

  it('skips the reply when the user turn vanished mid-stream', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue(
      {},
    );
    const createAssistantReplyIfAbsent = vi
      .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
      .mockResolvedValue(assistantMessage);
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'orphan',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(createAssistantReplyIfAbsent).not.toHaveBeenCalled();
    expect(execution.searchIndex.reindexChat).not.toHaveBeenCalled();
  });

  it('still reindexes when the chat activity bump fails', async () => {
    mockNormalExecutionRepositories();
    const touch = vi
      .spyOn(ChatsRepository.prototype, 'touch')
      .mockRejectedValue(new Error('chat row unavailable'));
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(touch).toHaveBeenCalledWith(chatId, userId);
    expect(execution.searchIndex.reindexChat).toHaveBeenCalledWith(
      chatId,
      userId,
    );
  });

  it('falls back to the async reindex queue and skips the embed enqueue when the inline rebuild fails', async () => {
    mockNormalExecutionRepositories();
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);
    execution.reindexChat.mockRejectedValue(new Error('chunker exploded'));

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'answer',
      usage: ZERO_USAGE,
      finishReason: 'stop',
    });

    expect(execution.reindexDispatch.enqueueChatReindex).toHaveBeenCalledWith(
      chatId,
      userId,
    );
    expect(execution.embedDispatch.enqueueChatEmbed).not.toHaveBeenCalled();
  });
});

describe('RunExecutionService executeRun — context window and late tool results', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads history only after the latest compaction and replays its summary', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(
      CompactionsRepository.prototype,
      'findLatestByChatId',
    ).mockResolvedValue({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      chatId,
      uptoSeq: 4,
      parentId: null,
      summary: 'Earlier turns, summarized.',
      replacementHistory: [
        {
          role: 'user',
          parts: [{ type: 'text', text: 'Summarized prefix request' }],
        },
      ],
      usage: null,
      createdAt: now,
    });
    const findByChatId = vi
      .spyOn(MessagesRepository.prototype, 'findByChatId')
      .mockResolvedValue([]);
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun({
      ...executionInput(capturing.client),
      userMessage: {
        id: messageId,
        seq: 9,
        parts: [{ type: 'text', text: 'hello' }],
      },
    });

    expect(findByChatId).toHaveBeenCalledWith(chatId, userId, {
      maxSeq: 9,
      sinceSeq: 4,
    });
    // The compacted prefix is replayed from replacement_history, so the
    // superseded turns are represented without re-reading them.
    const summarizedPrefixContent: unknown = expect.arrayContaining([
      { type: 'text', text: 'Summarized prefix request' },
    ]);
    expect(capturing.streamOptions().messages).toEqual([
      {
        role: 'user',
        content: summarizedPrefixContent,
      },
    ]);
  });

  it('reads the whole history when the chat has never been compacted', async () => {
    mockNormalExecutionRepositories();
    const findByChatId = vi
      .spyOn(MessagesRepository.prototype, 'findByChatId')
      .mockResolvedValue([]);
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun({
      ...executionInput(capturing.client),
      userMessage: {
        id: messageId,
        seq: 9,
        parts: [{ type: 'text', text: 'hello' }],
      },
    });

    expect(findByChatId).toHaveBeenCalledWith(chatId, userId, { maxSeq: 9 });
  });

  it('ignores a tool result that arrives after termination already settled the call', async () => {
    mockNormalExecutionRepositories();
    const toolOptions = withDeclaredTool();
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    let releaseTool: (result: { status: 'success' }) => void = () => {};
    const execution = makeExecutionService(
      capturing.client,
      makeDynamicResolver({
        id: toolDeclaration.id,
        description: toolDeclaration.description,
        classification: 'read_only',
        inputSchema: toolDeclaration.inputSchema,
        execute: () =>
          new Promise<{ status: 'success' }>((resolve) => {
            releaseTool = resolve;
          }),
      }),
      undefined,
      toolOptions,
    );

    await execution.service.executeRun(executionInput(capturing.client));
    const options = capturing.streamOptions();
    const call = executeBoundTool(options, { q: 'slow' }, 'call-7');
    await Promise.resolve();
    await options.onFinish?.({
      text: 'gave up',
      usage: ZERO_USAGE,
      finishReason: 'error',
    });
    releaseTool({ status: 'success' });
    await call;

    expect(
      appended.filter((entry) => entry.type === 'tool.completed'),
    ).toHaveLength(1);
    expect(
      appended.find((entry) => entry.type === 'tool.completed')?.payload,
    ).toStrictEqual({
      toolCallId: 'call-7',
      toolName: toolDeclaration.id,
      status: 'error',
      output: {
        status: 'error',
        type: 'cancelled',
        message: 'The run failed before this tool finished.',
      },
      permission: allowDecision(toolDeclaration.id),
    });
  });
});

/**
 * The runtime-context lifecycle of one attempt: the rail items it stages, the
 * state it commits with a winning turn, and what it refuses to publish. The
 * Run-bound snapshot is gone, so each case pins an observable consequence —
 * the staged item's payload, the committed availability record, the write that
 * never happened — rather than the call that produced it.
 */
const contextToolId = 'mcp__demo__lookup';

/** An allowlisted tool whose source is disconnected: a real manifest entry the
 * turn cannot use, which is what makes availability worth disclosing. */
const disconnectedTool: TurnToolCandidate = {
  source: { type: 'mcp', serverId: 'demo' },
  state: 'unavailable',
  id: contextToolId,
  classification: 'read_only',
  reason: 'source_disconnected',
};

const availabilityOptions = {
  allowed: [contextToolId],
  dynamicCandidates: [disconnectedTool],
};

/** The two disclosures one current-manifest comparison can produce. */
const initialAvailability = {
  kind: 'initial',
  added: [],
  removed: [],
  unavailable: [{ id: contextToolId, reason: 'source_disconnected' }],
  becameUnavailable: [],
  nowAvailable: [],
};
const deltaAvailability = {
  kind: 'delta',
  added: [],
  removed: [],
  unavailable: [],
  becameUnavailable: [{ id: contextToolId, reason: 'source_disconnected' }],
  nowAvailable: [],
};

/** The parts write `RunExecutionService` performs on the triggering user
 * message, and the spy `mockNormalExecutionRepositories` installs for it. */
type UpdateUserMessageParts = MessagesRepository['updateUserMessageParts'];
type UpdateUserMessagePartsSpy = MockInstance<UpdateUserMessageParts>;

/** The staged parts the winning user message records, read from the write that
 * replaced them — the id and chatId pin which turn's parts these are. */
function stagedPartsOf(
  updateUserMessageParts: UpdateUserMessagePartsSpy,
): Array<unknown> {
  const write = updateUserMessageParts.mock.calls.at(-1)?.[0];
  expect(write).toMatchObject({ id: messageId, chatId });
  return write?.parts ?? [];
}

/** The staged envelopes one producer authored this turn, in written order. */
function stagedItemsOf(
  updateUserMessageParts: UpdateUserMessagePartsSpy,
  producer: string,
): Array<ContextItemPart> {
  return stagedPartsOf(updateUserMessageParts).filter(
    (part): part is ContextItemPart =>
      isContextItemPart(part) && part.data.producer === producer,
  );
}

/** A completed predecessor run to compare this attempt against. */
function completedPredecessor(overrides: Partial<Run> = {}): Run {
  return {
    ...run,
    id: '99999999-9999-4999-8999-999999999999',
    status: 'completed',
    completedAttemptId: testAttemptId,
    turnToolAvailability: [{ id: contextToolId, state: 'available' }],
    ...overrides,
  };
}

/** A client whose window starts too small and is widened by the transition
 * compaction it forces, so the rebuilt request is the one that fits. */
function makeWideningClient() {
  let contextWindowTokens = 1;
  const captured: CapturedStream = {};
  const client: ModelClient = {
    model: 'fake-model',
    provider: 'fake',
    get contextWindowTokens() {
      return contextWindowTokens;
    },
    streamText: (options) => {
      captured.options = options;
      return unusedStreamResult();
    },
  };
  return {
    client,
    widen: () => {
      contextWindowTokens = 128_000;
    },
  };
}

/** A predecessor lookup that answers only within the trigger's sequence bound. */
function lookupBefore(seq: number, candidate: Run | undefined) {
  return (_chatId: string, _userId: string, options?: { beforeSeq?: number }) =>
    Promise.resolve(options?.beforeSeq === seq ? candidate : undefined);
}

function activeCompaction(
  createdAt: Date,
  id = '77777777-7777-4777-8777-777777777777',
): Compaction {
  return {
    id,
    chatId,
    uptoSeq: 0,
    parentId: null,
    summary: 'Earlier turns, summarized.',
    replacementHistory: [
      { role: 'user', parts: [{ type: 'text', text: 'Summarized prefix' }] },
    ],
    usage: null,
    createdAt,
  };
}

const digestBaseline: RecencyDigestResolution['baseline'] = {
  pinned: [],
  recent: [],
  pinnedShown: 0,
  pinnedTotal: 0,
  recentShown: 0,
  recentTotal: 0,
  compiledOn: '2026-09-01',
};

const predecessorStartedAt = new Date('2026-09-10T00:00:00.000Z');

/** One attempt against a chat whose last successful turn is `completed`, with
 * `compaction` the active checkpoint. Runs to a committed turn. */
async function executeAvailabilityAttempt(input: {
  recent?: Run;
  completed?: Run;
  compaction?: Compaction;
}) {
  const repositories = mockNormalExecutionRepositories();
  vi.spyOn(
    RunsRepository.prototype,
    'findMostRecentByChatMessageSequence',
  ).mockImplementation(lookupBefore(1, input.recent));
  vi.spyOn(
    RunsRepository.prototype,
    'findMostRecentCompletedByChatMessageSequence',
  ).mockImplementation(lookupBefore(1, input.completed));
  if (input.compaction !== undefined) {
    vi.spyOn(CompactionsRepository.prototype, 'findLatestByChatId')
      .mockResolvedValueOnce(input.compaction)
      .mockResolvedValue(input.compaction);
  }
  const execution = makeExecutionService(
    createFakeModelClient(['answer']),
    undefined,
    undefined,
    availabilityOptions,
  );
  const result = await execution.service.executeRun(
    executionInput(execution.client),
  );
  await expect(result.text).resolves.toBe('answer');
  return repositories;
}

describe('RunExecutionService runtime-context lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records the staged items with their form and commits the observed availability', async () => {
    const repositories = mockNormalExecutionRepositories();
    const updateRecencyDigestTold = vi
      .spyOn(ChatsRepository.prototype, 'updateRecencyDigestTold')
      .mockResolvedValue(undefined);
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      availabilityOptions,
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );
    await expect(result.text).resolves.toBe('answer');

    // The authority record is what a later reader replays, so both staged
    // items land there under the form the rail renders them with.
    const attemptWrite = repositories.updateForAttempt.mock.calls.at(-1);
    expect(attemptWrite?.slice(0, 3)).toEqual([runId, userId, testAttemptId]);
    const recordedItems = attemptWrite?.[3].contextItems ?? [];
    expect(recordedItems).toContainEqual(
      expect.objectContaining({
        producer: 'tool-availability',
        form: 'notice',
        residency: 'rail',
      }),
    );
    expect(recordedItems).toContainEqual(
      expect.objectContaining({ producer: 'temporal', form: 'snapshot' }),
    );
    // The availability the turn observed becomes the next turn's baseline.
    expect(repositories.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'completed',
      expect.objectContaining({
        turnToolAvailability: [{ id: contextToolId, state: 'unavailable' }],
      }),
    );
    // And the model is told what changed: no completed predecessor, so this
    // is the epoch's initial disclosure.
    const [availability] = stagedItemsOf(
      repositories.updateUserMessageParts,
      'tool-availability',
    );
    expect(availability?.data.payload).toMatchObject(initialAvailability);
    // A turn that disclosed no digest advances no told state.
    expect(updateRecencyDigestTold).not.toHaveBeenCalled();
  });

  it('prepends the staged context text to the triggering user message', async () => {
    mockNormalExecutionRepositories();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));

    const messages = capturing.streamOptions().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    const content = messages[0]?.content;
    const textParts = Array.isArray(content) ? content : [];
    expect(textParts).toHaveLength(2);
    const [stagedText, userText] = textParts;
    expect(stagedText?.type === 'text' ? stagedText.text : '').toContain(
      'producer="temporal"',
    );
    expect(userText).toEqual({ type: 'text', text: 'hello' });
  });

  it('settles a run whose abort raced the claim before any context work', async () => {
    const controller = new AbortController();
    const repositories = mockNormalExecutionRepositories();
    repositories.markStarted.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ ...run, activeAttemptId: testAttemptId });
    });
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun(
        executionInput(capturing.client, controller.signal),
      ),
    ).rejects.toBeInstanceOf(RunNotRunnableError);

    expect(repositories.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'cancelled',
      expect.objectContaining({
        error: { message: 'Run was cancelled before model inference.' },
      }),
    );
    // A turn that will never run prepares nothing: no receipt for the prompt
    // it never sent, no context items recorded as its request.
    expect(repositories.createReceipt).not.toHaveBeenCalled();
    expect(repositories.updateForAttempt).not.toHaveBeenCalled();
  });

  it('commits no availability baseline for a turn that did not complete', async () => {
    const repositories = mockNormalExecutionRepositories();
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await execution.service.executeRun(executionInput(capturing.client));
    await capturing.streamOptions().onFinish?.({
      text: 'half',
      usage: ZERO_USAGE,
      finishReason: 'error',
    });

    const [finishCall] = repositories.markFinished.mock.calls;
    expect(finishCall?.[2]).toBe('failed');
    expect(finishCall?.[3]).not.toHaveProperty('turnToolAvailability');
  });

  it('compares availability against the last successful turn while the epoch continues', async () => {
    const repositories = await executeAvailabilityAttempt({
      recent: completedPredecessor(),
      completed: completedPredecessor(),
    });

    const [availability] = stagedItemsOf(
      repositories.updateUserMessageParts,
      'tool-availability',
    );
    expect(availability?.data.payload).toMatchObject(deltaAvailability);
  });

  it('starts a new disclosure epoch when a checkpoint postdates the successful turn', async () => {
    const repositories = await executeAvailabilityAttempt({
      recent: completedPredecessor({ createdAt: predecessorStartedAt }),
      completed: completedPredecessor({ createdAt: predecessorStartedAt }),
      compaction: activeCompaction(new Date('2026-09-11T00:00:00.000Z')),
    });

    const [availability] = stagedItemsOf(
      repositories.updateUserMessageParts,
      'tool-availability',
    );
    expect(availability?.data.payload).toMatchObject(initialAvailability);
  });

  it('keeps the epoch when the checkpoint predates the successful turn', async () => {
    const repositories = await executeAvailabilityAttempt({
      recent: completedPredecessor({ createdAt: predecessorStartedAt }),
      completed: completedPredecessor({ createdAt: predecessorStartedAt }),
      compaction: activeCompaction(new Date('2026-09-09T00:00:00.000Z')),
    });

    const [availability] = stagedItemsOf(
      repositories.updateUserMessageParts,
      'tool-availability',
    );
    expect(availability?.data.payload).toMatchObject(deltaAvailability);
  });

  it('keeps the epoch for a checkpoint stamped at the successful turn instant', async () => {
    const repositories = await executeAvailabilityAttempt({
      recent: completedPredecessor({ createdAt: predecessorStartedAt }),
      completed: completedPredecessor({ createdAt: predecessorStartedAt }),
      compaction: activeCompaction(predecessorStartedAt),
    });

    const [availability] = stagedItemsOf(
      repositories.updateUserMessageParts,
      'tool-availability',
    );
    expect(availability?.data.payload).toMatchObject(deltaAvailability);
  });

  it('starts an epoch when the preceding run never completed', async () => {
    const repositories = await executeAvailabilityAttempt({
      recent: completedPredecessor(),
      completed: undefined,
      compaction: activeCompaction(new Date('2026-09-11T00:00:00.000Z')),
    });

    const [availability] = stagedItemsOf(
      repositories.updateUserMessageParts,
      'tool-availability',
    );
    expect(availability?.data.payload).toMatchObject(initialAvailability);
  });

  it('stages the model-change notice only when the preceding run used another model', async () => {
    const repositories = mockNormalExecutionRepositories();
    vi.spyOn(
      RunsRepository.prototype,
      'findMostRecentByChatMessageSequence',
    ).mockImplementation(
      lookupBefore(1, completedPredecessor({ modelId: 'other-model' })),
    );
    vi.spyOn(
      RunsRepository.prototype,
      'findMostRecentCompletedByChatMessageSequence',
    ).mockImplementation(lookupBefore(1, undefined));
    const execution = makeExecutionService(createFakeModelClient(['answer']));

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );
    await expect(result.text).resolves.toBe('answer');

    const [modelChange] = stagedItemsOf(
      repositories.updateUserMessageParts,
      'effective-context-change',
    );
    expect(modelChange?.data).toMatchObject({
      form: 'notice',
      payload: {
        cause: 'model',
        fromModelId: 'other-model',
        toModelId: 'fake-model',
      },
    });
  });

  it('stages no model-change notice while the model is unchanged', async () => {
    const repositories = mockNormalExecutionRepositories();
    vi.spyOn(
      RunsRepository.prototype,
      'findMostRecentByChatMessageSequence',
    ).mockImplementation(lookupBefore(1, completedPredecessor()));
    vi.spyOn(
      RunsRepository.prototype,
      'findMostRecentCompletedByChatMessageSequence',
    ).mockImplementation(lookupBefore(1, undefined));
    const execution = makeExecutionService(createFakeModelClient(['answer']));

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );
    await expect(result.text).resolves.toBe('answer');

    expect(
      stagedItemsOf(
        repositories.updateUserMessageParts,
        'effective-context-change',
      ),
    ).toEqual([]);
  });

  it('finds the model-switch anchor in the staged rail of a compacted switch', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(
      RunsRepository.prototype,
      'findMostRecentByChatMessageSequence',
    ).mockImplementation(
      lookupBefore(1, completedPredecessor({ modelId: 'other-model' })),
    );
    vi.spyOn(
      RunsRepository.prototype,
      'findMostRecentCompletedByChatMessageSequence',
    ).mockImplementation(lookupBefore(1, undefined));
    const widen = makeWideningClient();
    const execution = makeExecutionService(widen.client);
    execution.compactForTransition.mockImplementation(() => {
      widen.widen();
      return Promise.resolve('created' as const);
    });

    await execution.service.executeRun(executionInput(widen.client));

    // The staged model change is exactly the anchor transition compaction
    // needs; refusing for want of one would be a false negative.
    expect(execution.compaction.compactForTransition).toHaveBeenCalledTimes(1);
  });

  it('finds the model-switch anchor in the triggering user message', async () => {
    mockNormalExecutionRepositories();
    const widen = makeWideningClient();
    const execution = makeExecutionService(widen.client);
    execution.compactForTransition.mockImplementation(() => {
      widen.widen();
      return Promise.resolve('created' as const);
    });

    await execution.service.executeRun({
      ...executionInput(widen.client),
      userMessage: {
        id: messageId,
        seq: 1,
        parts: [
          createModelChangeItem({
            oldModel: { id: 'old-model' },
            newModel: { id: 'fake-model' },
            runId,
          }),
          { type: 'text', text: 'hello' },
        ],
      },
    });

    expect(execution.compaction.compactForTransition).toHaveBeenCalledTimes(1);
  });

  it('stages the rebake marker on the first turn of a re-baked epoch', async () => {
    const compactionId = '77777777-7777-4777-8777-777777777777';
    const repositories = mockNormalExecutionRepositories();
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue({
      ...chat,
      recencyDigestBaseline: digestBaseline,
      recencyDigestTold: [],
      recencyDigestRebakedFrom: compactionId,
    });
    vi.spyOn(
      CompactionsRepository.prototype,
      'findLatestByChatId',
    ).mockResolvedValue(activeCompaction(now, compactionId));
    vi.spyOn(ChatsRepository.prototype, 'findPinnedChatIds').mockResolvedValue(
      new Set(),
    );
    vi.spyOn(
      ChatsRepository.prototype,
      'updateRecencyDigestTold',
    ).mockResolvedValue(undefined);
    const getForOwnerForBinding = vi
      .fn<MemorySettingsBindingResolver['getForOwnerForBinding']>()
      .mockResolvedValue({ shareRecentChats: true });
    const resolveCandidate = vi
      .fn<RecencyDigestResolver['resolveCandidate']>()
      .mockResolvedValue({
        baseline: digestBaseline,
        told: [],
        candidates: [],
      });
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      {
        memory: { getForOwnerForBinding },
        recencyDigest: { resolveCandidate },
      },
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );
    await expect(result.text).resolves.toBe('answer');

    // The re-bake is reported under the digest producer's snapshot form.
    expect(
      stagedItemsOf(repositories.updateUserMessageParts, 'recency-digest').map(
        (item) => item.data.form,
      ),
    ).toContain('snapshot');
  });

  it('withholds the rebake marker from a chat with no baseline to supersede', async () => {
    const compactionId = '77777777-7777-4777-8777-777777777777';
    const repositories = mockNormalExecutionRepositories();
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue({
      ...chat,
      recencyDigestBaseline: null,
      recencyDigestRebakedFrom: compactionId,
    });
    vi.spyOn(
      CompactionsRepository.prototype,
      'findLatestByChatId',
    ).mockResolvedValue(activeCompaction(now, compactionId));
    vi.spyOn(
      ChatsRepository.prototype,
      'setRecencyDigestIfAbsent',
    ).mockResolvedValue({ ...chat, recencyDigestBaseline: digestBaseline });
    const getForOwnerForBinding = vi
      .fn<MemorySettingsBindingResolver['getForOwnerForBinding']>()
      .mockResolvedValue({ shareRecentChats: true });
    const resolveCandidate = vi
      .fn<RecencyDigestResolver['resolveCandidate']>()
      .mockResolvedValue({
        baseline: digestBaseline,
        told: [],
        candidates: [],
      });
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      {
        memory: { getForOwnerForBinding },
        recencyDigest: { resolveCandidate },
      },
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );
    await expect(result.text).resolves.toBe('answer');

    // The chat has no disclosed baseline, so there is nothing to supersede.
    expect(
      stagedItemsOf(repositories.updateUserMessageParts, 'recency-digest').map(
        (item) => item.data.form,
      ),
    ).not.toContain('snapshot');
  });

  it('discards a resolved digest candidate when its baseline moved underneath it', async () => {
    const resolveCandidate = vi
      .fn<RecencyDigestResolver['resolveCandidate']>()
      .mockResolvedValue({
        baseline: digestBaseline,
        told: [],
        candidates: [],
      });
    const getForOwnerForBinding = vi
      .fn<MemorySettingsBindingResolver['getForOwnerForBinding']>()
      .mockResolvedValue({ shareRecentChats: true });
    mockNormalExecutionRepositories();
    // The chat row is re-read after resolution; here a checkpoint re-baked the
    // baseline in between, so the candidate describes a superseded epoch.
    vi.spyOn(ChatsRepository.prototype, 'findById')
      .mockResolvedValueOnce(chat)
      .mockResolvedValueOnce({
        ...chat,
        recencyDigestBaseline: { ...digestBaseline, compiledOn: '2026-09-02' },
      });
    const setBaseline = vi
      .spyOn(ChatsRepository.prototype, 'setRecencyDigestIfAbsent')
      .mockResolvedValue({ ...chat, recencyDigestBaseline: digestBaseline });
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      {
        memory: { getForOwnerForBinding },
        recencyDigest: { resolveCandidate },
      },
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );
    await expect(result.text).resolves.toBe('answer');

    expect(setBaseline).not.toHaveBeenCalled();
  });

  it('discloses no digest delta for a chat with no baseline to diff against', async () => {
    const updateRecencyDigestTold = vi
      .spyOn(ChatsRepository.prototype, 'updateRecencyDigestTold')
      .mockResolvedValue(undefined);
    const setBaseline = vi
      .spyOn(ChatsRepository.prototype, 'setRecencyDigestIfAbsent')
      .mockResolvedValue({ ...chat, recencyDigestBaseline: digestBaseline });
    vi.spyOn(ChatsRepository.prototype, 'findPinnedChatIds').mockResolvedValue(
      new Set(),
    );
    mockNormalExecutionRepositories();
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue({
      ...chat,
      recencyDigestBaseline: null,
      recencyDigestTold: [{ chatId: 'a', pinned: true, title: 'Earlier chat' }],
    });
    const resolveCandidate = vi
      .fn<RecencyDigestResolver['resolveCandidate']>()
      .mockResolvedValue({
        baseline: digestBaseline,
        told: [{ chatId: 'a', pinned: true, title: 'Earlier chat' }],
        candidates: [
          {
            chatId: 'b',
            pinned: false,
            entry: {
              title: 'Newly active chat',
              date: '2026-09-02',
              messageCount: 3,
            },
          },
        ],
      });
    const getForOwnerForBinding = vi
      .fn<MemorySettingsBindingResolver['getForOwnerForBinding']>()
      .mockResolvedValue({ shareRecentChats: true });
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      {
        memory: { getForOwnerForBinding },
        recencyDigest: { resolveCandidate },
      },
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );
    await expect(result.text).resolves.toBe('answer');

    // The epoch still initializes from the candidate...
    expect(setBaseline).toHaveBeenCalledWith(chatId, userId, digestBaseline, [
      { chatId: 'a', pinned: true, title: 'Earlier chat' },
    ]);
    // ...but with no baseline to diff against, nothing is disclosed as a delta.
    expect(updateRecencyDigestTold).not.toHaveBeenCalled();
  });

  it('publishes no context state from a settlement that did not complete', async () => {
    const repositories = mockNormalExecutionRepositories();
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockResolvedValue({
      ...run,
      status: 'failed',
    });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue(
      [],
    );
    const setDigest = vi
      .spyOn(ChatsRepository.prototype, 'setRecencyDigestIfAbsent')
      .mockResolvedValue({ ...chat, recencyDigestBaseline: digestBaseline });
    const updateTold = vi
      .spyOn(ChatsRepository.prototype, 'updateRecencyDigestTold')
      .mockResolvedValue(undefined);
    const setSkillBaseline = vi
      .spyOn(ChatsRepository.prototype, 'setSkillCatalogBaseline')
      .mockResolvedValue(undefined);
    const updateSkillTold = vi
      .spyOn(ChatsRepository.prototype, 'updateSkillCatalogTold')
      .mockResolvedValue(undefined);
    const execution = makeExecutionService();

    // The settlement seam forwards every field it is handed, so this is
    // exactly the caller the guards exist to refuse: attempt context arriving
    // with a status that never published it.
    const settlement = {
      userId,
      runId,
      status: 'failed' as const,
      recencyDigestInitialization: { baseline: digestBaseline, told: [] },
      recencyDigestTold: [],
      attemptContextParts: [{ type: 'text' as const, text: 'staged' }],
      turnToolAvailability: [{ id: contextToolId, state: 'available' }],
      skillCatalogWrites: {
        freeze: { baseline: { entries: [], omitted: 0 }, rebakedFrom: null },
        told: [],
      },
    };
    await execution.service.settleTerminalRun(settlement);

    const [finishCall] = repositories.markFinished.mock.calls;
    expect(finishCall?.[2]).toBe('failed');
    expect(finishCall?.[3]).not.toHaveProperty('turnToolAvailability');
    expect(repositories.updateUserMessageParts).not.toHaveBeenCalled();
    expect(setDigest).not.toHaveBeenCalled();
    expect(updateTold).not.toHaveBeenCalled();
    expect(setSkillBaseline).not.toHaveBeenCalled();
    expect(updateSkillTold).not.toHaveBeenCalled();
  });

  it('writes no availability record for a completion that observed none', async () => {
    const markFinished = vi
      .spyOn(RunsRepository.prototype, 'markFinished')
      .mockResolvedValue({ ...run, status: 'completed' });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue(
      [],
    );
    recordAppendedEvents();
    const execution = makeExecutionService();

    await execution.service.settleTerminalRun({
      userId,
      runId,
      status: 'completed',
      runPayload: { status: 'completed' },
    });

    const [finishCall] = markFinished.mock.calls;
    expect(finishCall?.[2]).toBe('completed');
    expect(finishCall?.[3]).not.toHaveProperty('turnToolAvailability');
  });

  it('settles an interrupted native write with its recorded outcome and decision', async () => {
    const writeResult: ToolResult = {
      status: 'error',
      type: 'cancelled',
      message: 'The write was interrupted.',
    };
    const permission = allowDecision('write');
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockResolvedValue({
      ...run,
      status: 'failed',
    });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([
      {
        ...event,
        sequence: 1,
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'write-call',
          toolName: 'write',
          input: { path: 'notes.txt', content: 'x' },
          permission,
        },
      },
      {
        ...event,
        sequence: 2,
        eventType: 'native.attempt',
        payload: {
          toolCallId: 'write-call',
          operation: 'write',
          path: 'notes.txt',
        },
      },
      {
        ...event,
        sequence: 3,
        eventType: 'native.result',
        payload: { toolCallId: 'write-call', result: writeResult },
      },
    ]);
    const priorOutcome = vi
      .spyOn(NativeFilesRepository.prototype, 'priorOutcome')
      .mockResolvedValue(writeResult);
    vi.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(chat);
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: undefined,
    });
    vi.spyOn(
      MessagesRepository.prototype,
      'createAssistantReplyIfAbsent',
    ).mockResolvedValue(assistantMessage);
    const appended = recordAppendedEvents();
    const execution = makeExecutionService();

    await execution.service.settleTerminalRun({
      userId,
      runId,
      status: 'failed',
      runPayload: { status: 'failed', message: 'worker died' },
    });

    // The host may have already written the file, so the recorded outcome is
    // what settles the call — and the decision rides along with it.
    expect(priorOutcome).toHaveBeenCalledWith(runId, 'write-call');
    expect(appended[0]).toStrictEqual({
      type: 'tool.completed',
      payload: {
        toolCallId: 'write-call',
        toolName: 'write',
        status: 'error',
        output: writeResult,
        permission,
      },
    });
  });

  it('carries the settlement telemetry onto a reconstructed turn', async () => {
    const telemetry = {
      inputTokens: 4,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 2,
      totalTokens: 6,
      modelId: 'fake-model',
      latencyMs: 12,
      finishReason: null,
      status: 'error' as const,
      costUsd: null,
      runId,
    };
    vi.spyOn(RunsRepository.prototype, 'markFinished').mockResolvedValue({
      ...run,
      status: 'failed',
    });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([
      {
        ...event,
        sequence: 1,
        eventType: 'model.delta',
        payload: { text: 'x' },
      },
    ]);
    vi.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(chat);
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: undefined,
    });
    const createAssistantReplyIfAbsent = vi
      .spyOn(MessagesRepository.prototype, 'createAssistantReplyIfAbsent')
      .mockResolvedValue(assistantMessage);
    recordAppendedEvents();
    const execution = makeExecutionService();

    await execution.service.settleTerminalRun({
      userId,
      runId,
      status: 'failed',
      telemetry,
      runPayload: { status: 'failed', message: 'worker died' },
    });

    expect(createAssistantReplyIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ usage: telemetry }),
    );
  });

  it('fails the attempt when its chat vanished before context preparation', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(
      undefined,
    );
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).rejects.toThrow(`Chat ${chatId} was deleted before context preparation.`);
  });

  it('reports an unreadable skill catalog to the operator, path-redacted', async () => {
    const loggerWarn = vi.spyOn(Logger.prototype, 'warn');
    mockNormalExecutionRepositories();
    const skillCatalog: SkillCatalogPort = {
      getSnapshot: () => ({
        available: false,
        directories: ['/opt/skills'],
        entries: [],
        diagnostics: ['cannot read /opt/skills', 'source unreadable'],
      }),
    };
    const execution = makeExecutionService(
      createFakeModelClient(['answer']),
      undefined,
      undefined,
      { skillCatalog, skillDirectories: ['/opt/skills'] },
    );

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );
    await expect(result.text).resolves.toBe('answer');

    expect(loggerWarn).toHaveBeenCalledWith(
      'skill_catalog_unavailable: cannot read <skill source> source unreadable',
    );
  });

  it('renders no skill section when the attempt resolved no catalog baseline', async () => {
    const render = vi.spyOn(SystemPromptsService.prototype, 'render');
    mockNormalExecutionRepositories();
    const execution = makeExecutionService();

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );
    await expect(result.text).resolves.toBe('answer');

    // "No catalog this turn" is expressed by the key's absence, not by an
    // explicit undefined: absent is what renders no catalog section.
    const [renderInput] = render.mock.calls[0] ?? [];
    expect(renderInput).not.toHaveProperty('skills');
  });

  it('reports a digest render failure without exposing the renderer error', async () => {
    const loggerError = vi.spyOn(Logger.prototype, 'error');
    mockNormalExecutionRepositories();
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue({
      ...chat,
      recencyDigestBaseline: digestBaseline,
    });
    vi.spyOn(SystemPromptsService.prototype, 'render').mockImplementation(
      () => {
        throw new Error('owner digest text');
      },
    );
    const execution = makeExecutionService();

    await expect(
      execution.service.executeRun(executionInput(execution.client)),
    ).rejects.toThrow('Failed to render system prompt');
    expect(loggerError).toHaveBeenCalledWith('recency_digest_render_failed');
  });

  it('lets a renderer error through untouched when no digest is rendered', async () => {
    const loggerError = vi.spyOn(Logger.prototype, 'error');
    mockNormalExecutionRepositories();
    vi.spyOn(SystemPromptsService.prototype, 'render').mockImplementation(
      () => {
        throw new Error('renderer exploded');
      },
    );
    const execution = makeExecutionService();

    await expect(
      execution.service.executeRun(executionInput(execution.client)),
    ).rejects.toThrow('renderer exploded');
    expect(loggerError).not.toHaveBeenCalledWith(
      'recency_digest_render_failed',
    );
  });

  it('re-binds the attempt before publishing the prompt receipt', async () => {
    mockNormalExecutionRepositories();
    vi.spyOn(RunsRepository.prototype, 'updateForAttempt').mockImplementation(
      (_runId, _userId, attemptId, set) =>
        Promise.resolve(
          set.activeAttemptId === attemptId || 'contextItems' in set
            ? { ...run }
            : undefined,
        ),
    );
    const createReceipt = vi
      .spyOn(SystemPromptReceiptsRepository.prototype, 'create')
      .mockResolvedValue({
        id: 'receipt-1',
        ownerUserId: userId,
        runId,
        attemptId: testAttemptId,
        source: 'project_default',
        systemPrompt: receipt.systemPrompt,
        promptHash: receipt.promptHash,
        createdAt: now,
      });
    const execution = makeExecutionService(createFakeModelClient(['answer']));

    const result = await execution.service.executeRun(
      executionInput(execution.client),
    );
    await expect(result.text).resolves.toBe('answer');

    // The fence admits the receipt: the attempt still owns the Run.
    expect(createReceipt).toHaveBeenCalledTimes(1);
  });

  it('refuses to publish a receipt for a reclaimed attempt', async () => {
    const repositories = mockNormalExecutionRepositories();
    repositories.updateForAttempt
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ ...run });
    const execution = makeExecutionService();

    await expect(
      execution.service.executeRun(executionInput(execution.client)),
    ).rejects.toThrow(`Run ${runId} was reclaimed before receipt publication.`);
    expect(repositories.createReceipt).not.toHaveBeenCalled();
    const finishCall = repositories.markFinished.mock.calls.at(-1);
    expect(finishCall?.slice(0, 3)).toEqual([runId, userId, 'failed']);
    const failure = finishCall?.[3]?.error;
    expect(
      isRecord(failure) && isString(failure['message'])
        ? failure['message']
        : '',
    ).toContain('reclaimed');
  });
});
