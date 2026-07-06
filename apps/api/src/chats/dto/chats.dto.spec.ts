import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import {
  ChatMessagesQueryDto,
  ChatSearchQueryDto,
  UpdateChatDto,
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
