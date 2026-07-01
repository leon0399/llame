import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { ChatMessagesQueryDto } from './chats.dto';

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
