import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { type Chat, type Message, type Run } from '../db/schema';
import {
  type Db,
  TenantDbService,
  type TenantRunner,
} from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import {
  type MemorySettingsBindingResolver,
  type MemorySettingsResolver,
} from '../memory/memory.service';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { type ModelSelectionValidator } from '../models/models.service';
import { type PromptUserResolver } from '../personalization/personalization.service';
import { type RunAborter } from '../runs/run-abort-registry';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { stuckRunThresholdMs } from '../runs/run-queues';
import { type RunStreamResponder } from '../runs/run-stream-bridge';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { TOOL_REGISTRY } from '../tools/registry';
import {
  ChatLoopService,
  isInflightUniqueViolation,
} from './chat-loop.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import { type RecencyDigestResolver } from './recency-digest.service';

const model: SystemModelCatalogEntry = {
  id: 'system:openai:gpt-5.4-mini',
  source: 'system',
  contextWindowTokens: 128_000,
  provider: 'openai',
  providerModelId: 'gpt-5.4-mini',
  systemPromptTemplate: 'Bound prompt',
  systemPromptSource: 'model_override',
};

const now = new Date('2026-09-03T00:00:00.000Z');

const chat: Chat = {
  id: 'chat-id',
  ownerUserId: 'user-id',
  title: null,
  visibility: 'private',
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
};

const userMessage: Message = {
  id: 'message-id',
  chatId: chat.id,
  seq: 1,
  role: 'user',
  senderUserId: chat.ownerUserId,
  parts: [{ type: 'text', text: 'hello' }],
  attachments: [],
  usage: null,
  inReplyTo: null,
  createdAt: now,
};

const run: Run = {
  id: 'run-id',
  chatId: chat.id,
  messageId: userMessage.id,
  userId: chat.ownerUserId,
  modelId: model.id,
  modelContextSnapshotId: 'snapshot-id',
  status: 'queued',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  contextItems: null,
  createdAt: now,
  startedAt: null,
  finishedAt: null,
  effort: null,
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

const input = {
  chatId: chat.id,
  userId: chat.ownerUserId,
  modelId: model.id,
  message: {
    id: userMessage.id,
    parts: [{ type: 'text' as const, text: 'hello' }],
  },
};

/** The one capability ChatLoopService uses on the transaction handle. */
type Savepoint = {
  transaction: <T>(callback: (inner: Db) => Promise<T>) => Promise<T>;
};

function fakeTx(): Db {
  const savepoint: Savepoint = { transaction: (callback) => callback(tx) };
  // SAFETY: ChatLoopService only uses tx.transaction as a savepoint around
  // RunsRepository.create; every repository method is prototype-spied.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const tx = savepoint as Db;
  return tx;
}

function makeService(options?: {
  memory?: MemorySettingsResolver & MemorySettingsBindingResolver;
  recencyDigest?: RecencyDigestResolver;
  streamResponse?: Response;
}) {
  const tx = fakeTx();
  const tenantDb: TenantRunner = new TenantDbService({
    transaction: async <T>(callback: (inner: Db) => Promise<T>) => callback(tx),
  });
  const runAs = vi
    .spyOn(tenantDb, 'runAs')
    .mockImplementation(
      async <T>(_userId: string, callback: (db: Db) => Promise<T>) =>
        callback(tx),
    );
  const validateModelSelection = vi.fn(() => model);
  const resolveEffortSelection = vi.fn(() => undefined);
  const modelsService: ModelSelectionValidator = {
    validateModelSelection,
    resolveEffortSelection,
  };
  const instanceConfig: InstanceConfigReader = { config: BUILT_IN_DEFAULTS };
  const streamResponse = options?.streamResponse ?? new Response('stream');
  const createUiMessageStreamResponse = vi.fn(() => streamResponse);
  const bridge: RunStreamResponder = { createUiMessageStreamResponse };
  const abort = vi.fn();
  const aborts: RunAborter = { abort };
  const dispatchRun = vi.fn(async () => {});
  const dispatch: RunDispatcher = { dispatch: dispatchRun };
  const personalization: PromptUserResolver = {
    resolvePromptUser: () => Promise.resolve(undefined),
  };
  const memory: MemorySettingsResolver & MemorySettingsBindingResolver =
    options?.memory ?? {
      getForOwner: () => Promise.resolve({ shareRecentChats: false }),
      getForOwnerForBinding: () => Promise.resolve({ shareRecentChats: false }),
    };
  const recencyDigest: RecencyDigestResolver = options?.recencyDigest ?? {
    resolveCandidate: () => Promise.reject(new Error('unexpected digest read')),
  };
  const snapshotCandidates = vi.fn(() => []);

  const findById = vi
    .spyOn(ChatsRepository.prototype, 'findById')
    .mockResolvedValue(chat);
  const createIfAbsent = vi
    .spyOn(ChatsRepository.prototype, 'createIfAbsent')
    .mockResolvedValue(chat);
  const touch = vi
    .spyOn(ChatsRepository.prototype, 'touch')
    .mockResolvedValue(chat);
  const updateRecencyDigestTold = vi
    .spyOn(ChatsRepository.prototype, 'updateRecencyDigestTold')
    .mockResolvedValue(undefined);
  vi.spyOn(ChatsRepository.prototype, 'findPinnedChatIds').mockResolvedValue(
    new Set(),
  );
  vi.spyOn(
    ChatsRepository.prototype,
    'setRecencyDigestIfAbsent',
  ).mockResolvedValue(chat);
  vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
    userMessage: undefined,
    assistantMessage: undefined,
  });
  const createUserMessageIfAbsent = vi
    .spyOn(MessagesRepository.prototype, 'createUserMessageIfAbsent')
    .mockResolvedValue(userMessage);
  vi.spyOn(
    CompactionsRepository.prototype,
    'findLatestByChatId',
  ).mockResolvedValue(undefined);
  vi.spyOn(SystemPromptsService.prototype, 'render').mockReturnValue(
    'Bound prompt',
  );
  const findActiveByChatId = vi
    .spyOn(RunsRepository.prototype, 'findActiveByChatId')
    .mockResolvedValue(undefined);
  const cancelActiveRunsForMessage = vi
    .spyOn(RunsRepository.prototype, 'cancelActiveRunsForMessage')
    .mockResolvedValue([]);
  const markFinished = vi
    .spyOn(RunsRepository.prototype, 'markFinished')
    .mockResolvedValue(run);
  vi.spyOn(
    RunsRepository.prototype,
    'findMostRecentByChatMessageSequence',
  ).mockResolvedValue(undefined);
  const createRun = vi
    .spyOn(RunsRepository.prototype, 'create')
    .mockImplementation((runInput) =>
      Promise.resolve({
        ...run,
        id: runInput.id ?? run.id,
        chatId: runInput.chatId,
        messageId: runInput.messageId,
        userId: runInput.userId,
        modelId: runInput.modelId,
        modelContextSnapshotId: runInput.modelContextSnapshotId,
        effort: runInput.effort ?? null,
      }),
    );
  const appendEvent = vi
    .spyOn(RunEventsRepository.prototype, 'append')
    .mockResolvedValue({
      sequence: 1,
      runId: run.id,
      eventType: 'run.created',
      payload: null,
      createdAt: now,
    });
  vi.spyOn(
    ModelContextSnapshotsRepository.prototype,
    'findByOwnedRun',
  ).mockResolvedValue(undefined);
  vi.spyOn(
    ModelContextSnapshotsRepository.prototype,
    'createOrReuse',
  ).mockResolvedValue({
    id: 'snapshot-id',
    ownerUserId: chat.ownerUserId,
    availabilityHash: 'availability-hash',
    contentHash: 'content-hash',
    promptHash: 'prompt-hash',
    toolHash: 'tool-hash',
    source: 'model_override',
    systemPrompt: 'Bound prompt',
    toolAvailabilityManifest: { version: 1, entries: [] },
    toolDeclarations: [],
    createdAt: now,
  });

  const service = new ChatLoopService(
    tenantDb,
    modelsService,
    instanceConfig,
    bridge,
    aborts,
    dispatch,
    personalization,
    new SystemPromptsService(),
    { snapshotCandidates },
    memory,
    recencyDigest,
    knowledgeCandidates,
  );

  return {
    service,
    runAs,
    abort,
    dispatchRun,
    createUiMessageStreamResponse,
    streamResponse,
    findById,
    createIfAbsent,
    touch,
    updateRecencyDigestTold,
    createUserMessageIfAbsent,
    findActiveByChatId,
    cancelActiveRunsForMessage,
    markFinished,
    createRun,
    appendEvent,
    snapshotCandidates,
    recencyDigest,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('isInflightUniqueViolation', () => {
  it('accepts a 23505 whose constraint or message names the inflight index', () => {
    expect(
      isInflightUniqueViolation({
        code: '23505',
        constraint_name: 'runs_chat_inflight_unique',
      }),
    ).toBe(true);
    expect(
      isInflightUniqueViolation({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "runs_chat_inflight_unique"',
      }),
    ).toBe(true);
  });

  it('keeps walking drizzle wrappers and array-shaped cause links', () => {
    expect(
      isInflightUniqueViolation({
        cause: {
          code: '23505',
          constraint_name: 'runs_chat_inflight_unique',
        },
      }),
    ).toBe(true);
    const arrayLink = Object.assign(['ignored'], {
      cause: {
        code: '23505',
        constraint_name: 'runs_chat_inflight_unique',
      },
    });
    expect(isInflightUniqueViolation({ cause: arrayLink })).toBe(true);
  });

  it('rejects missing index mention, the wrong sqlstate, and non-objects', () => {
    expect(
      isInflightUniqueViolation({
        code: '23505',
        constraint_name: 'messages_id_chat_id_unique_idx',
        message: 'duplicate key',
      }),
    ).toBe(false);
    expect(
      isInflightUniqueViolation({
        code: '23503',
        constraint_name: 'runs_chat_inflight_unique',
      }),
    ).toBe(false);
    expect(isInflightUniqueViolation(null)).toBe(false);
    expect(isInflightUniqueViolation('23505')).toBe(false);
    expect(isInflightUniqueViolation(undefined)).toBe(false);
  });
});

describe('ChatLoopService.acceptMessage', () => {
  it('returns durable identities after dispatch without opening a UI stream', async () => {
    const f = makeService();
    const accepted = await f.service.acceptMessage(input);
    expect(accepted).toEqual({ runId: run.id, chatId: chat.id, messageId: userMessage.id });
    expect(f.dispatchRun).toHaveBeenCalledTimes(1);
    expect(f.createUiMessageStreamResponse).not.toHaveBeenCalled();
    expect(f.createUserMessageIfAbsent).toHaveBeenCalledTimes(1);
  });

  it('does not claim acceptance when dispatch fails and never attaches a stream', async () => {
    const f = makeService(); f.dispatchRun.mockRejectedValueOnce(new Error('dispatch unavailable'));
    await expect(f.service.acceptMessage(input)).rejects.toThrow('dispatch unavailable');
    expect(f.createUiMessageStreamResponse).not.toHaveBeenCalled();
  });
});

describe('ChatLoopService.createMessageStream', () => {
  it('rejects a message that sanitizes to no text parts with the exact 400', async () => {
    const { service, runAs } = makeService();

    await expect(
      service.createMessageStream({
        ...input,
        message: {
          ...input.message,
          parts: [{ type: 'data-context', data: { v: 1 } }],
        },
      }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'Message must contain a text part',
    });
    expect(runAs).not.toHaveBeenCalled();
  });

  it('persists, dispatches, and answers with the bridge stream for a new chat', async () => {
    const { service, findById, createIfAbsent, touch, dispatchRun, abort } =
      makeService();
    findById.mockResolvedValueOnce(undefined);
    createIfAbsent.mockResolvedValue(chat);

    const stream = await service.createMessageStream(input);
    const response = stream.toUIMessageStreamResponse();

    expect(createIfAbsent).toHaveBeenCalledWith({
      id: chat.id,
      ownerUserId: chat.ownerUserId,
    });
    expect(touch).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(dispatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: chat.id,
        userId: chat.ownerUserId,
        modelId: model.id,
        userMessage: {
          id: userMessage.id,
          seq: 1,
          parts: [{ type: 'text', text: 'hello' }],
        },
      }),
    );
    expect(response).toBeInstanceOf(Response);
  });

  it('touches a pre-existing chat and aborts superseded retries after commit', async () => {
    const stale: Run = { ...run, id: 'stale-run' };
    const { service, touch, abort, cancelActiveRunsForMessage } = makeService();
    cancelActiveRunsForMessage.mockResolvedValue([stale]);

    await service.createMessageStream(input);

    expect(touch).toHaveBeenCalledWith(chat.id, chat.ownerUserId);
    expect(abort).toHaveBeenCalledWith('stale-run');
  });

  it('re-queries a racing first insert and 404s a cross-tenant id without leaking it', async () => {
    const { service, findById, createIfAbsent } = makeService();
    findById.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    createIfAbsent.mockResolvedValue(undefined);

    await expect(service.createMessageStream(input)).rejects.toMatchObject({
      constructor: NotFoundException,
      message: `Chat ${chat.id} not found`,
    });
  });

  it('adopts a chat that appears after a createIfAbsent conflict', async () => {
    const { service, findById, createIfAbsent, touch } = makeService();
    findById.mockResolvedValueOnce(undefined).mockResolvedValueOnce(chat);
    createIfAbsent.mockResolvedValue(undefined);

    await service.createMessageStream(input);

    expect(touch).toHaveBeenCalledWith(chat.id, chat.ownerUserId);
  });

  it('refuses a reused message id before writing a run', async () => {
    const { service, createRun } = makeService();
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage,
      assistantMessage: undefined,
    });

    await expect(service.createMessageStream(input)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Message id already exists',
    });
    expect(createRun).not.toHaveBeenCalled();
  });

  it('refuses a reused id that already has an assistant reply', async () => {
    const { service } = makeService();
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage: undefined,
      assistantMessage: { ...userMessage, role: 'assistant', id: 'asst' },
    });

    await expect(service.createMessageStream(input)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Message id already exists',
    });
  });

  it('fails closed on a malformed persisted part that is not an object', async () => {
    const { service, createUserMessageIfAbsent } = makeService();
    createUserMessageIfAbsent.mockResolvedValue({
      ...userMessage,
      parts: ['not-an-object'],
    });

    await expect(service.createMessageStream(input)).rejects.toThrow(
      'Malformed message part: expected an object',
    );
  });

  it('resolves a recency digest only when the owner has opted in', async () => {
    const resolveCandidate = vi.fn(() =>
      Promise.resolve({
        baseline: {
          pinned: [],
          recent: [],
          pinnedShown: 0,
          pinnedTotal: 0,
          recentShown: 0,
          recentTotal: 0,
          compiledOn: '2026-09-03T00:00:00.000Z',
        },
        told: [],
        candidates: [],
      }),
    );
    const { service } = makeService({
      memory: {
        getForOwner: () => Promise.resolve({ shareRecentChats: true }),
        getForOwnerForBinding: () =>
          Promise.resolve({ shareRecentChats: true }),
      },
      recencyDigest: { resolveCandidate },
    });

    await service.createMessageStream(input);

    expect(resolveCandidate).toHaveBeenCalledWith(chat.ownerUserId, chat.id);
  });

  it('swallows digest resolution failures without exposing corpus text', async () => {
    const error = vi.spyOn(Logger.prototype, 'error');
    const { service } = makeService({
      memory: {
        getForOwner: () => Promise.resolve({ shareRecentChats: true }),
        getForOwnerForBinding: () =>
          Promise.resolve({ shareRecentChats: false }),
      },
      recencyDigest: {
        resolveCandidate: () => Promise.reject(new Error('secret excerpt')),
      },
    });

    await service.createMessageStream(input);

    expect(error).toHaveBeenCalledWith('recency_digest_resolution_failed');
    expect(error.mock.calls.flat().join(' ')).not.toContain('secret excerpt');
  });

  it('does not persist a digest told-set when this turn disclosed no delta', async () => {
    const { service, updateRecencyDigestTold } = makeService();

    await service.createMessageStream(input);

    expect(updateRecencyDigestTold).not.toHaveBeenCalled();
  });

  it('persists the disclosed digest told-set with the user message', async () => {
    const baseline = {
      pinned: [],
      recent: [],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-08-13',
    };
    const chatWithDigest: Chat = {
      ...chat,
      recencyDigestBaseline: baseline,
      recencyDigestTold: [],
    };
    const told = [
      {
        chatId: 'resurfaced',
        pinned: false,
        title: 'Resurfaced through activity',
      },
    ];
    const { service, findById, touch, updateRecencyDigestTold } = makeService({
      memory: {
        getForOwner: () => Promise.resolve({ shareRecentChats: true }),
        getForOwnerForBinding: () =>
          Promise.resolve({ shareRecentChats: true }),
      },
      recencyDigest: {
        resolveCandidate: () =>
          Promise.resolve({
            baseline: {
              ...baseline,
              recent: [
                {
                  title: 'Resurfaced through activity',
                  date: '2026-08-13',
                  messageCount: 2,
                  excerpt: 'opening',
                },
              ],
              recentShown: 1,
              recentTotal: 1,
            },
            told,
            candidates: [
              {
                chatId: 'resurfaced',
                pinned: false,
                entry: {
                  title: 'Resurfaced through activity',
                  date: '2026-08-13',
                  messageCount: 2,
                  excerpt: 'opening',
                },
              },
            ],
          }),
      },
    });
    findById.mockResolvedValue(chatWithDigest);
    touch.mockResolvedValue(chatWithDigest);

    await service.createMessageStream(input);

    expect(updateRecencyDigestTold).toHaveBeenCalledWith(
      chat.id,
      chat.ownerUserId,
      told,
    );
  });

  it('conflicts when createUserMessageIfAbsent loses the insert race', async () => {
    const { service, createUserMessageIfAbsent } = makeService();
    createUserMessageIfAbsent.mockResolvedValue(undefined);

    await expect(service.createMessageStream(input)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Message id already exists',
    });
  });

  it('records run.cancelled for defensively superseded active retries', async () => {
    const stale: Run = { ...run, id: 'stale-run' };
    const { service, cancelActiveRunsForMessage, appendEvent } = makeService();
    cancelActiveRunsForMessage.mockResolvedValue([stale]);

    await service.createMessageStream(input);

    expect(appendEvent).toHaveBeenCalledWith(stale.id, 'run.cancelled', {
      reason: 'superseded by retry',
    });
    expect(appendEvent).toHaveBeenCalledWith(
      expect.any(String),
      'run.created',
      {
        chatId: chat.id,
        messageId: userMessage.id,
      },
    );
  });

  it('maps a single-flight unique violation onto the inflight 409', async () => {
    const { service, createRun } = makeService();
    createRun.mockRejectedValue({
      code: '23505',
      constraint_name: 'runs_chat_inflight_unique',
    });

    await expect(service.createMessageStream(input)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Another run is already in flight for this chat',
    });
  });

  it('rethrows a non-inflight create error', async () => {
    const { service, createRun } = makeService();
    createRun.mockRejectedValue(new Error('disk full'));

    await expect(service.createMessageStream(input)).rejects.toThrow(
      'disk full',
    );
  });

  it('expires a stuck in-flight run and appends run.expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const stuckAfterMs = stuckRunThresholdMs(BUILT_IN_DEFAULTS);
    const blocking: Run = {
      ...run,
      id: 'blocking-run',
      createdAt: new Date(now.getTime() - stuckAfterMs),
      startedAt: null,
    };
    const expired: Run = { ...blocking, status: 'expired' };
    const { service, findActiveByChatId, markFinished, appendEvent } =
      makeService();
    findActiveByChatId.mockResolvedValue(blocking);
    markFinished.mockResolvedValue(expired);

    await service.createMessageStream(input);

    expect(markFinished).toHaveBeenCalledWith(
      blocking.id,
      chat.ownerUserId,
      'expired',
      {
        message:
          'Expired by a new message: run stuck with no execution progress.',
      },
    );
    expect(appendEvent).toHaveBeenCalledWith(blocking.id, 'run.expired', {
      status: 'expired',
      message:
        'Expired by a new message: run stuck with no execution progress.',
    });
  });

  it('skips the expired event when markFinished loses the race', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const stuckAfterMs = stuckRunThresholdMs(BUILT_IN_DEFAULTS);
    const blocking: Run = {
      ...run,
      id: 'blocking-run',
      createdAt: new Date(now.getTime() - stuckAfterMs),
    };
    const { service, findActiveByChatId, markFinished, appendEvent } =
      makeService();
    findActiveByChatId.mockResolvedValue(blocking);
    markFinished.mockResolvedValue(undefined);

    await service.createMessageStream(input);

    expect(appendEvent.mock.calls.map((call) => call[1])).toEqual([
      'run.created',
    ]);
  });

  it('conflicts on a fresh in-flight run that is still inside the grace window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const blocking: Run = {
      ...run,
      id: 'blocking-run',
      createdAt: now,
      startedAt: now,
    };
    const { service, findActiveByChatId, markFinished } = makeService();
    findActiveByChatId.mockResolvedValue(blocking);

    await expect(service.createMessageStream(input)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Another run is already in flight for this chat',
    });
    expect(markFinished).not.toHaveBeenCalled();
  });

  it('proceeds when the blocker finishes between the two reads', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const blocking: Run = { ...run, id: 'blocking-run', createdAt: now };
    const { service, findActiveByChatId, markFinished } = makeService();
    findActiveByChatId
      .mockResolvedValueOnce(blocking)
      .mockResolvedValueOnce(undefined);

    await service.createMessageStream(input);

    expect(markFinished).not.toHaveBeenCalled();
  });

  it('treats a run as stuck at exactly the threshold, using startedAt when present', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const stuckAfterMs = stuckRunThresholdMs(BUILT_IN_DEFAULTS);
    const blocking: Run = {
      ...run,
      id: 'blocking-run',
      createdAt: now,
      startedAt: new Date(now.getTime() - stuckAfterMs),
    };
    const { service, findActiveByChatId, markFinished } = makeService();
    findActiveByChatId.mockResolvedValue(blocking);
    markFinished.mockResolvedValue(blocking);

    await service.createMessageStream(input);

    expect(markFinished).toHaveBeenCalledWith(
      blocking.id,
      chat.ownerUserId,
      'expired',
      expect.any(Object),
    );
  });
});
