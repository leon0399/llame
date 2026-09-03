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
