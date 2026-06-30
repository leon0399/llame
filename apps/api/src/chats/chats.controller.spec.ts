/* eslint-disable @typescript-eslint/unbound-method */

import { NotFoundException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { Request, Response as ExpressResponse } from 'express';
import { ChatsController } from './chats.controller';
import type { ChatLoopService } from './chat-loop.service';
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
  function makeWritableResponse(): ExpressResponse {
    const response = new EventEmitter() as unknown as ExpressResponse & {
      status: jest.Mock;
      setHeader: jest.Mock;
      end: jest.Mock;
      writableEnded: boolean;
    };
    response.status = jest.fn().mockReturnValue(response);
    response.setHeader = jest.fn().mockReturnValue(response);
    response.end = jest.fn(() => {
      response.writableEnded = true;
      return response;
    });
    response.writableEnded = false;
    return response;
  }

  function makeController(service?: Partial<ChatsService>) {
    const chatsService = {
      getChatsByUserId: jest.fn().mockResolvedValue([chat]),
      getChatById: jest.fn().mockResolvedValue(chat),
      createChat: jest.fn().mockResolvedValue(chat),
      updateChat: jest.fn().mockResolvedValue(chat),
      ...service,
    } as unknown as jest.Mocked<ChatsService>;
    const chatLoopService = {
      createMessageStream: jest.fn(),
    } as unknown as jest.Mocked<ChatLoopService>;

    return {
      controller: new ChatsController(chatsService, chatLoopService),
      chatsService,
      chatLoopService,
    };
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

  it('streams messages with userId from the verified session only', async () => {
    const { controller, chatLoopService } = makeController();
    const streamResult = {
      toUIMessageStreamResponse: jest.fn(() => new Response(null)),
    } as unknown as Awaited<ReturnType<ChatLoopService['createMessageStream']>>;
    chatLoopService.createMessageStream.mockResolvedValue(streamResult);

    const userMessageId = '0910fd41-1f2f-49de-b1c2-00ff4b3c7c60';
    await controller.createMessage(
      'verified-user',
      chat.id,
      {
        userId: 'attacker',
        message: {
          id: userMessageId,
          parts: [{ type: 'text', text: 'Hello' }],
        },
      } as never,
      new EventEmitter() as Request,
      makeWritableResponse(),
    );

    expect(chatLoopService.createMessageStream).toHaveBeenCalledTimes(1);
    const [call] = chatLoopService.createMessageStream.mock.calls[0] as [
      Parameters<ChatLoopService['createMessageStream']>[0],
    ];
    expect(call).toMatchObject({
      chatId: chat.id,
      userId: 'verified-user',
      message: {
        id: userMessageId,
        parts: [{ type: 'text', text: 'Hello' }],
      },
    });
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
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
