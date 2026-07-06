import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { ChatMessagesQueryDto, ForkChatDto, UpdateChatDto } from './chats.dto';

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
