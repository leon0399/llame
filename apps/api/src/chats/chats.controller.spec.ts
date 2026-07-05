/* eslint-disable @typescript-eslint/unbound-method */

import { NotFoundException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { Request, Response as ExpressResponse } from 'express';
import { ChatsController } from './chats.controller';
import type { ChatLoopService } from './chat-loop.service';
import type { ChatsService } from './chats.service';
import type { Chat, Message } from '../db/schema';

const chat: Chat = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'verified-user',
  title: 'Owned Chat',
  visibility: 'private',
  createdAt: new Date('2026-06-29T00:00:00.000Z'),
  updatedAt: new Date('2026-06-29T00:00:00.000Z'),
};

const chatMessages: Message[] = [
  {
    id: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
    chatId: chat.id,
    seq: 1,
    role: 'user',
    senderUserId: 'verified-user',
    parts: [{ type: 'text', text: 'Hello' }],
    attachments: [],
    usage: null,
    inReplyTo: null,
    createdAt: new Date('2026-06-29T00:01:00.000Z'),
  },
  {
    id: 'cc5ce18b-2f3a-4f6b-8c95-f9c6240a8f02',
    chatId: chat.id,
    seq: 2,
    role: 'assistant',
    senderUserId: null,
    parts: [{ type: 'text', text: 'Hi' }],
    attachments: [],
    usage: { status: 'completed', finishReason: 'stop' },
    inReplyTo: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
    createdAt: new Date('2026-06-29T00:01:01.000Z'),
  },
];

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
      listChatsWithLastMessage: jest
        .fn()
        .mockResolvedValue([{ chat, lastMessage: chatMessages[1] }]),
      getChatById: jest.fn().mockResolvedValue(chat),
      getChatMessages: jest.fn().mockResolvedValue(chatMessages),
      updateChat: jest.fn().mockResolvedValue(chat),
      ...service,
    } as unknown as jest.Mocked<ChatsService>;
    const chatLoopService = {
      createMessageStream: jest.fn(),
    } as unknown as jest.Mocked<ChatLoopService>;
    const tenantDb = {
      runAs: jest.fn(),
    } as unknown as jest.Mocked<
      import('../db/tenant-db.service').TenantDbService
    >;
    const bridge = {
      createUiMessageStreamResponse: jest.fn(),
    } as unknown as jest.Mocked<
      import('../runs/run-stream-bridge').RunStreamBridgeService
    >;

    return {
      controller: new ChatsController(
        chatsService,
        chatLoopService,
        tenantDb,
        bridge,
      ),
      chatsService,
      chatLoopService,
      tenantDb,
      bridge,
    };
  }

  it('lists chats for the verified user, not a client-supplied owner id', async () => {
    const { controller, chatsService } = makeController();

    await controller.getChats('verified-user');

    expect(chatsService.listChatsWithLastMessage).toHaveBeenCalledWith(
      'verified-user',
    );
  });

  it('maps the latest message to a text-only excerpt on list items', async () => {
    const { controller } = makeController();

    const result = await controller.getChats('verified-user');

    expect(result).toEqual([
      expect.objectContaining({
        id: chat.id,
        lastMessage: 'Hi',
      }),
    ]);
  });

  it('returns lastMessage null for a chat without messages', async () => {
    const { controller } = makeController({
      listChatsWithLastMessage: jest
        .fn()
        .mockResolvedValue([{ chat, lastMessage: undefined }]),
    });

    const result = await controller.getChats('verified-user');

    expect(result[0].lastMessage).toBeNull();
  });

  it('omits non-text parts from the excerpt and truncates long text', async () => {
    const longText = 'word '.repeat(60).trim();
    const toolMessage: Message = {
      ...chatMessages[1],
      parts: [
        { type: 'tool-call', toolName: 'search_web' },
        { type: 'text', text: longText },
      ],
    };
    const { controller } = makeController({
      listChatsWithLastMessage: jest
        .fn()
        .mockResolvedValue([{ chat, lastMessage: toolMessage }]),
    });

    const [item] = await controller.getChats('verified-user');

    expect(item.lastMessage?.length).toBeLessThanOrEqual(160);
    expect(item.lastMessage?.endsWith('…')).toBe(true);
    expect(item.lastMessage).not.toContain('tool-call');
  });

  it('reads chat messages for the verified user only', async () => {
    const { controller, chatsService } = makeController();

    const result = await controller.getChatMessages('verified-user', chat.id, {
      limit: 100,
    });

    expect(chatsService.getChatMessages).toHaveBeenCalledWith(
      chat.id,
      'verified-user',
      { limit: 100, beforeSeq: undefined },
    );
    expect(result).toEqual({
      messages: [
        {
          id: chatMessages[0].id,
          chatId: chat.id,
          seq: 1,
          role: 'user',
          senderUserId: 'verified-user',
          parts: [{ type: 'text', text: 'Hello' }],
          attachments: [],
          usage: null,
          inReplyTo: null,
          createdAt: new Date('2026-06-29T00:01:00.000Z'),
        },
        {
          id: chatMessages[1].id,
          chatId: chat.id,
          seq: 2,
          role: 'assistant',
          senderUserId: null,
          parts: [{ type: 'text', text: 'Hi' }],
          attachments: [],
          usage: { status: 'completed', finishReason: 'stop' },
          inReplyTo: chatMessages[0].id,
          createdAt: new Date('2026-06-29T00:01:01.000Z'),
        },
      ],
    });
  });

  it('returns 404 when the verified user cannot read chat messages', async () => {
    const { controller } = makeController({
      getChatMessages: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      controller.getChatMessages('verified-user', chat.id, { limit: 100 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns an empty message list for an owned chat with no messages', async () => {
    const { controller } = makeController({
      getChatMessages: jest.fn().mockResolvedValue([]),
    });

    await expect(
      controller.getChatMessages('verified-user', chat.id, { limit: 100 }),
    ).resolves.toEqual({ messages: [] });
  });

  it('passes message history pagination options to the service', async () => {
    const { controller, chatsService } = makeController();

    await controller.getChatMessages('verified-user', chat.id, {
      limit: 25,
      beforeSeq: 42,
    });

    expect(chatsService.getChatMessages).toHaveBeenCalledWith(
      chat.id,
      'verified-user',
      { limit: 25, beforeSeq: 42 },
    );
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
    const [call] = chatLoopService.createMessageStream.mock.calls[0];
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

  it('resume: 204 with no active run — scoped to the verified user (RLS path)', async () => {
    const { controller, tenantDb, bridge } = makeController();
    tenantDb.runAs.mockResolvedValue(undefined);
    const response = {
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      destroyed: false,
    };
    const request = { destroyed: false } as never;

    await controller.resumeChatStream(
      'verified-user',
      'chat-1',
      request,
      response as never,
    );

    // Tenant scoping comes from the session-derived userId, never the client.
    expect(tenantDb.runAs).toHaveBeenCalledWith(
      'verified-user',
      expect.any(Function),
    );
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.end).toHaveBeenCalled();
    expect(bridge.createUiMessageStreamResponse).not.toHaveBeenCalled();
  });

  it('resume: bridges the active run for the verified user', async () => {
    const { controller, tenantDb, bridge } = makeController();
    tenantDb.runAs.mockResolvedValue({ id: 'run-1' });
    bridge.createUiMessageStreamResponse.mockReturnValue(
      new Response(null, { status: 200 }),
    );
    const response = {
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      setHeader: jest.fn(),
      write: jest.fn(),
      destroyed: false,
      writableEnded: false,
    };
    const request = { destroyed: false } as never;

    await controller.resumeChatStream(
      'verified-user',
      'chat-1',
      request,
      response as never,
    );

    expect(bridge.createUiMessageStreamResponse).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', userId: 'verified-user' }),
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
