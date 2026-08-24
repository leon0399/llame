import { ValidationPipe } from '@nestjs/common';

import {
  CreateKnowledgeSpaceDto,
  UpdateKnowledgeSpaceDto,
} from './knowledge-space.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('Knowledge Space DTOs', () => {
  it('trims a valid create name before the controller sees it', async () => {
    const result: unknown = await pipe.transform(
      { name: '  Personal  ' },
      { type: 'body', metatype: CreateKnowledgeSpaceDto, data: '' },
    );

    expect(result).toMatchObject({ name: 'Personal' });
  });

  it('rejects excess create fields and invalid names', async () => {
    await expect(
      pipe.transform(
        { name: 'Personal', ownerUserId: 'attacker' },
        { type: 'body', metatype: CreateKnowledgeSpaceDto, data: '' },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        { name: '😀'.repeat(101) },
        { type: 'body', metatype: CreateKnowledgeSpaceDto, data: '' },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires a non-empty patch and rejects an explicit null', async () => {
    await expect(
      pipe.transform(
        {},
        { type: 'body', metatype: UpdateKnowledgeSpaceDto, data: '' },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        { name: null },
        { type: 'body', metatype: UpdateKnowledgeSpaceDto, data: '' },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
