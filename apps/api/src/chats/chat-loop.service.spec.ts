import { TenantDbService } from '../db/tenant-db.service';
import {
  ModelConfigurationError,
  ModelNotAvailableError,
  ModelsService,
} from '../models/models.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { RunDispatchService } from '../runs/run-dispatch.service';
import { RunStreamBridgeService } from '../runs/run-stream-bridge';
import { ChatLoopService } from './chat-loop.service';
import { type InstanceConfigService } from '../instance-config/instance-config.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { type Db } from '../db/tenant-db.service';
import { type Run } from '../db/schema';
import { type RunJob } from '../runs/run-queues';
import { BadRequestException } from '@nestjs/common';

describe('ChatLoopService model selection', () => {
  function makeService(models?: Partial<ModelsService>) {
    const runAs = jest.fn();
    const validateModelSelection = models?.validateModelSelection ?? jest.fn();
    const dispatchRun = jest.fn();
    const tenantDb = {
      runAs,
    } as unknown as jest.Mocked<TenantDbService>;
    const modelsService = {
      validateModelSelection,
      resolveModelCredential: jest.fn().mockResolvedValue('sk-test'),
      ...models,
    } as unknown as jest.Mocked<ModelsService>;
    const bridge = {
      createUiMessageStreamResponse: jest.fn(),
    } as unknown as jest.Mocked<RunStreamBridgeService>;
    const aborts = {
      abort: jest.fn(),
    } as unknown as jest.Mocked<RunAbortRegistry>;
    const dispatch = {
      dispatch: dispatchRun,
    } as unknown as jest.Mocked<RunDispatchService>;

    const instanceConfig = {
      config: {
        runs: { timeoutSeconds: 300, heartbeatSeconds: 15 },
        tools: { allowed: [] },
      },
    } as unknown as InstanceConfigService;

    return {
      service: new ChatLoopService(
        tenantDb,
        modelsService,
        instanceConfig,
        bridge,
        aborts,
        dispatch,
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
    const validateModelSelection = jest.fn(() => {
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
      validateModelSelection: jest.fn(() => {
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
    systemPrompt: 'Bound prompt',
    systemPromptSource: 'model_override',
  };

  afterEach(() => jest.restoreAllMocks());

  function setup(options?: { failRunCreated?: boolean; previousRun?: Run }) {
    const txHolder = {} as {
      transaction: (
        callback: (inner: Db) => Promise<unknown>,
      ) => Promise<unknown>;
    };
    const tx = txHolder as unknown as Db;
    txHolder.transaction = (callback) => callback(tx);
    const runAs = jest.fn(
      (_userId: string, callback: (scoped: Db) => Promise<unknown>) =>
        callback(tx),
    );
    const dispatch = jest.fn(async (_job: RunJob): Promise<void> => {});

    jest.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue({
      id: 'chat-id',
      ownerUserId: 'user-id',
      title: null,
      visibility: 'private',
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      projectId: null,
    });
    jest.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(undefined);
    jest
      .spyOn(MessagesRepository.prototype, 'findTurnState')
      .mockResolvedValue({
        userMessage: undefined,
        assistantMessage: undefined,
      });
    jest
      .spyOn(MessagesRepository.prototype, 'createUserMessageIfAbsent')
      .mockResolvedValue({
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
    jest
      .spyOn(RunsRepository.prototype, 'cancelActiveRunsForMessage')
      .mockResolvedValue([]);
    const findPreviousRun = jest
      .spyOn(RunsRepository.prototype, 'findMostRecentByChatMessageSequence')
      .mockResolvedValue(options?.previousRun);
    const createSnapshot = jest
      .spyOn(ModelContextSnapshotsRepository.prototype, 'createOrReuse')
      .mockResolvedValue({
        id: 'snapshot-id',
        ownerUserId: 'user-id',
        contentHash: 'content-hash',
        promptHash: 'prompt-hash',
        toolHash: 'tool-hash',
        source: 'model_override',
        systemPrompt: 'Bound prompt',
        toolDeclarations: [],
        createdAt: new Date(),
      });
    const createRun = jest
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
    const appendEvent = jest
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

    const service = new ChatLoopService(
      { runAs } as unknown as TenantDbService,
      {
        validateModelSelection: jest.fn(() => model),
      } as unknown as ModelsService,
      {
        config: {
          runs: { timeoutSeconds: 300, heartbeatSeconds: 15 },
          tools: { allowed: [] },
        },
      } as unknown as InstanceConfigService,
      {
        createUiMessageStreamResponse: jest.fn(() => new Response()),
      } as unknown as RunStreamBridgeService,
      { abort: jest.fn() } as unknown as RunAbortRegistry,
      { dispatch } as unknown as RunDispatchService,
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
    const createMessage = jest.spyOn(
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
    const createMessage = jest.spyOn(
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
});
