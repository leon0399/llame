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
import { promoteNextQueueItem } from './queue-promotion';
import { RunEventsRepository, RunsRepository } from './runs-repository';

const at = new Date('2026-11-08T00:00:00.000Z');

const item = chatDeliveryRow({
  settings: { modelId: 'model-1', effort: 'high', permissionMode: 'bypass' },
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

  const validateModelSelection = vi.fn(() => {
    throw new Error('replaced by the test');
  });

  const models: ModelSelectionValidator = {
    validateModelSelection,
    resolveEffortSelection: (_model, requested) => requested,
  };

  validateModelSelection.mockReturnValue(asDouble({ id: 'model-1' }));

  const lock = vi
    .spyOn(ChatsRepository.prototype, 'lock')
    .mockResolvedValue(asDouble<Chat>({ archivedAt: null }));

  const firstPendingQueueItem = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'firstPendingQueueItem')
    .mockResolvedValue(item);

  const markDelivered = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'markDelivered')
    .mockResolvedValue(item);

  vi.spyOn(
    ChatDeliveriesRepository.prototype,
    'deliverPendingJobNotices',
  ).mockResolvedValue(undefined);

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
    validateModelSelection,
    lock,
    firstPendingQueueItem,
    markDelivered,
    createUserMessageIfAbsent,
    createRun,
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
        effort: 'high',
        permissionMode: 'bypass',
      }),
    );
    const runId = createRun.mock.calls[0]?.[0].id;
    expect(runId).toEqual(expect.any(String));
    expect(markDelivered).toHaveBeenCalledWith(item.id, item.ownerUserId, {
      messageId: item.id,
      runId,
    });
    expect(job).toMatchObject({
      runId,
      chatId: item.chatId,
      userId: item.ownerUserId,
      modelId: 'model-1',
    });
    expect(job?.userMessage).toMatchObject({ id: item.id, seq: 4 });
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
    const {
      promote,
      validateModelSelection,
      createUserMessageIfAbsent,
      createRun,
    } = makeSetup();

    validateModelSelection.mockImplementation(() => {
      throw new ModelNotAvailableError('model-1');
    });

    await expect(promote()).resolves.toBeUndefined();

    expect(validateModelSelection).toHaveBeenCalledWith('model-1');
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
