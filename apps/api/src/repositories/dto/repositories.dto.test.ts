import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DISPLAY_NAME_MAX } from '../display-name';
import { UpdateRepositoryDto } from './repositories.dto';

/**
 * The PATCH body of one repository. The distinction the validators draw is the
 * one the service relies on: only an omitted field skips validation, so an
 * explicit `null` display name is a 400 here instead of a 500 on the NOT NULL
 * column, while an explicit `null` remote is the documented way to clear it.
 */
describe('UpdateRepositoryDto', () => {
  it('accepts a rename and an omitted patch', async () => {
    const [renamed, omitted] = await Promise.all([
      validate(
        plainToInstance(UpdateRepositoryDto, { displayName: 'renamed' }),
      ),
      validate(plainToInstance(UpdateRepositoryDto, {})),
    ]);

    expect(renamed).toEqual([]);
    expect(omitted).toEqual([]);
  });

  it('rejects an explicit null display name', async () => {
    const errors = await validate(
      plainToInstance(UpdateRepositoryDto, { displayName: null }),
    );

    expect(errors).not.toEqual([]);
    expect(errors[0]?.property).toBe('displayName');
  });

  it('rejects a blank, a non-text, and an over-long display name', async () => {
    const [blank, notText, tooLong] = await Promise.all([
      validate(plainToInstance(UpdateRepositoryDto, { displayName: '   ' })),
      validate(plainToInstance(UpdateRepositoryDto, { displayName: 42 })),
      validate(
        plainToInstance(UpdateRepositoryDto, {
          displayName: 'x'.repeat(DISPLAY_NAME_MAX + 1),
        }),
      ),
    ]);

    expect(blank).not.toEqual([]);
    expect(notText).not.toEqual([]);
    expect(tooLong).not.toEqual([]);
  });

  it('clears the canonical remote with an explicit null', async () => {
    const [cleared, redeclared, notText] = await Promise.all([
      validate(plainToInstance(UpdateRepositoryDto, { remote: null })),
      validate(
        plainToInstance(UpdateRepositoryDto, {
          remote: 'git@github.com:leon0399/llame.git',
        }),
      ),
      validate(plainToInstance(UpdateRepositoryDto, { remote: 42 })),
    ]);

    // null is a legitimate value here, and any other supplied value must still
    // be text: the service normalizes what it receives.
    expect(cleared).toEqual([]);
    expect(redeclared).toEqual([]);
    expect(notText).not.toEqual([]);
  });
});
