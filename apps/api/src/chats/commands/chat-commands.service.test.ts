import { drizzle } from 'drizzle-orm/postgres-js';
import { asDouble } from '../../testing/support';
import type {
  Chat,
  ChatDelivery,
  Message,
  Run,
  RunEvent,
} from '../../db/schema';
import { TenantDbService, type Db } from '../../db/tenant-db.service';
import { RunWaitService } from '../../runs/run-wait.service';
import { ChatDeliveriesRepository } from '../chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from '../chats-repository';
import { TitleService } from '../../titles/title.service';
import { InstanceConfigService } from '../../instance-config/instance-config.service';
import { ModelsService } from '../../models/models.service';
import { BUILT_IN_DEFAULTS } from '../../instance-config/llame-config';
import {
  RunEventsRepository,
  RunsRepository,
} from '../../runs/runs-repository';
import { ChatCommandsService } from './chat-commands.service';
import * as runControl from '../../runs/run-control';

function makeService() {
  const db: Db = drizzle.mock();

  vi.spyOn(db, 'transaction').mockImplementation(async (callback) =>
    callback(asDouble<Parameters<typeof callback>[0]>(db)),
  );

  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });

  const runAs = vi
    .spyOn(tenantDb, 'runAs')
    .mockImplementation(
      async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    );

  const chat = asDouble<Chat>({ id: 'chat-1', archivedAt: null });

  vi.spyOn(ChatDeliveriesRepository.prototype, 'findById').mockResolvedValue(
    undefined,
  );

  const messageIdTaken = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'messageIdTaken')
    .mockResolvedValue(false);

  const findById = vi
    .spyOn(ChatsRepository.prototype, 'findById')
    .mockResolvedValue(chat);

  const lock = vi
    .spyOn(ChatsRepository.prototype, 'lock')
    .mockResolvedValue(chat);

  const update = vi
    .spyOn(ChatsRepository.prototype, 'update')
    .mockResolvedValue({ ...chat, title: 'New name' });

  const rows = vi
    .spyOn(MessagesRepository.prototype, 'findByChatId')
    .mockResolvedValue([
      asDouble<Message>({ role: 'user', seq: 1, parts: [] }),
      asDouble<Message>({ role: 'assistant', seq: 2, parts: [] }),
    ]);

  const checkpoint = vi
    .spyOn(MessagesRepository.prototype, 'findActiveCheckpoint')
    .mockResolvedValue(undefined);

  const activeRunLookup = vi
    .spyOn(RunsRepository.prototype, 'findActiveByChatId')
    .mockResolvedValue(undefined);

  const findActive = activeRunLookup;

  const findDeliveryById = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'findById')
    .mockResolvedValue(undefined);

  const insertPending = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'insertPending')
    .mockResolvedValue(
      asDouble<ChatDelivery>({ mode: 'steer', state: 'pending' }),
    );

  const wakeForChatInTransaction =
    vi.fn<RunWaitService['wakeForChatInTransaction']>();

  const createdRun = asDouble<Run>({
    id: 'run-1',
    modelId: 'model-1',
    kind: 'compaction',
  });

  const createRun = vi
    .spyOn(RunsRepository.prototype, 'create')
    .mockResolvedValue(createdRun);

  const append = vi
    .spyOn(RunEventsRepository.prototype, 'append')
    .mockResolvedValue(asDouble<RunEvent>({}));

  const validateModelSelection = vi.fn();
  const resolveEffortSelection = vi.fn().mockReturnValue(undefined);

  const models = asDouble<ModelsService>({
    validateModelSelection,
    resolveEffortSelection,
  });

  const instanceConfig = asDouble<InstanceConfigService>({
    config: {
      ...BUILT_IN_DEFAULTS,
      tools: {
        ...BUILT_IN_DEFAULTS.tools,
        permissionModes: ['default'],
      },
    },
  });

  const dispatch = {
    dispatch: vi.fn().mockResolvedValue(undefined),
    jobState: vi.fn().mockResolvedValue('absent'),
  };

  const regenerate = vi.spyOn(TitleService.prototype, 'regenerate');
  const titles: Pick<TitleService, 'regenerate'> = { regenerate };

  const service = new ChatCommandsService(
    tenantDb,
    titles,
    models,
    instanceConfig,
    dispatch,
    { wakeForChatInTransaction },
  );

  return {
    messageIdTaken,
    service,
    findById,
    lock,
    update,
    regenerate,
    rows,
    checkpoint,
    createRun,
    append,
    activeRunLookup,
    dispatch,
    findDeliveryById,
    findActive,
    insertPending,
    wakeForChatInTransaction,
    validateModelSelection,
    resolveEffortSelection,
    runAs,
  };
}

const request = {
  chatId: 'chat-1',
  userId: 'user-1',
  command: { name: 'rename' as const, argument: 'New name' },
  parts: [{ type: 'text' as const, text: '/rename New name' }],
  messageId: 'message-1',
  rawText: '/rename New name',
  modelId: 'model-1',
};

describe('ChatCommandsService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renames an existing Chat without requiring title generation', async () => {
    const { service, update, regenerate } = makeService();
    await expect(service.execute(request)).resolves.toEqual({
      type: 'command',
      command: 'rename',
      title: 'New name',
    });
    expect(update).toHaveBeenCalledWith('chat-1', 'user-1', {
      title: 'New name',
    });
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('falls through for a Chat the owner cannot see', async () => {
    const { service, findById, update } = makeService();
    findById.mockResolvedValue(undefined);
    await expect(service.execute(request)).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a file part alongside command text', async () => {
    const { service } = makeService();
    await expect(
      service.execute({
        ...request,
        parts: [{ type: 'text' }, { type: 'file' }],
      }),
    ).rejects.toMatchObject({
      message: 'A command cannot include an attachment.',
    });
  });

  it('accepts the maximum 200-character title', async () => {
    const { service, update } = makeService();
    const title = 'x'.repeat(200);

    await expect(
      service.execute({
        ...request,
        command: { name: 'rename', argument: title },
      }),
    ).resolves.toEqual({
      type: 'command',
      command: 'rename',
      title: 'New name',
    });
    expect(update).toHaveBeenCalledWith('chat-1', 'user-1', { title });
  });

  it('counts a title in code points, as the PATCH validator does', async () => {
    const { service, update } = makeService();
    const title = '😀'.repeat(200);

    await service.execute({
      ...request,
      command: { name: 'rename', argument: title },
    });
    expect(update).toHaveBeenCalledWith('chat-1', 'user-1', { title });
  });

  it('rejects an overlong title', async () => {
    const { service, update } = makeService();
    await expect(
      service.execute({
        ...request,
        command: { name: 'rename', argument: 'x'.repeat(201) },
      }),
    ).rejects.toMatchObject({
      message: 'A title must be between 1 and 200 characters.',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('maps bare rename outcomes to their HTTP errors', async () => {
    const { service, regenerate } = makeService();

    const bare = {
      ...request,
      command: { name: 'rename' as const, argument: '' },
    };

    regenerate.mockResolvedValue({ ok: false, reason: 'not_configured' });
    await expect(service.execute(bare)).rejects.toMatchObject({
      message: 'Title generation is not configured.',
    });
    regenerate.mockResolvedValue({ ok: false, reason: 'empty' });
    await expect(service.execute(bare)).rejects.toMatchObject({
      message: 'Nothing to name.',
    });
    regenerate.mockResolvedValue({ ok: false, reason: 'failed' });
    await expect(service.execute(bare)).rejects.toMatchObject({
      message: 'Title generation failed.',
    });
  });

  it('reports a disappeared Chat after lookup as not found', async () => {
    const { service, update } = makeService();
    update.mockResolvedValue(undefined);
    await expect(service.execute(request)).rejects.toMatchObject({
      message: 'Chat not found.',
    });
  });
  it('creates and dispatches an idle compaction Run without a message', async () => {
    const {
      service,
      createRun,
      append,
      dispatch,
      validateModelSelection,
      runAs,
    } = makeService();

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: '' },
      }),
    ).resolves.toMatchObject({
      type: 'command',
      command: 'compact',
      runId: 'run-1',
    });

    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        messageId: null,
        kind: 'compaction',
        modelId: 'model-1',
        effort: undefined,
        permissionMode: 'default',
      }),
    );
    expect(append).toHaveBeenCalledWith('run-1', 'run.created', {
      chatId: 'chat-1',
      messageId: null,
      compaction: { focus: null },
    });
    expect(dispatch.dispatch).toHaveBeenCalledWith({
      runId: 'run-1',
      chatId: 'chat-1',
      userId: 'user-1',
      modelId: 'model-1',
    });
    expect(dispatch.dispatch.mock.calls[0][0]).not.toHaveProperty(
      'userMessage',
    );
    expect(validateModelSelection).toHaveBeenCalledWith('model-1');
    expect(runAs).toHaveBeenCalledOnce();
  });
  it('admits a /compact steer and signals a Run waiting on jobs', async () => {
    const {
      service,
      dispatch,
      findActive,
      insertPending,
      wakeForChatInTransaction,
    } = makeService();

    const waitingRun = asDouble<Run>({
      id: 'run-1',
      chatId: 'chat-1',
      userId: 'user-1',
      status: 'awaiting_jobs',
      kind: 'turn',
      currentJobId: 'wake-job',
      awaiting: {
        kind: 'jobs',
        toolCallId: 'tool-call-id',
        toolInput: { jobs: ['job-id'] },
        jobIds: ['job-id'],
        deadline: '2026-10-27T01:00:00.000Z',
      },
    });

    findActive.mockResolvedValue(waitingRun);
    dispatch.jobState.mockResolvedValue('queued');

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: '' },
        messageId: 'compact-message',
        rawText: '/compact',
        delivery: 'steer',
      }),
    ).resolves.toMatchObject({ type: 'delivery' });

    expect(insertPending).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'compact-message', mode: 'steer' }),
    );
    expect(wakeForChatInTransaction).toHaveBeenCalledWith(expect.anything(), {
      chatId: 'chat-1',
      userId: 'user-1',
      kind: 'steer',
    });
  });
  it('notifies a running turn when a compact interrupt is queued', async () => {
    const { service, activeRunLookup, dispatch, insertPending } = makeService();

    const notify = vi
      .spyOn(runControl, 'notifyRunControl')
      .mockResolvedValue(undefined);

    activeRunLookup.mockResolvedValue(
      asDouble<Run>({
        id: 'turn-run',
        chatId: 'chat-1',
        userId: 'user-1',
        status: 'running_model',
        kind: 'turn',
        currentJobId: 'turn-job',
      }),
    );
    dispatch.jobState.mockResolvedValue('active');

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: 'preserve this' },
        messageId: 'compact-interrupt',
        rawText: '/compact preserve this',
        delivery: 'interrupt',
      }),
    ).resolves.toMatchObject({ type: 'delivery' });

    expect(insertPending).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'compact-interrupt', mode: 'interrupt' }),
    );
    expect(notify).toHaveBeenCalledWith(expect.anything(), {
      runId: 'turn-run',
      kind: 'interrupt',
    });
  });

  it('queues a compact command behind a live compaction Run', async () => {
    const {
      service,
      findActive,
      insertPending,
      wakeForChatInTransaction,
      dispatch,
    } = makeService();

    findActive.mockResolvedValue(
      asDouble<Run>({
        id: 'run-1',
        chatId: 'chat-1',
        userId: 'user-1',
        status: 'awaiting_jobs',
        kind: 'compaction',
        currentJobId: 'job-1',
      }),
    );
    dispatch.jobState.mockResolvedValue('queued');

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: '' },
        messageId: 'compact-message',
        rawText: '/compact',
        delivery: 'steer',
      }),
    ).resolves.toMatchObject({
      type: 'delivery',
      delivery: { job: null },
    });

    expect(insertPending).toHaveBeenCalledWith({
      chatId: 'chat-1',
      ownerUserId: 'user-1',
      id: 'compact-message',
      mode: 'queue',
      parts: [{ type: 'text', text: '/compact' }],
      settings: { modelId: 'model-1', permissionMode: 'default' },
    });
    expect(wakeForChatInTransaction).not.toHaveBeenCalled();
  });

  it('refuses an empty Chat without creating or dispatching a Run', async () => {
    const { service, rows, createRun, dispatch } = makeService();
    rows.mockResolvedValue([]);

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: '' },
      }),
    ).rejects.toThrow('Nothing to compact.');
    expect(createRun).not.toHaveBeenCalled();
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('refuses compaction while another live Run holds the Chat slot', async () => {
    const { service, createRun, dispatch, activeRunLookup } = makeService();

    const blocker = asDouble<Run>({
      id: 'active-run',
      kind: 'turn',
      currentJobId: 'active-job',
    });

    activeRunLookup.mockResolvedValue(blocker);

    dispatch.jobState.mockResolvedValue('queued');

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: '' },
      }),
    ).rejects.toMatchObject({
      message: 'Wait for the current Run to finish.',
    });
    expect(activeRunLookup).toHaveBeenCalledTimes(2);
    expect(createRun).not.toHaveBeenCalled();
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('A focus is accepted up to 1,000 characters', async () => {
    const { service, append, createRun, dispatch } = makeService();
    const focus = 'x'.repeat(1000);

    await service.execute({
      ...request,
      command: { name: 'compact', argument: focus },
    });

    const unicodeFocus = '😀'.repeat(600);

    await service.execute({
      ...request,
      command: { name: 'compact', argument: unicodeFocus },
    });

    expect(append).toHaveBeenLastCalledWith('run-1', 'run.created', {
      chatId: 'chat-1',
      messageId: null,
      compaction: { focus: unicodeFocus },
    });
    expect(createRun).toHaveBeenCalledTimes(2);
    expect(dispatch.dispatch).toHaveBeenCalledTimes(2);
  });

  it('rejects a focus over 1,000 characters before Run creation', async () => {
    const { service, createRun, dispatch } = makeService();

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: 'x'.repeat(1001) },
      }),
    ).rejects.toMatchObject({
      message: 'Compact focus must be 1,000 characters or fewer.',
    });
    expect(createRun).not.toHaveBeenCalled();
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('rejects an unknown model before Run creation', async () => {
    const { service, createRun, validateModelSelection } = makeService();
    validateModelSelection.mockImplementation(() => {
      throw new Error('Selected model is unavailable.');
    });

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: '' },
      }),
    ).rejects.toThrow('Selected model is unavailable.');
    expect(createRun).not.toHaveBeenCalled();
  });

  it('refuses a queued compact whose id names a stored message', async () => {
    const { service, activeRunLookup, messageIdTaken, dispatch } =
      makeService();

    const insertPending = vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'insertPending',
    );

    activeRunLookup.mockResolvedValue(
      asDouble<Run>({ id: 'active-run', kind: 'turn', currentJobId: 'job-1' }),
    );
    dispatch.jobState.mockResolvedValue('queued');
    messageIdTaken.mockResolvedValue(true);

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: '' },
        rawText: '/compact',
        delivery: 'queue',
      }),
    ).rejects.toMatchObject({ message: 'Message id already exists' });
    expect(insertPending).not.toHaveBeenCalled();
  });

  it('queues a compact with its selected settings while a Run holds the Chat slot', async () => {
    const {
      service,
      activeRunLookup,
      dispatch,
      createRun,
      resolveEffortSelection,
    } = makeService();

    resolveEffortSelection.mockReturnValue('high');

    const insertPending = vi
      .spyOn(ChatDeliveriesRepository.prototype, 'insertPending')
      .mockResolvedValue(
        asDouble<ChatDelivery>({
          id: request.messageId,
          chatId: request.chatId,
          producer: 'owner',
          state: 'pending',
          mode: 'queue',
          parts: [{ type: 'text', text: '/compact retain context' }],
          settings: {
            modelId: 'model-1',
            effort: 'high',
            permissionMode: 'default',
          },
        }),
      );

    activeRunLookup.mockResolvedValue(
      asDouble<Run>({ id: 'active-run', kind: 'turn', currentJobId: 'job-1' }),
    );
    dispatch.jobState.mockResolvedValue('queued');

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: 'retain context' },
        parts: [{ type: 'text' }],
        rawText: '/compact retain context',
        delivery: 'queue',
        effort: 'high',
      }),
    ).resolves.toMatchObject({
      type: 'delivery',
      delivery: {
        item: { id: request.messageId, mode: 'queue' },
        job: null,
      },
    });

    expect(insertPending).toHaveBeenCalledWith({
      id: request.messageId,
      chatId: request.chatId,
      ownerUserId: request.userId,
      mode: 'queue',
      parts: [{ type: 'text', text: '/compact retain context' }],
      settings: {
        modelId: 'model-1',
        effort: 'high',
        permissionMode: 'default',
      },
    });
    expect(createRun).not.toHaveBeenCalled();
  });

  it('omits unselected effort from a queued compact', async () => {
    const { service, activeRunLookup, dispatch } = makeService();

    const insertPending = vi
      .spyOn(ChatDeliveriesRepository.prototype, 'insertPending')
      .mockResolvedValue(
        asDouble<ChatDelivery>({
          id: request.messageId,
          chatId: request.chatId,
          producer: 'owner',
          state: 'pending',
          mode: 'queue',
          parts: [{ type: 'text', text: '/compact' }],
          settings: { modelId: 'model-1', permissionMode: 'default' },
        }),
      );

    activeRunLookup.mockResolvedValue(
      asDouble<Run>({ id: 'active-run', kind: 'turn', currentJobId: 'job-1' }),
    );
    dispatch.jobState.mockResolvedValue('queued');

    await service.execute({
      ...request,
      command: { name: 'compact', argument: '' },
      parts: [{ type: 'text' }],
      rawText: '/compact',
      delivery: 'queue',
    });

    expect(insertPending.mock.calls[0]?.[0].settings).not.toHaveProperty(
      'effort',
    );
  });

  it('rejects a queued compact when its id already exists', async () => {
    const { service, activeRunLookup, dispatch } = makeService();
    vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'insertPending',
    ).mockResolvedValue(undefined);
    activeRunLookup.mockResolvedValue(
      asDouble<Run>({ id: 'active-run', kind: 'turn', currentJobId: 'job-1' }),
    );
    dispatch.jobState.mockResolvedValue('queued');

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: '' },
        parts: [{ type: 'text' }],
        rawText: '/compact',
        delivery: 'queue',
      }),
    ).rejects.toThrow('Message id already exists');
  });

  it.each([
    ['another Chat', { chatId: 'chat-2' }],
    ['another producer', { producer: 'job' }],
    ['a delivered item', { state: 'delivered' }],
    ['a non-compact command', { parts: [{ type: 'text', text: '/rename x' }] }],
  ] as const)(
    'rejects a compact retry for %s',
    async (_description, override) => {
      const { service } = makeService();
      vi.spyOn(
        ChatDeliveriesRepository.prototype,
        'findById',
      ).mockResolvedValue(
        asDouble<ChatDelivery>({
          id: request.messageId,
          chatId: request.chatId,
          producer: 'owner',
          state: 'pending',
          parts: [{ type: 'text', text: '/compact retain context' }],
          ...override,
        }),
      );

      await expect(
        service.execute({
          ...request,
          command: { name: 'compact', argument: '' },
        }),
      ).rejects.toThrow('Message id already exists');
    },
  );

  it('returns the existing pending compact for an idempotent retry', async () => {
    const { service } = makeService();

    const existing = asDouble<ChatDelivery>({
      id: request.messageId,
      chatId: request.chatId,
      producer: 'owner',
      state: 'pending',
      mode: 'queue',
      parts: [{ type: 'text', text: '/compact retain context' }],
    });

    vi.spyOn(ChatDeliveriesRepository.prototype, 'findById').mockResolvedValue(
      existing,
    );

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: '' },
      }),
    ).resolves.toEqual({
      type: 'delivery',
      delivery: { item: existing, job: null },
    });
  });

  it('rejects a compact retry when the stored pending item is not a compact', async () => {
    const { service } = makeService();
    vi.spyOn(ChatDeliveriesRepository.prototype, 'findById').mockResolvedValue(
      asDouble<ChatDelivery>({
        id: request.messageId,
        chatId: request.chatId,
        producer: 'owner',
        state: 'pending',
        parts: [{ type: 'text', text: 'ordinary queued message' }],
      }),
    );

    await expect(
      service.execute({
        ...request,
        command: { name: 'compact', argument: '' },
      }),
    ).rejects.toThrow('Message id already exists');
  });
});
