import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';

import { CreateMemoryDto } from './memories.dto';

/**
 * Drives the SAME pipeline as production (app.setup.ts's global
 * ValidationPipe: whitelist + transform), so this proves the actual guard,
 * not just the decorator in isolation.
 */
describe('CreateMemoryDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: CreateMemoryDto,
  };

  it('accepts non-empty content, trimming surrounding whitespace', async () => {
    await expect(
      pipe.transform({ content: '  hello  ' }, metadata),
    ).resolves.toMatchObject({ content: 'hello' });
  });

  it('rejects whitespace-only content with a clean 400 (not a DB CHECK 500)', async () => {
    await expect(
      pipe.transform({ content: '   ' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects empty-string content', async () => {
    await expect(
      pipe.transform({ content: '' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects content over the max length', async () => {
    await expect(
      pipe.transform({ content: 'x'.repeat(2001) }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });
});
