import { ConflictException, NotFoundException } from '@nestjs/common';

import { type Chat } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { chatDeliveryRow } from '../testing/chat-delivery-rows';
import { asDouble } from '../testing/support';
import { ChatDeliveriesRepository } from './chat-deliveries.repository';
import { ChatDeliveriesService } from './chat-deliveries.service';
import { ChatsRepository } from './chats-repository';

const chatId = '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10';
const otherChatId = '9b2f1c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const userId = 'user-id';
const item = chatDeliveryRow({ chatId, ownerUserId: userId });

function makeService() {
  const tx = asDouble<Db>({});
  const tenantDb: TenantRunner = {
    runAs: <T>(_userId: string, callback: (scoped: Db) => Promise<T>) =>
      callback(tx),
  };
  return {
    service: new ChatDeliveriesService(tenantDb),
    findChat: vi.spyOn(ChatsRepository.prototype, 'findById'),
    listPending: vi.spyOn(ChatDeliveriesRepository.prototype, 'listPending'),
    withdrawPending: vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'withdrawPending',
    ),
    findItem: vi.spyOn(ChatDeliveriesRepository.prototype, 'findById'),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatDeliveriesService.listPending', () => {
  it('lists the pending items of a Chat the owner can see', async () => {
    const { service, findChat, listPending } = makeService();
    findChat.mockResolvedValue(asDouble<Chat>({ id: chatId }));
    listPending.mockResolvedValue([item]);

    await expect(service.listPending(chatId, userId)).resolves.toEqual([item]);

    expect(findChat).toHaveBeenCalledWith(chatId, userId);
    expect(listPending).toHaveBeenCalledWith(chatId, userId);
  });

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
  it('returns the withdrawn item without looking for a reason', async () => {
    const { service, withdrawPending, findItem } = makeService();
    withdrawPending.mockResolvedValue({ ...item, state: 'withdrawn' });

    await expect(service.withdraw(chatId, item.id, userId)).resolves.toEqual({
      ...item,
      state: 'withdrawn',
    });

    expect(withdrawPending).toHaveBeenCalledWith(chatId, item.id, userId);
    expect(findItem).not.toHaveBeenCalled();
  });

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
