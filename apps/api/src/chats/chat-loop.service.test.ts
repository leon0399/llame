import { type TenantRunner, type Db } from '../db/tenant-db.service';
import {
  ModelConfigurationError,
  ModelNotAvailableError,
  type ModelSelectionValidator,
} from '../models/models.service';
import { type RunAborter } from '../runs/run-abort-registry';
import { type PromptUserResolver } from '../personalization/personalization.service';

/** Fully typed, no cast: ChatLoopService depends on the method, not the class. */
const personalization: PromptUserResolver = {
  resolvePromptUser: () => Promise.resolve(undefined),
};
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { type RunStreamResponder } from '../runs/run-stream-bridge';
import { ChatLoopService } from './chat-loop.service';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { type Compaction, type Run } from '../db/schema';
import {
  type ToolAvailabilityManifest,
  type TurnToolCandidate,
} from '../tools/turn-tool-catalog';
import { type RunJob } from '../runs/run-queues';
import { BadRequestException } from '@nestjs/common';

type RuntimeCatalogSnapshotter = {
  snapshotCandidates(): readonly TurnToolCandidate[];
};

function fakeInstanceConfig(
  toolsAllowed: readonly string[] = [],
): InstanceConfigReader {
  return {
    config: {
      ...BUILT_IN_DEFAULTS,
      runs: {
        ...BUILT_IN_DEFAULTS.runs,
        timeoutSeconds: 300,
        heartbeatSeconds: 15,
      },
      tools: { ...BUILT_IN_DEFAULTS.tools, allowed: toolsAllowed },
    },
  };
}

describe('ChatLoopService model selection', () => {
  function makeService(models?: {
    validateModelSelection?: ModelSelectionValidator['validateModelSelection'];
  }) {
    const runAs = vi.fn();
    const validateModelSelection =
      models?.validateModelSelection ??
      vi.fn((): SystemModelCatalogEntry => {
        throw new Error('validateModelSelection was not stubbed for this test');
      });
    const dispatchRun = vi.fn();
    const tenantDb: TenantRunner = { runAs };
    const modelsService: ModelSelectionValidator = { validateModelSelection };
    const bridge: RunStreamResponder = {
      createUiMessageStreamResponse: vi.fn(),
    };
    const aborts: RunAborter = { abort: vi.fn() };
    const dispatch: RunDispatcher = { dispatch: dispatchRun };
    const instanceConfig = fakeInstanceConfig();

    return {
      service: new ChatLoopService(
        tenantDb,
        modelsService,
        instanceConfig,
        bridge,
        aborts,
        dispatch,
        personalization,
        new SystemPromptsService(),
        { snapshotCandidates: () => [] },
      ),
      tenantDb,
      modelsService,
      dispatch,
      runAs,
      validateModelSelection,
      dispatchRun,
    };
  }

  const input = {
    chatId: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
    userId: 'verified-user',
    modelId: 'unknown-model',
    message: {
      id: '0910fd41-1f2f-49de-b1c2-00ff4b3c7c60',
      parts: [{ type: 'text' as const, text: 'Hello' }],
    },
  };

  it('rejects an unavailable model before any message, run, or queue write', async () => {
    const validateModelSelection = vi.fn(() => {
      throw new ModelNotAvailableError('unknown-model');
    });
    const { service, runAs, dispatchRun } = makeService({
      validateModelSelection,
    });

    await expect(service.createMessageStream(input)).rejects.toBeInstanceOf(
      ModelNotAvailableError,
    );
    expect(validateModelSelection).toHaveBeenCalledWith('unknown-model');
    expect(runAs).not.toHaveBeenCalled();
    expect(dispatchRun).not.toHaveBeenCalled();
  });

  it('rejects model configuration errors before any message, run, or queue write', async () => {
    const { service, runAs, dispatchRun } = makeService({
      validateModelSelection: vi.fn(() => {
        throw new ModelConfigurationError('DEFAULT_MODEL_ID is required.');
      }),
    });

    await expect(service.createMessageStream(input)).rejects.toBeInstanceOf(
      ModelConfigurationError,
    );
    expect(runAs).not.toHaveBeenCalled();
    expect(dispatchRun).not.toHaveBeenCalled();
  });
});

describe('ChatLoopService effective-context transaction binding', () => {
  const model: SystemModelCatalogEntry = {
    id: 'system:openai:gpt-5.4-mini',
    source: 'system',
    contextWindowTokens: 128_000,
    provider: 'openai',
    providerModelId: 'gpt-5.4-mini',
    systemPromptTemplate: 'Bound prompt',
    systemPromptSource: 'model_override',
  };

  afterEach(() => vi.restoreAllMocks());

  function setup(options?: {
    failRunCreated?: boolean;
    previousRun?: Run;
    previousManifest?: ToolAvailabilityManifest;
    activeCompaction?: Compaction;
    toolsAllowed?: readonly string[];
    runtime?: RuntimeCatalogSnapshotter;
  }) {
    // `transaction`/`runAs` are typed to accept a `Db` tx (matching
    // production) but this fake only ever hands back itself — the real
    // Drizzle builder chain types are too deep for a plain mock to satisfy
    // structurally, so the tx value itself stays a cast (#268 doesn't cover
    // the ORM library boundary, same bucket as the two production AI-SDK
    // casts it also doesn't reach).
    const txHolder = {} as {
      transaction: (
        callback: (inner: Db) => Promise<unknown>,
      ) => Promise<unknown>;
    };
    const tx = txHolder as unknown as Db;
    txHolder.transaction = (callback) => callback(tx);
    const runAs = vi.fn(
      (_userId: string, callback: (scoped: Db) => Promise<unknown>) =>
        callback(tx),
    );
    const dispatch = vi.fn(async (_job: RunJob): Promise<void> => {});

    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue({
      id: 'chat-id',
      ownerUserId: 'user-id',
      title: null,
      visibility: 'private',
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      projectId: null,
    });
    vi.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage: undefined,
      assistantMessage: undefined,
    });
    vi.spyOn(
      MessagesRepository.prototype,
      'createUserMessageIfAbsent',
    ).mockResolvedValue({
      id: 'message-id',
      chatId: 'chat-id',
      seq: 1,
      role: 'user',
      senderUserId: 'user-id',
      parts: [{ type: 'text', text: 'hello' }],
      attachments: [],
      usage: null,
      inReplyTo: null,
      createdAt: new Date(),
    });
    vi.spyOn(
      RunsRepository.prototype,
      'cancelActiveRunsForMessage',
    ).mockResolvedValue([]);
    const findPreviousRun = vi
      .spyOn(RunsRepository.prototype, 'findMostRecentByChatMessageSequence')
      .mockResolvedValue(options?.previousRun);
    vi.spyOn(
      CompactionsRepository.prototype,
      'findLatestByChatId',
    ).mockResolvedValue(options?.activeCompaction);
    vi.spyOn(
      ModelContextSnapshotsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue(
      options?.previousRun && options.previousManifest
        ? {
            id: options.previousRun.modelContextSnapshotId!,
            ownerUserId: 'user-id',
            availabilityHash: 'previous-availability-hash',
            contentHash: 'previous-content-hash',
            promptHash: 'previous-prompt-hash',
            toolHash: 'previous-tool-hash',
            source: 'model_override',
            systemPrompt: 'Previous prompt',
            toolAvailabilityManifest: options.previousManifest,
            toolDeclarations: [],
            createdAt: new Date(),
          }
        : undefined,
    );
    const createSnapshot = vi
      .spyOn(ModelContextSnapshotsRepository.prototype, 'createOrReuse')
      .mockResolvedValue({
        id: 'snapshot-id',
        ownerUserId: 'user-id',
        availabilityHash: 'availability-hash',
        contentHash: 'content-hash',
        promptHash: 'prompt-hash',
        toolHash: 'tool-hash',
        source: 'model_override',
        systemPrompt: 'Bound prompt',
        toolAvailabilityManifest: { version: 1, entries: [] },
        toolDeclarations: [],
        createdAt: new Date(),
      });
    const createRun = vi
      .spyOn(RunsRepository.prototype, 'create')
      .mockImplementation((runInput) =>
        Promise.resolve({
          id: runInput.id ?? 'run-id',
          chatId: runInput.chatId,
          messageId: runInput.messageId,
          userId: runInput.userId,
          modelId: runInput.modelId,
          modelContextSnapshotId: runInput.modelContextSnapshotId,
          status: 'queued',
          workerId: null,
          cancelRequestedAt: null,
          error: null,
          createdAt: new Date(),
          startedAt: null,
          finishedAt: null,
        }),
      );
    const appendEvent = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockImplementation(() =>
        options?.failRunCreated
          ? Promise.reject(new Error('run.created failed'))
          : Promise.resolve({
              sequence: 1,
              runId: 'run-id',
              eventType: 'run.created',
              payload: null,
              createdAt: new Date(),
            }),
      );

    // A mocked generic method infers a concrete T (here `unknown`) that can't
    // structurally satisfy `runAs`'s own `<T>` — a single narrowing `as`, not
    // the banned double cast (the mock genuinely implements this signature;
    // TS just can't verify it generically).
    const tenantDb: TenantRunner = { runAs: runAs as TenantRunner['runAs'] };
    const modelsService: ModelSelectionValidator = {
      validateModelSelection: vi.fn(() => model),
    };
    const instanceConfig = fakeInstanceConfig(options?.toolsAllowed);
    const bridge: RunStreamResponder = {
      createUiMessageStreamResponse: vi.fn(() => new Response()),
    };
    const aborts: RunAborter = { abort: vi.fn() };
    const dispatcher: RunDispatcher = { dispatch };
    const runtime: RuntimeCatalogSnapshotter = options?.runtime ?? {
      snapshotCandidates: () => [],
    };

    const service = new ChatLoopService(
      tenantDb,
      modelsService,
      instanceConfig,
      bridge,
      aborts,
      dispatcher,
      personalization,
      new SystemPromptsService(),
      runtime,
    );

    return {
      service,
      runAs,
      dispatch,
      createSnapshot,
      findPreviousRun,
      createRun,
      appendEvent,
    };
  }

  const input = {
    chatId: 'chat-id',
    userId: 'user-id',
    modelId: model.id,
    message: {
      id: 'message-id',
      parts: [{ type: 'text' as const, text: 'hello' }],
    },
  };

  it('creates the snapshot, binds it to the run in the same tenant transaction, then dispatches after commit', async () => {
    const { service, runAs, dispatch, createSnapshot, createRun, appendEvent } =
      setup();

    await service.createMessageStream(input);

    expect(runAs).toHaveBeenCalledWith('user-id', expect.any(Function));
    expect(createSnapshot).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({
        source: 'model_override',
        systemPrompt: 'Bound prompt',
        toolDeclarations: [],
      }),
    );
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({ modelContextSnapshotId: 'snapshot-id' }),
    );
    expect(Object.keys(dispatch.mock.calls[0][0]).sort()).toEqual([
      'chatId',
      'modelId',
      'runId',
      'userId',
      'userMessage',
    ]);
    expect(dispatch.mock.invocationCallOrder[0]).toBeGreaterThan(
      appendEvent.mock.invocationCallOrder[0],
    );
  });

  it('binds one synchronous process-local runtime snapshot into the accepted turn', async () => {
    const id = 'mcp__web__search';
    const dynamicCandidates: readonly TurnToolCandidate[] = [
      {
        source: { type: 'mcp', serverId: 'web' },
        state: 'unavailable',
        id,
        classification: 'read_only',
        reason: 'source_disconnected',
      },
    ];
    const snapshotCandidates = vi.fn(() => dynamicCandidates);
    const { service, createSnapshot } = setup({
      toolsAllowed: [id],
      runtime: { snapshotCandidates },
    });

    await service.createMessageStream(input);

    expect(snapshotCandidates).toHaveBeenCalledOnce();
    expect(snapshotCandidates).toHaveBeenCalledWith();
    expect(createSnapshot).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({
        toolAvailabilityManifest: {
          version: 1,
          entries: [
            {
              id,
              state: 'unavailable',
              reason: 'source_disconnected',
            },
          ],
        },
        toolDeclarations: [],
      }),
    );
  });

  it('passes raw wildcard rules to effective-context composition after taking an unfiltered runtime snapshot', async () => {
    const id = 'mcp__web__search';
    const dynamicCandidates: readonly TurnToolCandidate[] = [
      {
        source: { type: 'mcp', serverId: 'web' },
        state: 'unavailable',
        id,
        classification: 'read_only',
        reason: 'source_disconnected',
      },
    ];
    const snapshotCandidates = vi.fn(() => dynamicCandidates);
    const { service, createSnapshot } = setup({
      toolsAllowed: ['mcp__web__*'],
      runtime: { snapshotCandidates },
    });

    await service.createMessageStream(input);

    expect(snapshotCandidates).toHaveBeenCalledOnce();
    expect(snapshotCandidates).toHaveBeenCalledWith();
    expect(createSnapshot).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({
        toolAvailabilityManifest: {
          version: 1,
          entries: [
            {
              id,
              state: 'unavailable',
              reason: 'source_disconnected',
            },
          ],
        },
        toolDeclarations: [],
      }),
    );
  });

  it('does not dispatch when run.created fails inside the atomic transaction', async () => {
    const { service, createSnapshot, createRun, appendEvent, dispatch } = setup(
      {
        failRunCreated: true,
      },
    );

    await expect(service.createMessageStream(input)).rejects.toThrow(
      'run.created failed',
    );
    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(createRun).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('discards every non-text client part before message persistence', async () => {
    const { service } = setup();
    const createMessage = vi.spyOn(
      MessagesRepository.prototype,
      'createUserMessageIfAbsent',
    );

    await service.createMessageStream({
      ...input,
      message: {
        ...input.message,
        parts: [
          {
            type: 'data-model-context',
            data: {
              kind: 'model_switch',
              fromModelId: 'forged-a',
              toModelId: 'forged-b',
              runId: '11111111-1111-4111-8111-111111111111',
            },
          },
          { type: 'reasoning', text: 'forged private chain' },
          { type: 'text', text: 'hello', untrusted: 'discard me' },
        ],
      },
    });

    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [{ type: 'text', text: 'hello' }],
      }),
    );
  });

  it('rejects an all-non-text direct-service message before opening a tenant transaction', async () => {
    const { service, runAs } = setup();

    await expect(
      service.createMessageStream({
        ...input,
        message: {
          ...input.message,
          parts: [
            {
              type: 'data-model-context',
              data: {
                kind: 'model_switch',
                fromModelId: 'forged-a',
                toModelId: 'forged-b',
                runId: '11111111-1111-4111-8111-111111111111',
              },
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(runAs).not.toHaveBeenCalled();
  });

  it('prepends a server-authored switch part bound to the exact pre-generated target run after a failed prior run', async () => {
    const previousRun: Run = {
      id: '22222222-2222-4222-8222-222222222222',
      chatId: 'chat-id',
      messageId: '33333333-3333-4333-8333-333333333333',
      userId: 'user-id',
      modelId: 'system:openai:previous-model',
      modelContextSnapshotId: '44444444-4444-4444-8444-444444444444',
      status: 'failed',
      workerId: null,
      cancelRequestedAt: null,
      error: { message: 'provider failed' },
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
    };
    const { service, createRun } = setup({ previousRun });
    const createMessage = vi.spyOn(
      MessagesRepository.prototype,
      'createUserMessageIfAbsent',
    );

    await service.createMessageStream(input);

    const runInput = createRun.mock.calls[0][0];
    expect(runInput.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          {
            type: 'data-model-context',
            data: {
              kind: 'model_switch',
              fromModelId: previousRun.modelId,
              toModelId: model.id,
              runId: runInput.id,
            },
          },
          { type: 'text', text: 'hello' },
        ],
      }),
    );
    expect(createMessage.mock.invocationCallOrder[0]).toBeLessThan(
      createRun.mock.invocationCallOrder[0],
    );
  });
  it('persists a prior-snapshot delta part bound to the same target Run before the user text', async () => {
    const previousRun: Run = {
      id: '22222222-2222-4222-8222-222222222222',
      chatId: 'chat-id',
      messageId: '33333333-3333-4333-8333-333333333333',
      userId: 'user-id',
      modelId: model.id,
      modelContextSnapshotId: '44444444-4444-4444-8444-444444444444',
      status: 'failed',
      workerId: null,
      cancelRequestedAt: null,
      error: { message: 'provider failed' },
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
    };
    const { service, createRun } = setup({
      previousRun,
      previousManifest: {
        version: 1,
        entries: [
          {
            id: 'search_conversations',
            state: 'available',
            declarationHash: 'a'.repeat(64),
          },
        ],
      },
    });
    const createMessage = vi.spyOn(
      MessagesRepository.prototype,
      'createUserMessageIfAbsent',
    );

    await service.createMessageStream(input);

    const runInput = createRun.mock.calls[0][0];
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          {
            type: 'data-tool-availability',
            data: {
              version: 1,
              kind: 'delta',
              runId: runInput.id,
              added: [],
              removed: ['search_conversations'],
              unavailable: [],
              becameUnavailable: [],
              nowAvailable: [],
            },
          },
          { type: 'text', text: 'hello' },
        ],
      }),
    );
    expect(createMessage.mock.invocationCallOrder[0]).toBeLessThan(
      createRun.mock.invocationCallOrder[0],
    );
  });

  it('starts a degraded disclosure epoch when a retained-window compaction was created after the previous Run', async () => {
    const id = 'mcp__web__search';
    const previousRun: Run = {
      id: '22222222-2222-4222-8222-222222222222',
      chatId: 'chat-id',
      messageId: '33333333-3333-4333-8333-333333333333',
      userId: 'user-id',
      modelId: model.id,
      modelContextSnapshotId: '44444444-4444-4444-8444-444444444444',
      status: 'completed',
      workerId: null,
      cancelRequestedAt: null,
      error: null,
      createdAt: new Date('2026-08-11T08:00:00.000Z'),
      startedAt: new Date('2026-08-11T08:00:01.000Z'),
      finishedAt: new Date('2026-08-11T08:00:02.000Z'),
    };
    const activeCompaction: Compaction = {
      id: '55555555-5555-4555-8555-555555555555',
      chatId: 'chat-id',
      uptoSeq: 8,
      parentId: null,
      summary: 'Retains the latest messages.',
      toolObservationLedger: {
        version: 1,
        omittedCount: 0,
        observations: [],
      },
      usage: null,
      createdAt: new Date('2026-08-11T08:00:03.000Z'),
    };
    const { service, createRun } = setup({
      previousRun,
      previousManifest: {
        version: 1,
        entries: [{ id, state: 'available', declarationHash: 'a'.repeat(64) }],
      },
      activeCompaction,
      toolsAllowed: [id],
      runtime: {
        snapshotCandidates: () => [
          {
            source: { type: 'mcp', serverId: 'web' },
            state: 'unavailable',
            id,
            classification: 'read_only',
            reason: 'source_disconnected',
          },
        ],
      },
    });
    const createMessage = vi.spyOn(
      MessagesRepository.prototype,
      'createUserMessageIfAbsent',
    );

    await service.createMessageStream(input);

    const runInput = createRun.mock.calls[0][0];
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          {
            type: 'data-tool-availability',
            data: {
              version: 1,
              kind: 'initial',
              runId: runInput.id,
              added: [],
              removed: [],
              unavailable: [{ id, reason: 'source_disconnected' }],
              becameUnavailable: [],
              nowAvailable: [],
            },
          },
          { type: 'text', text: 'hello' },
        ],
      }),
    );
  });

  it('stays silent for a healthy retained-window post-compaction epoch', async () => {
    const id = 'search_conversations';
    const previousRun: Run = {
      id: '22222222-2222-4222-8222-222222222222',
      chatId: 'chat-id',
      messageId: '33333333-3333-4333-8333-333333333333',
      userId: 'user-id',
      modelId: model.id,
      modelContextSnapshotId: '44444444-4444-4444-8444-444444444444',
      status: 'completed',
      workerId: null,
      cancelRequestedAt: null,
      error: null,
      createdAt: new Date('2026-08-11T08:00:00.000Z'),
      startedAt: new Date('2026-08-11T08:00:01.000Z'),
      finishedAt: new Date('2026-08-11T08:00:02.000Z'),
    };
    const activeCompaction: Compaction = {
      id: '55555555-5555-4555-8555-555555555555',
      chatId: 'chat-id',
      uptoSeq: 8,
      parentId: null,
      summary: 'Retains the latest messages.',
      toolObservationLedger: {
        version: 1,
        omittedCount: 0,
        observations: [],
      },
      usage: null,
      createdAt: new Date('2026-08-11T08:00:03.000Z'),
    };
    const { service } = setup({
      previousRun,
      previousManifest: {
        version: 1,
        entries: [{ id, state: 'unavailable', reason: 'source_disconnected' }],
      },
      activeCompaction,
      toolsAllowed: [id],
    });
    const createMessage = vi.spyOn(
      MessagesRepository.prototype,
      'createUserMessageIfAbsent',
    );

    await service.createMessageStream(input);

    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ parts: [{ type: 'text', text: 'hello' }] }),
    );
  });
});
