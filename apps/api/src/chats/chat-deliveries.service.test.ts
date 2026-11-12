import { ConflictException, NotFoundException } from '@nestjs/common';

import { type Chat, type Run } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type ModelSelectionValidator } from '../models/models.service';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import { RunsRepository } from '../runs/runs-repository';
import { chatDeliveryRow } from '../testing/chat-delivery-rows';
import { asDouble } from '../testing/support';
import { ChatDeliveriesRepository } from './chat-deliveries.repository';
import { ChatDeliveriesService } from './chat-deliveries.service';
import { ChatsRepository } from './chats-repository';
import { MessagesRepository } from './messages-repository';

const chatId = '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10';
const otherChatId = '9b2f1c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const userId = 'user-id';
const item = chatDeliveryRow({ chatId, ownerUserId: userId });

function makeService() {
  const dispatcher = asDouble<RunDispatcher>({
    dispatch: vi.fn().mockResolvedValue(undefined),
    jobState: vi.fn().mockResolvedValue('active'),
  });

  const models = {
    validateModelSelection: vi.fn(),
    resolveEffortSelection: vi.fn(),
  };

  const execute = vi.fn(() => Promise.resolve([]));
  const tx = asDouble<Db>({ execute });

  const tenantDb: TenantRunner = {
    runAs: <T>(_userId: string, callback: (scoped: Db) => Promise<T>) =>
      callback(tx),
  };

  return {
    service: new ChatDeliveriesService(
      tenantDb,
      asDouble<ModelSelectionValidator>(models),
      asDouble<InstanceConfigReader>({
        config: { tools: { permissionModes: ['default'] }, models: [] },
      }),
      dispatcher,
    ),
    dispatcher,
    execute,
    models,
    findChat: vi.spyOn(ChatsRepository.prototype, 'findById'),
    listPending: vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'listPendingViews',
    ),
    withdrawPending: vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'withdrawPending',
    ),
    findItem: vi
      .spyOn(ChatDeliveriesRepository.prototype, 'findById')
      .mockResolvedValue(item),
    findActiveRun: vi.spyOn(RunsRepository.prototype, 'findActiveByChatId'),
    createMessage: vi.spyOn(
      MessagesRepository.prototype,
      'createUserMessageIfAbsent',
    ),
    lockChat: vi.spyOn(ChatsRepository.prototype, 'lock'),
    changePendingMode: vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'changePendingMode',
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatDeliveriesService.listPending', () => {
  it('answers 404 naming the Chat, and reads no items, for a Chat the owner cannot see', async () => {
    const { service, findChat, listPending } = makeService();
    findChat.mockResolvedValue(undefined);

    await expect(service.listPending(chatId, userId)).rejects.toThrow(
      new NotFoundException(`Chat ${chatId} not found`),
    );

    expect(listPending).not.toHaveBeenCalled();
  });
});

describe('ChatDeliveriesService.withdraw', () => {
  it('answers 409 when the item of this Chat is no longer pending', async () => {
    const { service, withdrawPending, findItem } = makeService();
    withdrawPending.mockResolvedValue(undefined);
    findItem.mockResolvedValue({ ...item, state: 'delivered' });

    const attempt = () => service.withdraw(chatId, item.id, userId);

    await expect(attempt()).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt()).rejects.toThrow('The item is no longer pending');
    expect(findItem).toHaveBeenCalledWith(item.id, userId);
  });

  it('answers 404 naming the item when it belongs to another Chat', async () => {
    const { service, withdrawPending, findItem } = makeService();
    withdrawPending.mockResolvedValue(undefined);
    findItem.mockResolvedValue({ ...item, chatId: otherChatId });

    await expect(service.withdraw(chatId, item.id, userId)).rejects.toThrow(
      new NotFoundException(`Delivery ${item.id} not found`),
    );
  });

  it('answers 404 naming the item when no item of the owner has the id', async () => {
    const { service, withdrawPending, findItem } = makeService();
    withdrawPending.mockResolvedValue(undefined);
    findItem.mockResolvedValue(undefined);

    await expect(service.withdraw(chatId, item.id, userId)).rejects.toThrow(
      new NotFoundException(`Delivery ${item.id} not found`),
    );
  });
});

describe('ChatDeliveriesService.changeMode', () => {
  it('answers 404 naming the Chat, and changes nothing, for a Chat the owner cannot see', async () => {
    const { service, lockChat, findActiveRun, changePendingMode } =
      makeService();

    lockChat.mockResolvedValue(undefined);

    await expect(
      service.changeMode(chatId, item.id, 'steer', userId),
    ).rejects.toThrow(new NotFoundException(`Chat ${chatId} not found`));

    expect(findActiveRun).not.toHaveBeenCalled();
    expect(changePendingMode).not.toHaveBeenCalled();
  });

  it('returns the changed item and starts no Run while a live Run holds the slot', async () => {
    const {
      service,
      lockChat,
      findActiveRun,
      changePendingMode,
      models,
      createMessage,
    } = makeService();

    lockChat.mockResolvedValue(
      asDouble<Chat>({ id: chatId, archivedAt: null }),
    );
    findActiveRun.mockResolvedValue(asDouble<Run>({ id: 'run-1' }));
    const changed = { ...item, mode: 'steer' as const };
    changePendingMode.mockResolvedValue(changed);

    await service.changeMode(chatId, item.id, 'steer', userId);

    expect(changePendingMode).toHaveBeenCalledWith(
      chatId,
      item.id,
      userId,
      'steer',
    );
    expect(models.validateModelSelection).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['interrupt', 1],
    ['steer', 0],
  ] as const)(
    'a live Run is told about an item changed to %s: %i pointer(s)',
    async (mode, pointers) => {
      const { service, lockChat, findActiveRun, changePendingMode, execute } =
        makeService();

      lockChat.mockResolvedValue(
        asDouble<Chat>({ id: chatId, archivedAt: null }),
      );
      findActiveRun.mockResolvedValue(asDouble<Run>({ id: 'run-1' }));
      changePendingMode.mockResolvedValue({ ...item, mode });

      await service.changeMode(chatId, item.id, mode, userId);

      const pointer = JSON.stringify(
        JSON.stringify({ runId: 'run-1', kind: 'interrupt' }),
      );

      const sent = execute.mock.calls.filter((call) =>
        JSON.stringify(call).includes(pointer),
      );

      expect(sent).toHaveLength(pointers);
    },
  );

  it('answers 409 when the id of the item is already a message', async () => {
    const {
      service,
      lockChat,
      findActiveRun,
      changePendingMode,
      models,
      createMessage,
    } = makeService();

    lockChat.mockResolvedValue(
      asDouble<Chat>({ id: chatId, archivedAt: null }),
    );
    findActiveRun.mockResolvedValue(undefined);
    changePendingMode.mockResolvedValue({ ...item, mode: 'steer' });
    createMessage.mockResolvedValue(undefined);

    const attempt = () => service.changeMode(chatId, item.id, 'steer', userId);

    await expect(attempt()).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt()).rejects.toThrow('Message id already exists');
    expect(models.validateModelSelection).toHaveBeenCalledWith(
      item.settings.modelId,
    );
  });
});
