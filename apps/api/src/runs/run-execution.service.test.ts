import { drizzle } from 'drizzle-orm/postgres-js';

import type {
  Chat,
  Message,
  ModelContextSnapshot,
  ModelToolDeclaration,
  Run,
  RunEvent,
} from '../db/schema';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import { createFakeModelClient, ZERO_USAGE } from '../models/fake-model-client';
import type { ModelClient } from '../models/model-client';
import type { KnowledgeToolResolver, Tool, ToolResult } from '../tools/types';
import { isRecord, isString } from '@workspace/runtime-safety';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from '../chats/chats-repository';
import { ModelContextSnapshotsRepository } from './model-context-snapshots.repository';
import { createModelChangeItem } from '../chats/context-item-producers';
import { hashToolDeclaration } from '../tools/turn-tool-catalog';
import type { DynamicToolExecutorResolver } from './snapshot-tool-execution';
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
  dynamicToolResolver?: DynamicToolExecutorResolver,
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
  // Held separately so tests can rescript them with their inferred Mock type
  // instead of asserting the capability interface back down to a mock.
  const compactForTransition = vi.fn(() => Promise.resolve('created' as const));
  const reindexChat = vi.fn(() => Promise.resolve());
  const compaction: CompactionCapability = {
    maybeCompact: vi.fn(() => Promise.resolve()),
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
  const service = new RunExecutionService(
    tenantDb,
    compaction,
    titles,
    instanceConfig,
    searchIndex,
    reindexDispatch,
    knowledgeResolver,
    embedDispatch,
    dynamicToolResolver,
  );
  return {
    service,
    runAs,
    compaction,
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
      undefined,
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
      undefined,
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
      undefined,
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
      message: 'provider exploded',
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
      message: 'plain string blowup',
    });
  });

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

    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'expired', {
      message: 'Run timed out: exceeded its wall-clock budget.',
    });
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
      { message: 'stream aborted' },
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

    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'failed', {
      message: 'Run progress could not be persisted.',
    });
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

    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'failed', {
      message: 'Run progress could not be persisted.',
    });
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
    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'failed', {
      message: 'provider misconfigured',
    });
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

/** Advertises `toolDeclaration` on the run's bound snapshot. */
function withDeclaredTool() {
  vi.spyOn(
    ModelContextSnapshotsRepository.prototype,
    'findByOwnedRun',
  ).mockResolvedValue({ ...snapshot, toolDeclarations: [toolDeclaration] });
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

describe('RunExecutionService executeRun — tool loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits requested/started/completed around a tool call and persists its settled part', async () => {
    const spies = mockNormalExecutionRepositories();
    withDeclaredTool();
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
          },
          { type: 'text', text: 'answer' },
        ],
      }),
    );
  });

  it('records the step cap as an event and a persisted cap notice', async () => {
    const spies = mockNormalExecutionRepositories();
    withDeclaredTool();
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
    withDeclaredTool();
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
    withDeclaredTool();
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

    expect(appended[3]?.payload).toStrictEqual({
      toolCallId: 'call-8',
      toolName: toolDeclaration.id,
      status: 'error',
      output: {
        status: 'error',
        type: 'invalid_input',
        message: `The call to "${toolDeclaration.id}" had invalid arguments.`,
      },
    });
  });

  it('settles a still-open tool call as cancelled when the parent run is aborted mid-call', async () => {
    const controller = new AbortController();
    const spies = mockNormalExecutionRepositories();
    withDeclaredTool();
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
    });
    expect(spies.markFinished).toHaveBeenCalledWith(
      runId,
      userId,
      'cancelled',
      { message: 'The run was cancelled before this tool finished.' },
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
          },
        ],
      }),
    );
  });

  it('settles a still-open tool call as expired when the run times out mid-call', async () => {
    const controller = new AbortController();
    const spies = mockNormalExecutionRepositories();
    withDeclaredTool();
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
    });
    expect(appended.at(-1)?.type).toBe('run.expired');
    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'expired', {
      message: 'The run expired before this tool finished.',
    });
  });

  it('falls back to a non-terminal run when settling a parent abort cannot be persisted', async () => {
    const controller = new AbortController();
    mockNormalExecutionRepositories();
    withDeclaredTool();
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
    expect(markFinished).toHaveBeenLastCalledWith(runId, userId, 'failed', {
      message: 'Run progress could not be persisted.',
    });
  });

  it('does not settle open tool calls when the error path already lost a progress write', async () => {
    mockNormalExecutionRepositories();
    withDeclaredTool();
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
    withDeclaredTool();
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
    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'failed', {
      message: 'Run progress could not be persisted.',
    });
  });

  it('settles open tool calls on a finish that is not a completion', async () => {
    const spies = mockNormalExecutionRepositories();
    withDeclaredTool();
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
          },
          { type: 'text', text: 'gave up' },
        ],
      }),
    );
  });

  it('offers no tools and no step cap when the snapshot declares none', async () => {
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

  it('fails the run when its bound model-context snapshot is missing', async () => {
    const spies = mockNormalExecutionRepositories();
    vi.spyOn(
      ModelContextSnapshotsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue(undefined);
    const appended = recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);

    await expect(
      execution.service.executeRun(executionInput(capturing.client)),
    ).rejects.toThrow(`Run ${runId} has no owned model-context snapshot.`);
    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'failed', {
      message: `Run ${runId} has no owned model-context snapshot.`,
      code: 'model_context_incompatible',
    });
    expect(appended.at(-1)).toStrictEqual({
      type: 'run.failed',
      payload: {
        status: 'failed',
        message: `Run ${runId} has no owned model-context snapshot.`,
        code: 'model_context_incompatible',
      },
    });
  });

  it('stops without streaming when the context items cannot be recorded', async () => {
    const spies = mockNormalExecutionRepositories();
    vi.spyOn(RunsRepository.prototype, 'recordContextItems').mockResolvedValue(
      undefined,
    );
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
    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'failed', {
      message:
        'The complete request exceeds the target model context window and no model-switch source context is available.',
      code: 'context_incompatible',
    });
    expect(appended.at(-1)?.type).toBe('run.failed');
  });

  it('runs one transition compaction for a model switch and streams when the rebuild fits', async () => {
    mockNormalExecutionRepositories();
    recordAppendedEvents();
    const capturing = makeCapturingClient();
    const execution = makeExecutionService(capturing.client);
    const fits = vi
      .spyOn(RunsRepository.prototype, 'recordContextItems')
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
            fromModelId: 'old-model',
            toModelId: 'fake-model',
            runId,
          }),
        ],
      },
    });

    // The request already fits, so no transition compaction and one build.
    expect(execution.compaction.compactForTransition).not.toHaveBeenCalled();
    expect(call).toBe(1);
    expect(fits).toHaveBeenCalledTimes(1);
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
              fromModelId: 'old-model',
              toModelId: 'fake-model',
              runId,
            }),
            { type: 'text', text: 'rebuilt turn' },
          ],
        },
      ]);
    const recordContextItems = vi
      .spyOn(RunsRepository.prototype, 'recordContextItems')
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
            fromModelId: 'old-model',
            toModelId: 'fake-model',
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
    expect(recordContextItems).toHaveBeenCalledTimes(1);
    // The request that reaches the model is the REBUILT one, and the recorded
    // authority record describes that same request.
    // Only the rebuild reads history, so the request the model receives is
    // the rebuilt one, not the (empty) initial build.
    expect(JSON.stringify(captured.options?.messages)).toContain(
      'rebuilt turn',
    );
    expect(recordContextItems).toHaveBeenCalledWith(
      runId,
      userId,
      expect.arrayContaining([
        expect.objectContaining({ producer: 'effective-context-change' }),
      ]),
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
              fromModelId: 'old-model',
              toModelId: 'fake-model',
              runId,
            }),
          ],
        },
      }),
    ).rejects.toThrow(
      'The complete request does not fit the target model and transition compaction could not produce compatible context.',
    );
    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'failed', {
      message:
        'The complete request does not fit the target model and transition compaction could not produce compatible context.',
      code: 'context_incompatible',
    });
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
              fromModelId: 'old-model',
              toModelId: 'fake-model',
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
      {
        message: 'Run was cancelled before model inference.',
      },
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
              fromModelId: 'old-model',
              toModelId: 'fake-model',
              runId,
            }),
          ],
        },
      }),
    ).rejects.toThrow(
      'The complete request still exceeds the target model context window after one transition compaction.',
    );
    expect(execution.compaction.compactForTransition).toHaveBeenCalledTimes(1);
    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'failed', {
      message:
        'The complete request still exceeds the target model context window after one transition compaction.',
      code: 'context_incompatible',
    });
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
    expect(spies.markFinished).toHaveBeenCalledWith(runId, userId, 'expired', {
      message: 'Run timed out: exceeded its wall-clock budget.',
    });
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
    expect(markFinished).toHaveBeenCalledWith(runId, userId, 'cancelled', {
      message: 'Run was cancelled before model inference.',
    });
    expect(appended).toEqual([]);
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
    expect(markFinished).toHaveBeenCalledWith(runId, userId, 'expired', {
      message: 'dead letter',
    });
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

  it('refuses to complete a run whose durable tool calls are still open', async () => {
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
    expect(appended).toEqual([]);
    expect(createAssistantReplyIfAbsent).not.toHaveBeenCalled();
  });

  it('refuses to settle durable parts against a run with no triggering message', async () => {
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
    expect(capturing.streamOptions().messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'Summarized prefix request' }],
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
    withDeclaredTool();
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
    });
  });
});
