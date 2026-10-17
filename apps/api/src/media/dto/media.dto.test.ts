import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';

import { storedPdfRow } from '../media-fixtures';
import { ListMediaQueryDto, toMediaDescriptor } from './media.dto';

describe('toMediaDescriptor', () => {
  it('rejects a row with neither image columns nor a page count', () => {
    const malformed = storedPdfRow({ pageCount: null });

    expect(() => toMediaDescriptor(malformed)).toThrowError(Error);
  });
});

describe('ListMediaQueryDto', () => {
  // The app's global pipe (app.setup.ts).
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ListMediaQueryDto,
  };
  const ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';

  it('defaults the page to 48 with no cursor', async () => {
    await expect(pipe.transform({}, metadata)).resolves.toEqual(
      Object.assign(new ListMediaQueryDto(), { limit: 48 }),
    );
  });

  it('accepts a canonical cursor and a limit at both bounds', async () => {
    await expect(
      pipe.transform({ before: ID, limit: '1' }, metadata),
    ).resolves.toMatchObject({ before: ID, limit: 1 });
    await expect(
      pipe.transform({ limit: '100' }, metadata),
    ).resolves.toMatchObject({ limit: 100 });
  });

  it.each([
    ['a limit below 1', { limit: '0' }],
    ['a limit above 100', { limit: '101' }],
    ['a fractional limit', { limit: '1.5' }],
    ['an upper-case cursor', { before: ID.toUpperCase() }],
    ['a cursor that is not a UUID', { before: 'not-a-cursor' }],
  ])('rejects %s with 400', async (_label, query) => {
    await expect(pipe.transform(query, metadata)).rejects.toMatchObject({
      status: 400,
    });
  });
});
