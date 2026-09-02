import { drizzle } from 'drizzle-orm/postgres-js';

import type {
  Chat,
  Message,
  ModelContextSnapshot,
  Run,
  RunEvent,
} from '../db/schema';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import { createFakeModelClient } from '../models/fake-model-client';
import type { ModelClient } from '../models/model-client';
import type { KnowledgeToolResolver } from '../tools/types';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from '../chats/chats-repository';
import { ModelContextSnapshotsRepository } from './model-context-snapshots.repository';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import type { CompactionCapability } from '../compaction/compaction.service';
import type { TitleCapability } from '../titles/title.service';
import type { ChatSearchIndexer } from './run-execution.service';
import type { ChatEmbedDispatcher } from '../search/search-embed-dispatch.service';
import type { ChatReindexDispatcher } from '../search/search-reindex-dispatch.service';
import {
  RunExecutionService,
  RunNotRunnableError,
} from './run-execution.service';

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
const snapshotId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
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
  modelContextSnapshotId: snapshotId,
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

const snapshot: ModelContextSnapshot = {
  id: snapshotId,
  ownerUserId: userId,
  contentHash: 'content-hash',
  availabilityHash: 'availability-hash',
  promptHash: 'prompt-hash',
  toolHash: 'tool-hash',
  source: 'project_default',
  systemPrompt: 'Stable system prompt',
  toolAvailabilityManifest: { version: 1, entries: [] },
  toolDeclarations: [],
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
    read: (path) =>
      Promise.resolve({ path, offset: 0, lineCount: 0, content: '' }),
  }),
};

function makeExecutionService(
  client: ModelClient = createFakeModelClient(['answer']),
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
  const instanceConfig: InstanceConfigReader = {
    config: {
      ...BUILT_IN_DEFAULTS,
      tools: { ...BUILT_IN_DEFAULTS.tools, allowed: [] },
    },
  };
  const compaction: CompactionCapability = {
    maybeCompact: vi.fn(() => Promise.resolve()),
    compactForTransition: vi.fn(() => Promise.resolve('created' as const)),
  };
  const titles: TitleCapability = {
    maybeGenerateTitle: vi.fn(() => Promise.resolve()),
  };
  const searchIndex: ChatSearchIndexer = {
    reindexChat: vi.fn(() => Promise.resolve()),
  };
  const reindexDispatch: ChatReindexDispatcher = {
    enqueueChatReindex: vi.fn(() => Promise.resolve()),
  };
  const embedDispatch: ChatEmbedDispatcher = {
    enqueueChatEmbed: vi.fn(() => Promise.resolve()),
  };
  const service = new RunExecutionService(
    tenantDb,
    compaction,
    titles,
    instanceConfig,
    searchIndex,
    reindexDispatch,
    knowledgeResolver,
    embedDispatch,
  );
  return {
    service,
    runAs,
    compaction,
    titles,
    searchIndex,
    reindexDispatch,
    embedDispatch,
    client,
  };
}

function mockNormalExecutionRepositories() {
  const markStarted = vi
    .spyOn(RunsRepository.prototype, 'markStarted')
    .mockResolvedValue(run);
  const recordContextItems = vi
    .spyOn(RunsRepository.prototype, 'recordContextItems')
    .mockResolvedValue(run);
  const markFinished = vi
    .spyOn(RunsRepository.prototype, 'markFinished')
    .mockResolvedValue({
      ...run,
      status: 'completed',
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
  vi.spyOn(
    ModelContextSnapshotsRepository.prototype,
    'findByOwnedRun',
  ).mockResolvedValue(snapshot);
  return {
    markStarted,
    recordContextItems,
    markFinished,
    createAssistantReplyIfAbsent,
  };
}

describe('RunExecutionService executeRun', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(repositorySpies.recordContextItems).toHaveBeenCalledWith(
      runId,
      userId,
      [],
    );
    expect(repositorySpies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'completed',
      undefined,
    );
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
        system: snapshot.systemPrompt,
      }),
    );
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
    expect(finished).toHaveBeenCalledWith(runId, userId, 'expired', {
      message: 'Run timed out: exceeded its wall-clock budget.',
    });
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
