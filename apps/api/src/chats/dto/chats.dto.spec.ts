import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { type Chat, type Message } from '../../db/schema';
import {
  CreateMessageDto,
  ChatMessagesQueryDto,
  ChatSearchQueryDto,
  ForkChatDto,
  UpdateChatDto,
  toSharedChatResponse,
} from './chats.dto';

describe('UpdateChatDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: UpdateChatDto,
  };

  it('accepts a valid title and an absent title', async () => {
    await expect(
      pipe.transform({ title: 'Renamed' }, metadata),
    ).resolves.toMatchObject({ title: 'Renamed' });
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
  });

  it('rejects an explicit null title (would un-title the chat, #78)', async () => {
    await expect(
      pipe.transform({ title: null }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a valid visibility and an absent visibility', async () => {
    await expect(
      pipe.transform({ visibility: 'public' }, metadata),
    ).resolves.toMatchObject({ visibility: 'public' });
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
  });

  it('rejects an explicit null visibility (would violate the NOT NULL column — 400, not a 500)', async () => {
    await expect(
      pipe.transform({ visibility: null }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an invalid visibility value', async () => {
    await expect(
      pipe.transform({ visibility: 'everyone' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a boolean pinned flag', async () => {
    await expect(
      pipe.transform({ pinned: true }, metadata),
    ).resolves.toMatchObject({ pinned: true });
    await expect(
      pipe.transform({ pinned: false }, metadata),
    ).resolves.toMatchObject({ pinned: false });
  });

  it('rejects a non-boolean pinned value', async () => {
    await expect(
      pipe.transform({ pinned: 'yes' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an explicit null pinned value instead of silently unpinning', async () => {
    await expect(
      pipe.transform({ pinned: null }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a valid projectId and an absent projectId (leaves filing unchanged)', async () => {
    await expect(
      pipe.transform(
        { projectId: '3f6f1e0a-6b8b-4b4a-9a1a-8e6e6f1b2c3d' },
        metadata,
      ),
    ).resolves.toMatchObject({
      projectId: '3f6f1e0a-6b8b-4b4a-9a1a-8e6e6f1b2c3d',
    });
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
  });

  it('accepts an explicit null projectId — unlike title/visibility/pinned, null is a legitimate value here (unfile)', async () => {
    await expect(
      pipe.transform({ projectId: null }, metadata),
    ).resolves.toMatchObject({ projectId: null });
  });

  it('rejects a non-uuid projectId', async () => {
    await expect(
      pipe.transform({ projectId: 'not-a-uuid' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('ForkChatDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: ForkChatDto,
  };

  it('accepts a valid fromMessageId', async () => {
    await expect(
      pipe.transform(
        { fromMessageId: '3f6f1e0a-6b8b-4b4a-9a1a-8e6e6f1b2c3d' },
        metadata,
      ),
    ).resolves.toMatchObject({
      fromMessageId: '3f6f1e0a-6b8b-4b4a-9a1a-8e6e6f1b2c3d',
    });
  });

  it('accepts an absent fromMessageId — forks the whole conversation', async () => {
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
  });

  it('rejects a non-UUID fromMessageId', async () => {
    await expect(
      pipe.transform({ fromMessageId: 'not-a-uuid' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an explicit null fromMessageId instead of silently forking the whole chat', async () => {
    await expect(
      pipe.transform({ fromMessageId: null }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('CreateMessageDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: CreateMessageDto,
  };

  const message = {
    id: '3f6f1e0a-6b8b-4b4a-9a1a-8e6e6f1b2c3d',
    parts: [{ type: 'text', text: 'Hello' }],
  };

  it('requires a top-level nonblank modelId with no syntax restriction', async () => {
    await expect(
      pipe.transform(
        {
          modelId: 'openrouter:openai:o3-pro',
          message,
        },
        metadata,
      ),
    ).resolves.toMatchObject({
      modelId: 'openrouter:openai:o3-pro',
      message,
    });

    await expect(pipe.transform({ message }, metadata)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      pipe.transform({ modelId: '', message }, metadata),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform({ modelId: '   ', message }, metadata),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform({ modelId: null, message }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('ChatMessagesQueryDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ChatMessagesQueryDto,
  };

  it('accepts the maximum safe beforeSeq cursor', async () => {
    await expect(
      pipe.transform(
        {
          beforeSeq: String(Number.MAX_SAFE_INTEGER),
        },
        metadata,
      ),
    ).resolves.toMatchObject({ beforeSeq: Number.MAX_SAFE_INTEGER });
  });

  it('rejects unsafe beforeSeq cursors instead of rounding them', async () => {
    await expect(
      pipe.transform(
        {
          beforeSeq: '9007199254740993',
        },
        metadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each(['9007199254740991.1', '9007199254740990.9'])(
    'rejects non-integer beforeSeq cursor %s instead of rounding it',
    async (beforeSeq) => {
      await expect(
        pipe.transform({ beforeSeq }, metadata),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
});

describe('ChatSearchQueryDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ChatSearchQueryDto,
  };

  it('accepts a non-empty q', async () => {
    await expect(
      pipe.transform({ q: 'hello' }, metadata),
    ).resolves.toMatchObject({ q: 'hello' });
  });

  it('rejects an empty q — the documented minLength: 1 must actually be enforced', async () => {
    await expect(pipe.transform({ q: '' }, metadata)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects a q over the documented maxLength', async () => {
    await expect(
      pipe.transform({ q: 'x'.repeat(201) }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('toSharedChatResponse — public-share egress allowlist (tool-calling-loop task 3.3)', () => {
  const fakeChat = { id: 'chat-1', title: 'Shared chat' } as Chat;

  function fakeMessage(overrides: Partial<Message>): Message {
    return {
      id: 'm-1',
      chatId: 'chat-1',
      seq: 1,
      role: 'assistant',
      senderUserId: null,
      parts: [],
      attachments: [],
      usage: null,
      inReplyTo: null,
      createdAt: new Date('2026-07-11T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('strips tool-<name> parts from the public payload (never leaked to a share)', () => {
    const message = fakeMessage({
      parts: [
        { type: 'text', text: 'the visible answer' },
        {
          type: 'tool-search_conversations',
          toolCallId: 'call-1',
          state: 'output-available',
          input: { query: 'budget' },
          output: { status: 'success', results: [] },
        },
      ],
    });

    const dto = toSharedChatResponse(fakeChat, [message]);

    expect(dto.messages).toHaveLength(1);
    expect(dto.messages[0].parts).toEqual([
      { type: 'text', text: 'the visible answer' },
    ]);
  });

  it('strips the data-cap-notice step-cap marker part from the public payload', () => {
    const message = fakeMessage({
      parts: [
        { type: 'text', text: 'answered with what it had' },
        { type: 'data-cap-notice', data: { stepsUsed: 8, maxSteps: 8 } },
      ],
    });

    const dto = toSharedChatResponse(fakeChat, [message]);

    expect(dto.messages[0].parts).toEqual([
      { type: 'text', text: 'answered with what it had' },
    ]);
  });

  it('a message with ONLY tool/cap-notice parts (no text) still appears, with an empty parts array', () => {
    const message = fakeMessage({
      parts: [
        {
          type: 'tool-search_conversations',
          toolCallId: 'call-1',
          state: 'output-error',
          input: { query: 'x' },
          errorText: 'not available',
        },
      ],
    });

    const dto = toSharedChatResponse(fakeChat, [message]);

    expect(dto.messages).toHaveLength(1);
    expect(dto.messages[0].parts).toEqual([]);
  });
});
