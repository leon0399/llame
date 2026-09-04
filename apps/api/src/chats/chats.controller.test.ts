import { NotFoundException } from '@nestjs/common';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Writable } from 'node:stream';
import {
  ChatsController,
  type ChatsControllerService,
} from './chats.controller';
import { CHAT_MESSAGES_DEFAULT_LIMIT } from './dto/chats.dto';
import type { ChatLoopService } from './chat-loop.service';
import * as schema from '../db/schema';
import type { Chat, Compaction, Message } from '../db/schema';
import type { Db, TenantRunner } from '../db/tenant-db.service';
import type { RunStreamResponder } from '../runs/run-stream-bridge';
import {
  ModelConfigurationError,
  ModelNotAvailableError,
} from '../models/models.service';

const chat: Chat = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'verified-user',
  title: 'Owned Chat',
  visibility: 'private',
  createdAt: new Date('2026-06-29T00:00:00.000Z'),
  updatedAt: new Date('2026-06-29T00:00:00.000Z'),
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
};

const chatMessages: Array<Message> = [
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
  function makeWritableResponse() {
    const response = Object.assign(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      {
        status: vi.fn(),
        setHeader: vi.fn(),
        headersSent: false,
      },
    );
    response.status.mockReturnValue(response);
    response.setHeader.mockReturnValue(response);
    return response;
  }

  function makeController(service?: Partial<ChatsControllerService>) {
    const chatsService = {
      listChatsWithLastMessage: vi
        .fn<ChatsControllerService['listChatsWithLastMessage']>()
        .mockResolvedValue([{ chat, lastMessage: chatMessages[1] }]),
      searchChats: vi.fn<ChatsControllerService['searchChats']>(),
      getChatById: vi
        .fn<ChatsControllerService['getChatById']>()
        .mockResolvedValue(chat),
      getChatMessages: vi
        .fn<ChatsControllerService['getChatMessages']>()
        .mockResolvedValue({
          messages: chatMessages,
          compaction: undefined,
          absorbedMessageCount: null,
        }),
      updateChat: vi
        .fn<ChatsControllerService['updateChat']>()
        .mockResolvedValue(chat),
      deleteChat: vi.fn<ChatsControllerService['deleteChat']>(),
      forkChat: vi.fn<ChatsControllerService['forkChat']>(),
    } satisfies ChatsControllerService;
    Object.assign(chatsService, service);
    const chatLoopService = {
      createMessageStream: vi.fn<ChatLoopService['createMessageStream']>(),
    } satisfies Pick<ChatLoopService, 'createMessageStream'>;
    const tx: Db = drizzle.mock({ schema });
    const runAs: TenantRunner['runAs'] = async <T>(
      _userId: string,
      callback: (scoped: Db) => Promise<T>,
    ) => callback(tx);
    const tenantDb: TenantRunner = { runAs };
    const runAsSpy = vi.spyOn(tenantDb, 'runAs');
    const bridge = {
      createUiMessageStreamResponse:
        vi.fn<RunStreamResponder['createUiMessageStreamResponse']>(),
    } satisfies RunStreamResponder;

    return {
      controller: new ChatsController(
        chatsService,
        chatLoopService,
        tenantDb,
        bridge,
      ),
      chatsService,
      chatLoopService,
      runAsSpy,
      bridge,
    };
  }

  it('lists chats for the verified user, not a client-supplied owner id', async () => {
    const { controller, chatsService } = makeController();

    await controller.getChats('verified-user', {});

    expect(chatsService.listChatsWithLastMessage).toHaveBeenCalledWith(
      'verified-user',
      { projectId: undefined },
    );
  });

  it('maps the latest message to a text-only excerpt on list items', async () => {
    const { controller } = makeController();

    const result = await controller.getChats('verified-user', {});

    expect(result).toEqual([
      expect.objectContaining({
        id: chat.id,
        lastMessage: 'Hi',
      }),
    ]);
  });

  it('returns lastMessage null for a chat without messages', async () => {
    const { controller } = makeController({
      listChatsWithLastMessage: vi
        .fn()
        .mockResolvedValue([{ chat, lastMessage: undefined }]),
    });

    const result = await controller.getChats('verified-user', {});

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
      listChatsWithLastMessage: vi
        .fn()
        .mockResolvedValue([{ chat, lastMessage: toolMessage }]),
    });

    const [item] = await controller.getChats('verified-user', {});

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
      { limit: 100, beforeSeq: undefined, targetSeq: undefined },
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
      compaction: null,
    });
  });

  it('embeds the latest compaction (#136) with derived stats, null-safe when usage is absent', async () => {
    const compaction: Compaction = {
      id: '11111111-1111-1111-1111-111111111111',
      chatId: chat.id,
      uptoSeq: 5,
      parentId: null,
      summary: 'Absorbed the first five turns.',
      replacementHistory: [
        {
          role: 'user',
          parts: [
            {
              type: 'text',
              text: '<system-reminder>checkpoint</system-reminder>',
            },
          ],
        },
      ],
      usage: null,
      createdAt: new Date('2026-07-06T00:00:00.000Z'),
    };
    const { controller } = makeController({
      getChatMessages: vi.fn().mockResolvedValue({
        messages: [],
        compaction,
        absorbedMessageCount: 5,
      }),
    });

    const result = await controller.getChatMessages('verified-user', chat.id, {
      limit: 100,
    });

    expect(result.compaction).toEqual({
      uptoSeq: 5,
      summary: 'Absorbed the first five turns.',
      createdAt: new Date('2026-07-06T00:00:00.000Z'),
      stats: {
        absorbedMessageCount: 5,
        beforeTokens: null,
        afterTokens: null,
        modelId: null,
      },
    });
  });

  it("embeds compaction stats derived from usage's input/output tokens and modelId, when present", async () => {
    const compaction: Compaction = {
      id: '22222222-2222-2222-2222-222222222222',
      chatId: chat.id,
      uptoSeq: 5,
      parentId: null,
      summary: 'Absorbed the first five turns.',
      replacementHistory: [
        {
          role: 'user',
          parts: [
            {
              type: 'text',
              text: '<system-reminder>checkpoint</system-reminder>',
            },
          ],
        },
      ],
      usage: {
        inputTokens: 71_400,
        cachedInputTokens: 0,
        outputTokens: 1280,
        totalTokens: 72_680,
        modelId: 'system:openai:gpt-4o',
        effort: 'high',
        latencyMs: 500,
        finishReason: 'stop',
        status: 'completed',
        costUsd: null,
      },
      createdAt: new Date('2026-07-06T00:00:00.000Z'),
    };
    const { controller } = makeController({
      getChatMessages: vi.fn().mockResolvedValue({
        messages: [],
        compaction,
        absorbedMessageCount: 5,
      }),
    });

    const result = await controller.getChatMessages('verified-user', chat.id, {
      limit: 100,
    });

    expect(result.compaction?.stats).toEqual({
      absorbedMessageCount: 5,
      beforeTokens: 71_400,
      afterTokens: 1280,
      modelId: 'system:openai:gpt-4o',
      effort: 'high',
    });
  });

  it('returns 404 when the verified user cannot read chat messages', async () => {
    const { controller } = makeController({
      getChatMessages: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      controller.getChatMessages('verified-user', chat.id, { limit: 100 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns an empty message list for an owned chat with no messages', async () => {
    const { controller } = makeController({
      getChatMessages: vi.fn().mockResolvedValue({
        messages: [],
        compaction: undefined,
        absorbedMessageCount: null,
      }),
    });

    await expect(
      controller.getChatMessages('verified-user', chat.id, { limit: 100 }),
    ).resolves.toEqual({ messages: [], compaction: null });
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
      { limit: 25, beforeSeq: 42, targetSeq: undefined },
    );
  });

  it('passes a target-ended history request to the service', async () => {
    const { controller, chatsService } = makeController();

    await controller.getChatMessages('verified-user', chat.id, {
      limit: 25,
      targetSeq: 42,
    });

    expect(chatsService.getChatMessages).toHaveBeenCalledWith(
      chat.id,
      'verified-user',
      { limit: 25, beforeSeq: undefined, targetSeq: 42 },
    );
  });

  it('patches a chat scoped to the verified user only', async () => {
    const { controller, chatsService } = makeController();
    const input = {
      title: 'Renamed',
      ownerUserId: 'attacker',
    };

    await controller.updateChat('verified-user', chat.id, input);

    expect(chatsService.updateChat).toHaveBeenCalledWith(
      chat.id,
      'verified-user',
      { title: 'Renamed', ownerUserId: 'attacker' },
    );
  });

  it('deletes a chat scoped to the verified user only', async () => {
    const { controller, chatsService } = makeController({
      deleteChat: vi.fn().mockResolvedValue(true),
    });

    await controller.deleteChat('verified-user', chat.id);

    expect(chatsService.deleteChat).toHaveBeenCalledWith(
      'verified-user',
      chat.id,
    );
  });

  it('404s deleting a chat that is absent or not owned', async () => {
    const { controller } = makeController({
      deleteChat: vi.fn().mockResolvedValue(false),
    });

    await expect(
      controller.deleteChat('verified-user', chat.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('forks a chat scoped to the verified user only', async () => {
    const forked: Chat = { ...chat, id: 'forked-chat-id' };
    const { controller, chatsService } = makeController({
      forkChat: vi.fn().mockResolvedValue(forked),
    });
    const fromMessageId = chatMessages[0].id;

    const result = await controller.forkChat('verified-user', chat.id, {
      fromMessageId,
    });

    expect(chatsService.forkChat).toHaveBeenCalledWith(
      chat.id,
      'verified-user',
      fromMessageId,
    );
    expect(result.id).toBe('forked-chat-id');
  });

  it('forks the whole chat when fromMessageId is absent (clone)', async () => {
    const forked: Chat = { ...chat, id: 'cloned-chat-id' };
    const { controller, chatsService } = makeController({
      forkChat: vi.fn().mockResolvedValue(forked),
    });

    const result = await controller.forkChat('verified-user', chat.id, {});

    expect(chatsService.forkChat).toHaveBeenCalledWith(
      chat.id,
      'verified-user',
      undefined,
    );
    expect(result.id).toBe('cloned-chat-id');
  });

  it('streams messages with userId from the verified session only', async () => {
    const { controller, chatLoopService } = makeController();
    const streamResult = streamText({
      model: new MockLanguageModelV3({
        provider: 'test',
        modelId: 'test',
        doStream: {
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            start(stream) {
              stream.enqueue({ type: 'stream-start', warnings: [] });
              stream.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                usage: {
                  inputTokens: {
                    total: 0,
                    noCache: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 0, text: 0, reasoning: 0 },
                },
              });
              stream.close();
            },
          }),
          response: {},
        },
      }),
      messages: [{ role: 'user', content: 'Hello' }],
    });
    chatLoopService.createMessageStream.mockResolvedValue(streamResult);

    const userMessageId = '0910fd41-1f2f-49de-b1c2-00ff4b3c7c60';
    const input = {
      modelId: 'system:openai:gpt-5.4-mini',
      userId: 'attacker',
      message: {
        id: userMessageId,
        parts: [{ type: 'text' as const, text: 'Hello' }],
      },
    };
    await controller.createMessage(
      'verified-user',
      chat.id,
      input,
      makeWritableResponse(),
    );

    expect(chatLoopService.createMessageStream).toHaveBeenCalledTimes(1);
    const [call] = chatLoopService.createMessageStream.mock.calls[0];
    expect(call).toMatchObject({
      chatId: chat.id,
      userId: 'verified-user',
      modelId: 'system:openai:gpt-5.4-mini',
      message: {
        id: userMessageId,
        parts: [{ type: 'text', text: 'Hello' }],
      },
    });
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('maps unavailable model errors to the standard 422 body', async () => {
    const { controller, chatLoopService } = makeController();
    chatLoopService.createMessageStream.mockRejectedValue(
      new ModelNotAvailableError('missing-model'),
    );

    await expect(
      controller.createMessage(
        'verified-user',
        chat.id,
        {
          modelId: 'missing-model',
          message: {
            id: '0910fd41-1f2f-49de-b1c2-00ff4b3c7c60',
            parts: [{ type: 'text', text: 'Hello' }],
          },
        },
        makeWritableResponse(),
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: "Model 'missing-model' is not available.",
        code: 'model_not_available',
      },
    });
  });

  it('maps model configuration errors to the standard 503 body', async () => {
    const { controller, chatLoopService } = makeController();
    chatLoopService.createMessageStream.mockRejectedValue(
      new ModelConfigurationError('DEFAULT_MODEL_ID is required.'),
    );

    await expect(
      controller.createMessage(
        'verified-user',
        chat.id,
        {
          modelId: 'system:openai:gpt-5.4-mini',
          message: {
            id: '1910fd41-1f2f-49de-b1c2-00ff4b3c7c60',
            parts: [{ type: 'text', text: 'Hello' }],
          },
        },
        makeWritableResponse(),
      ),
    ).rejects.toMatchObject({
      status: 503,
      response: {
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'DEFAULT_MODEL_ID is required.',
        code: 'model_configuration_invalid',
      },
    });
  });

  it('resume: 204 with no active run — scoped to the verified user (RLS path)', async () => {
    const { controller, runAsSpy, bridge } = makeController();
    runAsSpy.mockResolvedValue(undefined);
    const response = makeWritableResponse();
    const end = vi.spyOn(response, 'end');

    await controller.resumeChatStream(
      'verified-user',
      '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10',
      response,
    );

    // Tenant scoping comes from the session-derived userId, never the client.
    expect(runAsSpy).toHaveBeenCalledWith(
      'verified-user',
      expect.any(Function),
    );
    expect(response.status).toHaveBeenCalledWith(204);
    expect(end).toHaveBeenCalled();
    expect(bridge.createUiMessageStreamResponse).not.toHaveBeenCalled();
  });

  it('resume: a client already gone at registration never reaches the bridge', async () => {
    const { controller, runAsSpy, bridge } = makeController();
    // Even with an active run, a response whose socket died before the
    // handler ran must exit after the (single) lookup without a write.
    runAsSpy.mockResolvedValue({ id: 'run-1' });
    const response = makeWritableResponse();
    const end = vi.spyOn(response, 'end');
    response.destroy();

    await controller.resumeChatStream(
      'verified-user',
      '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10',
      response,
    );

    expect(bridge.createUiMessageStreamResponse).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it('resume: bridges the active run for the verified user', async () => {
    const { controller, runAsSpy, bridge } = makeController();
    runAsSpy.mockResolvedValue({ id: 'run-1' });
    bridge.createUiMessageStreamResponse.mockReturnValue(
      new Response(null, { status: 200 }),
    );
    const response = makeWritableResponse();

    await controller.resumeChatStream(
      'verified-user',
      '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10',
      response,
    );

    expect(bridge.createUiMessageStreamResponse).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', userId: 'verified-user' }),
    );
  });

  it('returns 404 when the verified user does not own the chat', async () => {
    const { controller } = makeController({
      getChatById: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      controller.getChatById('verified-user', chat.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ChatsController response plumbing', () => {
  function makeWritableResponse() {
    const chunks: Array<string> = [];
    const response = Object.assign(
      new Writable({
        write(chunk: Buffer | string, _encoding, callback) {
          chunks.push(String(chunk));
          callback();
        },
      }),
      {
        status: vi.fn(),
        setHeader: vi.fn(),
        headersSent: false,
      },
    );
    response.status.mockReturnValue(response);
    response.setHeader.mockReturnValue(response);
    return Object.assign(response, { chunks });
  }

  function makeController() {
    const chatsService = {
      listChatsWithLastMessage: vi
        .fn<ChatsControllerService['listChatsWithLastMessage']>()
        .mockResolvedValue([]),
      searchChats: vi.fn<ChatsControllerService['searchChats']>(),
      getChatById: vi
        .fn<ChatsControllerService['getChatById']>()
        .mockResolvedValue(undefined),
      getChatMessages: vi
        .fn<ChatsControllerService['getChatMessages']>()
        .mockResolvedValue(undefined),
      updateChat: vi
        .fn<ChatsControllerService['updateChat']>()
        .mockResolvedValue(undefined),
      deleteChat: vi
        .fn<ChatsControllerService['deleteChat']>()
        .mockResolvedValue(false),
      forkChat: vi.fn<ChatsControllerService['forkChat']>(),
    } satisfies ChatsControllerService;
    const chatLoopService = {
      createMessageStream: vi.fn<ChatLoopService['createMessageStream']>(),
    } satisfies Pick<ChatLoopService, 'createMessageStream'>;
    const tx: Db = drizzle.mock({ schema });
    const tenantDb: TenantRunner = {
      runAs: async <T>(_userId: string, callback: (scoped: Db) => Promise<T>) =>
        callback(tx),
    };
    const runAsSpy = vi.spyOn(tenantDb, 'runAs');
    const bridge = {
      createUiMessageStreamResponse:
        vi.fn<RunStreamResponder['createUiMessageStreamResponse']>(),
    } satisfies RunStreamResponder;
    return {
      controller: new ChatsController(
        chatsService,
        chatLoopService,
        tenantDb,
        bridge,
      ),
      chatsService,
      chatLoopService,
      runAsSpy,
      bridge,
    };
  }

  const chatId = '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10';

  it('names the chat in every owner-scoped 404', async () => {
    const { controller } = makeController();

    await expect(controller.getChatById('u', chatId)).rejects.toThrow(
      `Chat ${chatId} not found`,
    );
    await expect(
      controller.getChatMessages('u', chatId, {
        limit: CHAT_MESSAGES_DEFAULT_LIMIT,
      }),
    ).rejects.toThrow(`Chat ${chatId} not found`);
    await expect(
      controller.updateChat('u', chatId, { title: 'x' }),
    ).rejects.toThrow(`Chat ${chatId} not found`);
    await expect(controller.deleteChat('u', chatId)).rejects.toThrow(
      `Chat ${chatId} not found`,
    );
  });

  it('forwards every list filter to the service verbatim', async () => {
    const { controller, chatsService } = makeController();

    await controller.getChats('u', {
      projectId: 'p-1',
      archived: 'only',
      pinned: 'exclude',
    });

    expect(chatsService.listChatsWithLastMessage).toHaveBeenCalledWith('u', {
      projectId: 'p-1',
      archived: 'only',
      pinned: 'exclude',
    });
  });

  it('forwards history pagination verbatim', async () => {
    const { controller, chatsService } = makeController();
    chatsService.getChatMessages.mockResolvedValue({
      messages: [],
      compaction: undefined,
      absorbedMessageCount: null,
    });

    await controller.getChatMessages('u', chatId, {
      limit: 25,
      beforeSeq: 7,
      targetSeq: 3,
    });

    expect(chatsService.getChatMessages).toHaveBeenCalledWith(chatId, 'u', {
      limit: 25,
      beforeSeq: 7,
      targetSeq: 3,
    });
  });

  it('copies the bridged status and every header onto the Express response', async () => {
    const { controller, runAsSpy, bridge } = makeController();
    runAsSpy.mockResolvedValue({ id: 'run-1' });
    bridge.createUiMessageStreamResponse.mockReturnValue(
      new Response('replayed', {
        status: 201,
        headers: {
          'content-type': 'text/event-stream',
          'x-vendor': 'llame',
        },
      }),
    );
    const response = makeWritableResponse();

    await controller.resumeChatStream('u', chatId, response);

    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.setHeader).toHaveBeenCalledWith(
      'content-type',
      'text/event-stream',
    );
    expect(response.setHeader).toHaveBeenCalledWith('x-vendor', 'llame');
    expect(response.chunks.join('')).toBe('replayed');
  });

  it('ends the response without piping when the bridged response has no body', async () => {
    const { controller, runAsSpy, bridge } = makeController();
    runAsSpy.mockResolvedValue({ id: 'run-1' });
    bridge.createUiMessageStreamResponse.mockReturnValue(
      new Response(null, { status: 204 }),
    );
    const response = makeWritableResponse();
    const end = vi.spyOn(response, 'end');

    await controller.resumeChatStream('u', chatId, response);

    expect(response.status).toHaveBeenCalledWith(204);
    expect(end).toHaveBeenCalled();
    expect(response.chunks).toEqual([]);
  });

  it('destroys the connection instead of rethrowing when the stream fails after headers', async () => {
    const { controller, runAsSpy, bridge } = makeController();
    runAsSpy.mockResolvedValue({ id: 'run-1' });
    bridge.createUiMessageStreamResponse.mockReturnValue(
      new Response(
        new ReadableStream({
          start(stream) {
            stream.error(new Error('upstream died'));
          },
        }),
        { status: 200 },
      ),
    );
    const response = makeWritableResponse();
    // A finished writable never arms the disconnect abort, so the failure is
    // classified by headersSent alone.
    Object.defineProperty(response, 'writableEnded', {
      value: true,
      configurable: true,
    });
    response.headersSent = true;

    await expect(
      controller.resumeChatStream('u', chatId, response),
    ).resolves.toBeUndefined();
    expect(response.destroyed).toBe(true);
  });

  it('rethrows a stream failure that happened before any header was flushed', async () => {
    const { controller, runAsSpy, bridge } = makeController();
    runAsSpy.mockResolvedValue({ id: 'run-1' });
    bridge.createUiMessageStreamResponse.mockReturnValue(
      new Response(
        new ReadableStream({
          start(stream) {
            stream.error(new Error('upstream died'));
          },
        }),
        { status: 200 },
      ),
    );
    const response = makeWritableResponse();
    Object.defineProperty(response, 'writableEnded', {
      value: true,
      configurable: true,
    });

    await expect(
      controller.resumeChatStream('u', chatId, response),
    ).rejects.toThrow('upstream died');
  });

  it('swallows a stream failure that is really the client having disconnected', async () => {
    const { controller, runAsSpy, bridge } = makeController();
    runAsSpy.mockResolvedValue({ id: 'run-1' });
    bridge.createUiMessageStreamResponse.mockReturnValue(
      new Response(
        new ReadableStream({
          start(stream) {
            stream.error(new Error('client went away'));
          },
        }),
        { status: 200 },
      ),
    );
    // Headers were never flushed, so only the abort tells this apart from a
    // genuine pre-header failure — which must still reach the exception filter.
    const response = makeWritableResponse();

    await expect(
      controller.resumeChatStream('u', chatId, response),
    ).resolves.toBeUndefined();
  });

  it('removes its close listener once the handler returns', async () => {
    const { controller, runAsSpy, bridge } = makeController();
    runAsSpy.mockResolvedValue({ id: 'run-1' });
    bridge.createUiMessageStreamResponse.mockReturnValue(
      new Response(null, { status: 200 }),
    );
    const response = makeWritableResponse();

    await controller.resumeChatStream('u', chatId, response);

    expect(response.listenerCount('close')).toBe(0);
  });

  it('aborts the bridged stream when the client disconnects mid-stream', async () => {
    const { controller, runAsSpy, bridge } = makeController();
    runAsSpy.mockResolvedValue({ id: 'run-1' });
    let captured: AbortSignal | undefined;
    bridge.createUiMessageStreamResponse.mockImplementation((input) => {
      captured = input.abortSignal;
      return new Response(null, { status: 200 });
    });
    const response = makeWritableResponse();

    await controller.resumeChatStream('u', chatId, response);
    expect(captured?.aborted).toBe(false);

    // The listener is detached on return, so a fresh handler proves the wiring.
    const live = makeWritableResponse();
    let liveSignal: AbortSignal | undefined;
    bridge.createUiMessageStreamResponse.mockImplementation((input) => {
      liveSignal = input.abortSignal;
      live.emit('close');
      return new Response(null, { status: 200 });
    });
    await controller.resumeChatStream('u', chatId, live);

    expect(liveSignal?.aborted).toBe(true);
  });

  it('does not abort when the response closed only because it finished writing', async () => {
    const { controller, runAsSpy, bridge } = makeController();
    runAsSpy.mockResolvedValue({ id: 'run-1' });
    const response = makeWritableResponse();
    Object.defineProperty(response, 'writableEnded', {
      value: true,
      configurable: true,
    });
    let captured: AbortSignal | undefined;
    bridge.createUiMessageStreamResponse.mockImplementation((input) => {
      captured = input.abortSignal;
      response.emit('close');
      return new Response(null, { status: 200 });
    });

    await controller.resumeChatStream('u', chatId, response);

    expect(captured?.aborted).toBe(false);
  });
});
