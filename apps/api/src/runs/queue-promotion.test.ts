import { type Chat, type Message, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import {
  ModelNotAvailableError,
  type ModelSelectionValidator,
} from '../models/models.service';
import { chatDeliveryRow } from '../testing/chat-delivery-rows';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { asDouble } from '../testing/support';
import {
  promoteNextQueueItem,
  resolveItemRunSettings,
} from './queue-promotion';
import { RunEventsRepository, RunsRepository } from './runs-repository';

const at = new Date('2026-11-08T00:00:00.000Z');

const item = chatDeliveryRow({
  settings: { selector: 'model-1', effort: 'high', permissionMode: 'bypass' },
});

const completed = asDouble<Run>({
  id: 'completed-run',
  chatId: item.chatId,
  userId: item.ownerUserId,
});

const message = asDouble<Message>({
  id: item.id,
  chatId: item.chatId,
  seq: 4,
  role: 'user',
  senderUserId: item.ownerUserId,
  parts: item.parts,
  createdAt: at,
});

function makeSetup(
  enabledPermissionModes: ReadonlyArray<PermissionMode> = ['default', 'bypass'],
) {
  const tx = asDouble<Db>({
    transaction: <T>(callback: (inner: Db) => Promise<T>) => callback(tx),
  });

  const resolveSelection = vi.fn<ModelSelectionValidator['resolveSelection']>(
    () => {
      throw new Error('replaced by the test');
    },
  );

  const models: ModelSelectionValidator = {
    validateModelSelection: () => {
      throw new Error('unused by the resolver');
    },
    resolveEffortSelection: (_model, requested) => requested,
    resolveSelection,
  };

  resolveSelection.mockReturnValue({
    selector: 'model-1',
    model: asDouble({ id: 'model-1' }),
    effort: 'high',
    nextSelection: undefined,
  });

  const lock = vi
    .spyOn(ChatsRepository.prototype, 'lock')
    .mockResolvedValue(
      asDouble<Chat>({ archivedAt: null, modelSelection: null }),
    );

  vi.spyOn(ChatsRepository.prototype, 'transactionNow').mockResolvedValue(at);

  const firstPendingQueueItem = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'firstPendingQueueItem')
    .mockResolvedValue(item);

  const markDelivered = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'markDelivered')
    .mockResolvedValue(item);

  const deliverPendingJobNotices = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'deliverPendingJobNotices')
    .mockResolvedValue(undefined);

  const createUserMessageIfAbsent = vi
    .spyOn(MessagesRepository.prototype, 'createUserMessageIfAbsent')
    .mockResolvedValue(message);

  vi.spyOn(
    RunsRepository.prototype,
    'cancelActiveRunsForMessage',
  ).mockResolvedValue([]);

  const createRun = vi
    .spyOn(RunsRepository.prototype, 'create')
    .mockImplementation((created) =>
      Promise.resolve(asDouble<Run>({ ...created, status: 'queued' })),
    );

  vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue(
    asDouble({}),
  );

  const promote = () =>
    promoteNextQueueItem(tx, {
      completed,
      models,
      enabledPermissionModes,
    });

  return {
    promote,
    models,
    resolveSelection,
    lock,
    firstPendingQueueItem,
    markDelivered,
    createUserMessageIfAbsent,
    createRun,
    deliverPendingJobNotices,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('promoteNextQueueItem', () => {
  it('stores the first pending item under its id and starts its Run with the settings it was sent with', async () => {
    const {
      promote,
      lock,
      createUserMessageIfAbsent,
      createRun,
      markDelivered,
      deliverPendingJobNotices,
    } = makeSetup();

    const job = await promote();

    expect(lock).toHaveBeenCalledWith(item.chatId, item.ownerUserId);
    expect(createUserMessageIfAbsent).toHaveBeenCalledWith({
      id: item.id,
      chatId: item.chatId,
      senderUserId: item.ownerUserId,
      parts: item.parts,
    });
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: item.chatId,
        messageId: item.id,
        userId: item.ownerUserId,
        modelId: 'model-1',
        selector: 'model-1',
        effort: 'high',
        selectedEffort: 'high',
        permissionMode: 'bypass',
      }),
    );
    const runId = createRun.mock.calls[0]?.[0].id;
    expect(runId).toEqual(expect.any(String));
    expect(markDelivered).toHaveBeenCalledWith(item.id, item.ownerUserId, {
      messageId: item.id,
      runId,
    });
    expect(deliverPendingJobNotices).toHaveBeenCalledWith(
      item.chatId,
      item.ownerUserId,
      { messageId: item.id, runId },
    );
    expect(job).toMatchObject({
      runId,
      chatId: item.chatId,
      userId: item.ownerUserId,
      modelId: 'model-1',
    });
    expect(job?.userMessage).toMatchObject({ id: item.id, seq: 4 });
  });

  it('starts the item under the stored selection and records its revision', async () => {
    const {
      promote,
      resolveSelection,
      lock,
      createRun,
      createUserMessageIfAbsent,
    } = makeSetup();

    const stored = {
      revision: 4,
      selector: 'model-stored',
      effort: 'low',
    };

    lock.mockResolvedValue(
      asDouble<Chat>({ archivedAt: null, modelSelection: stored }),
    );
    resolveSelection.mockReturnValue({
      selector: 'model-stored',
      model: asDouble({ id: 'model-stored' }),
      effort: 'high',
      nextSelection: undefined,
    });

    await promote();

    expect(resolveSelection).toHaveBeenCalledWith(
      stored,
      { selector: 'model-1', effort: 'high' },
      'derived',
      at,
    );
    expect(createUserMessageIfAbsent).toHaveBeenCalled();
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'model-stored',
        selector: 'model-stored',
        effort: 'high',
        selectedEffort: 'high',
        selectionRevision: 4,
      }),
    );
  });

  it('stores a resolved hold clear only after the promoted Run starts', async () => {
    const { promote, resolveSelection, lock } = makeSetup();

    const nextSelection = {
      revision: 5,
      selector: 'model-1',
      effort: null,
    };

    lock.mockResolvedValue(
      asDouble<Chat>({
        id: item.chatId,
        ownerUserId: item.ownerUserId,
        archivedAt: null,
        modelSelection: null,
      }),
    );

    resolveSelection.mockReturnValue({
      selector: 'model-1',
      model: asDouble({ id: 'model-1' }),
      effort: 'high',
      nextSelection,
    });

    const storeSelection = vi
      .spyOn(ChatsRepository.prototype, 'setModelSelection')
      .mockResolvedValue(undefined);

    const promoted = await promote();

    expect(promoted?.runId).toBeDefined();
    expect(storeSelection).toHaveBeenCalledWith(
      item.chatId,
      item.ownerUserId,
      nextSelection,
    );
  });

  it('starts a queued compact as a message-less compaction Run', async () => {
    const commandItem = chatDeliveryRow({
      parts: [{ type: 'text', text: '/compact keep the plan' }],
      settings: {
        selector: 'model-1',
        effort: 'high',
        permissionMode: 'bypass',
      },
    });

    const { promote, createUserMessageIfAbsent, markDelivered, createRun } =
      makeSetup();

    vi.spyOn(
      MessagesRepository.prototype,
      'findActiveCheckpoint',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue(
      [],
    );
    vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'firstPendingQueueItem',
    ).mockResolvedValue(commandItem);

    const job = await promote();

    expect(createUserMessageIfAbsent).not.toHaveBeenCalled();
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: commandItem.chatId,
        messageId: null,
        kind: 'compaction',
        modelId: 'model-1',
        selector: 'model-1',
        effort: 'high',
        selectedEffort: 'high',
        permissionMode: 'bypass',
      }),
    );
    expect(markDelivered).toHaveBeenCalledWith(
      commandItem.id,
      commandItem.ownerUserId,
      { runId: createRun.mock.calls[0]?.[0].id },
    );
    expect(job?.userMessage).toBeUndefined();
  });

  it('leaves an invalid queued compact pending', async () => {
    const commandItem = chatDeliveryRow({
      parts: [{ type: 'text', text: `/compact ${'x'.repeat(1001)}` }],
    });

    const { promote, createUserMessageIfAbsent, markDelivered, createRun } =
      makeSetup();

    vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'firstPendingQueueItem',
    ).mockResolvedValue(commandItem);

    await expect(promote()).resolves.toBeUndefined();

    expect(createUserMessageIfAbsent).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('promotes nothing for a Chat that is gone', async () => {
    const { promote, lock, firstPendingQueueItem, createRun } = makeSetup();
    lock.mockResolvedValue(undefined);

    await expect(promote()).resolves.toBeUndefined();

    expect(firstPendingQueueItem).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  it('promotes nothing for an archived Chat', async () => {
    const { promote, lock, firstPendingQueueItem, createRun } = makeSetup();
    lock.mockResolvedValue(asDouble<Chat>({ archivedAt: at }));

    await expect(promote()).resolves.toBeUndefined();

    expect(firstPendingQueueItem).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  it('promotes nothing when no queue item is pending', async () => {
    const { promote, firstPendingQueueItem, createUserMessageIfAbsent } =
      makeSetup();

    firstPendingQueueItem.mockResolvedValue(undefined);

    await expect(promote()).resolves.toBeUndefined();

    expect(firstPendingQueueItem).toHaveBeenCalledWith(
      item.chatId,
      item.ownerUserId,
    );
    expect(createUserMessageIfAbsent).not.toHaveBeenCalled();
  });

  it('leaves an item pending, and starts nothing, when its model is no longer available', async () => {
    const { promote, resolveSelection, createUserMessageIfAbsent, createRun } =
      makeSetup();

    resolveSelection.mockImplementation(() => {
      throw new ModelNotAvailableError('model-1');
    });

    await expect(promote()).resolves.toBeUndefined();

    expect(resolveSelection).toHaveBeenCalledWith(
      null,
      { selector: 'model-1', effort: 'high' },
      'derived',
      at,
    );
    expect(createUserMessageIfAbsent).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  it('leaves an item pending when its permission mode is no longer enabled', async () => {
    const { promote, createUserMessageIfAbsent, createRun } = makeSetup([
      'default',
    ]);

    await expect(promote()).resolves.toBeUndefined();

    expect(createUserMessageIfAbsent).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  it('keeps the hold when a promotion is skipped before its item starts', async () => {
    const { promote, resolveSelection, lock, firstPendingQueueItem } =
      makeSetup();

    const stored = {
      revision: 1,
      selector: '@coding',
      effort: 'high',
      hold: {
        selector: '@coding',
        modelId: 'model-1',
        effort: null,
        revertAt: '2026-11-09T00:00:00.000Z',
      },
    };

    lock.mockResolvedValue(
      asDouble<Chat>({ archivedAt: null, modelSelection: stored }),
    );

    firstPendingQueueItem.mockResolvedValue({
      ...item,
      settings: { ...item.settings, selector: '@coding' },
    });
    resolveSelection.mockReturnValue({
      selector: '@coding',
      model: asDouble({ id: 'model-1' }),
      effort: 'low',
      nextSelection: {
        revision: 2,
        selector: '@coding',
        effort: null,
      },
    });

    vi.spyOn(
      MessagesRepository.prototype,
      'createUserMessageIfAbsent',
    ).mockResolvedValue(undefined);

    const storeSelection = vi.spyOn(
      ChatsRepository.prototype,
      'setModelSelection',
    );

    await expect(promote()).resolves.toBeUndefined();

    expect(resolveSelection).toHaveBeenCalledWith(
      stored,
      { effort: 'high' },
      'derived',
      at,
    );
    expect(storeSelection).not.toHaveBeenCalled();
  });

  it('passes a notice effort policy for hold precedence', () => {
    const { models, resolveSelection } = makeSetup();

    resolveItemRunSettings({
      models,
      enabledPermissionModes: ['default', 'bypass'],
      settings: item.settings,
      stored: null,
      effortPolicy: 'preferred',
      now: at,
    });

    expect(resolveSelection).toHaveBeenCalledWith(
      null,
      {
        selector: 'model-1',
        effort: 'high',
        effortPolicy: 'preferred',
      },
      'derived',
      at,
    );
  });

  it('leaves an item waiting when its id is already a message', async () => {
    const { promote, createUserMessageIfAbsent, createRun, markDelivered } =
      makeSetup();

    createUserMessageIfAbsent.mockResolvedValue(undefined);

    await expect(promote()).resolves.toBeUndefined();

    expect(createRun).not.toHaveBeenCalled();
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('starts nothing when the item stopped being pending before its delivery', async () => {
    const { promote, markDelivered } = makeSetup();
    markDelivered.mockResolvedValue(undefined);

    await expect(promote()).resolves.toBeUndefined();
  });

  it('propagates any other failure of the savepoint', async () => {
    const { promote, createRun } = makeSetup();
    createRun.mockRejectedValue(new Error('database down'));

    await expect(promote()).rejects.toThrow('database down');
  });
});
