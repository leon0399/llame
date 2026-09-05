import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdatePersonalizationDto } from './personalization.dto';
import { type UnknownRecord } from '@workspace/runtime-safety';

const validate = (payload: UnknownRecord) =>
  validateSync(plainToInstance(UpdatePersonalizationDto, payload), {
    whitelist: true,
  });

describe('UpdatePersonalizationDto null handling (cubic #279)', () => {
  it('rejects an explicit null on a NOT NULL toggle', () => {
    // `@IsOptional()` skips validation on null as well as undefined, so a null
    // used to pass the DTO, reach a NOT NULL column, and surface as a 500 from
    // the database. It must be a 400 at the boundary instead.
    for (const field of ['enabled', 'shareAccountIdentity']) {
      const errors = validate({ [field]: null });
      expect(errors.map((error) => error.property)).toEqual([field]);
    }
  });

  it('still accepts an explicit null on a nullable text field, which CLEARS it', () => {
    // The asymmetry is the whole point: omitted means keep, null means clear,
    // and these columns really are nullable.
    expect(
      validate({ preferredName: null, about: null, responsePreferences: null }),
    ).toEqual([]);
  });

  it('accepts real booleans and omitted keys', () => {
    expect(validate({ enabled: false, shareAccountIdentity: true })).toEqual(
      [],
    );
    expect(validate({})).toEqual([]);
  });

  it('still rejects a non-boolean toggle and an over-cap string', () => {
    expect(validate({ enabled: 'yes' }).map((e) => e.property)).toEqual([
      'enabled',
    ]);
    expect(
      validate({ preferredName: 'x'.repeat(256) }).map((e) => e.property),
    ).toEqual(['preferredName']);
  });
});
