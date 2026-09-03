import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';

import {
  MemoryResponse,
  toMemoryResponse,
  UpdateMemoryDto,
} from './memory.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: UpdateMemoryDto,
  data: '',
};
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('UpdateMemoryDto', () => {
  it('accepts omitted or boolean values and rejects null or non-booleans', async () => {
    await expect(pipe.transform({}, metadata)).resolves.toBeInstanceOf(
      UpdateMemoryDto,
    );
    await expect(
      pipe.transform({ shareRecentChats: false }, metadata),
    ).resolves.toMatchObject({ shareRecentChats: false });
    await expect(
      pipe.transform({ shareRecentChats: null }, metadata),
    ).rejects.toThrow(BadRequestException);
    await expect(
      pipe.transform({ shareRecentChats: 'yes' }, metadata),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a client-supplied user id', async () => {
    await expect(
      pipe.transform(
        { shareRecentChats: true, userId: 'someone-else' },
        metadata,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('toMemoryResponse', () => {
  it('allows only the public setting through egress', () => {
    const stored = {
      shareRecentChats: true,
      userId: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(toMemoryResponse(stored)).toEqual<MemoryResponse>({
      shareRecentChats: true,
    });
  });
});
