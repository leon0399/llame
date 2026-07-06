import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { CreatePromptDto, UpdatePromptDto } from './prompts.dto';

// Whitespace-only content must be rejected as a clean 400 at the DTO layer.
// Without the trim-before-validate transform, `MinLength(1)` sees the RAW
// (untrimmed) string, a whitespace-only body passes it, the controller then
// trims to an empty string, and the DB CHECK (char_length BETWEEN 1 AND 8000)
// rejects the insert/update as an unhandled 500 instead of a 400.
describe('CreatePromptDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: CreatePromptDto,
  };

  it('trims content before length validation', async () => {
    await expect(
      pipe.transform({ name: 'ok', content: '  hi  ' }, metadata),
    ).resolves.toMatchObject({ content: 'hi' });
  });

  it('rejects whitespace-only content (would otherwise become an empty string post-trim)', async () => {
    await expect(
      pipe.transform({ name: 'ok', content: '   ' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('UpdatePromptDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: UpdatePromptDto,
  };

  it('trims content before length validation', async () => {
    await expect(
      pipe.transform({ content: '  hi  ' }, metadata),
    ).resolves.toMatchObject({ content: 'hi' });
  });

  it('rejects whitespace-only content on a content-only update', async () => {
    await expect(
      pipe.transform({ content: '   ' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a name-only update with no content field', async () => {
    await expect(
      pipe.transform({ name: 'renamed' }, metadata),
    ).resolves.toEqual({ name: 'renamed' });
  });
});
