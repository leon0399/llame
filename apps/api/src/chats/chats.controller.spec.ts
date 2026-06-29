/* eslint-disable @typescript-eslint/unbound-method */

import { NotFoundException } from '@nestjs/common';
import { ChatsController } from './chats.controller';
import type { ChatsService } from './chats.service';
import type { Chat } from '../db/schema';

const chat: Chat = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'verified-user',
  title: 'Owned Chat',
  visibility: 'private',
  createdAt: new Date('2026-06-29T00:00:00.000Z'),
  updatedAt: new Date('2026-06-29T00:00:00.000Z'),
};

describe('ChatsController', () => {
  function makeController(service?: Partial<ChatsService>) {
    const chatsService = {
      getChatsByUserId: jest.fn().mockResolvedValue([chat]),
      getChatById: jest.fn().mockResolvedValue(chat),
      createChat: jest.fn().mockResolvedValue(chat),
      updateChat: jest.fn().mockResolvedValue(chat),
      ...service,
    } as unknown as jest.Mocked<ChatsService>;

    return { controller: new ChatsController(chatsService), chatsService };
  }

  it('lists chats for the verified user, not a client-supplied owner id', async () => {
    const { controller, chatsService } = makeController();

    await controller.getChats('verified-user');

    expect(chatsService.getChatsByUserId).toHaveBeenCalledWith('verified-user');
  });

  it('creates chats with ownerUserId from the verified session only', async () => {
    const { controller, chatsService } = makeController();

    await controller.createChat('verified-user', {
      title: 'New',
      ownerUserId: 'attacker',
    } as never);

    expect(chatsService.createChat).toHaveBeenCalledWith({
      ownerUserId: 'verified-user',
      title: 'New',
    });
  });

  it('patches a chat scoped to the verified user only', async () => {
    const { controller, chatsService } = makeController();

    await controller.updateChat('verified-user', chat.id, {
      title: 'Renamed',
      ownerUserId: 'attacker',
    } as never);

    expect(chatsService.updateChat).toHaveBeenCalledWith(
      chat.id,
      'verified-user',
      { title: 'Renamed', ownerUserId: 'attacker' },
    );
  });

  it('returns 404 when the verified user does not own the chat', async () => {
    const { controller } = makeController({
      getChatById: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      controller.getChatById('verified-user', chat.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
