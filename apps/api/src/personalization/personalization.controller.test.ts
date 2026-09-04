import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Personalization } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { type UpdatePersonalizationDto } from './dto/personalization.dto';
import { type PersonalizationUpdate } from './personalization-repository';
import { PersonalizationController } from './personalization.controller';
import { PersonalizationService } from './personalization.service';

const stored: Personalization = {
  userId: 'owner-1',
  preferredName: 'Leo',
  about: 'Staff engineer',
  responsePreferences: 'Terse',
  enabled: true,
  shareAccountIdentity: false,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
};

function controller(options: { row?: Personalization | undefined } = {}) {
  const row = 'row' in options ? options.row : stored;
  const updates: Array<{ userId: string; update: PersonalizationUpdate }> = [];
  const db: Db = drizzle.mock({ schema });
  const service = new PersonalizationService(
    new TenantDbService({
      transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
    }),
  );
  const getForOwner = vi
    .spyOn(service, 'getForOwner')
    .mockImplementation(() => Promise.resolve(row));
  vi.spyOn(service, 'updateForOwner').mockImplementation((userId, update) => {
    updates.push({ userId, update });
    // The repository always returns a row; a cleared profile is an empty row.
    return Promise.resolve(row ?? stored);
  });

  return {
    controller: new PersonalizationController(service),
    getForOwner,
    updates,
  };
}

/**
 * A DTO as class-transformer builds it: unset keys are absent, not undefined.
 * Every field on UpdatePersonalizationDto is optional, so a partial literal is
 * already the DTO type.
 */
function dto(fields: UpdatePersonalizationDto): UpdatePersonalizationDto {
  return fields;
}

describe('PersonalizationController', () => {
  it('returns the authenticated owner profile as the response shape', async () => {
    const { controller: subject, getForOwner } = controller();

    await expect(subject.getPersonalization('owner-1')).resolves.toStrictEqual({
      preferredName: 'Leo',
      about: 'Staff engineer',
      responsePreferences: 'Terse',
      enabled: true,
      shareAccountIdentity: false,
    });
    expect(getForOwner).toHaveBeenCalledWith('owner-1');
  });

  it('returns column defaults when the owner has never authored a profile', async () => {
    const { controller: subject } = controller({ row: undefined });

    await expect(subject.getPersonalization('owner-1')).resolves.toStrictEqual({
      preferredName: null,
      about: null,
      responsePreferences: null,
      enabled: true,
      shareAccountIdentity: false,
    });
  });

  it('forwards every supplied field, including explicit nulls that clear text', async () => {
    const { controller: subject, updates } = controller();

    await subject.updatePersonalization(
      'owner-1',
      dto({
        preferredName: null,
        about: 'New about',
        responsePreferences: null,
        enabled: false,
        shareAccountIdentity: true,
      }),
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].userId).toBe('owner-1');
    expect(updates[0].update).toStrictEqual({
      preferredName: null,
      about: 'New about',
      responsePreferences: null,
      enabled: false,
      shareAccountIdentity: true,
    });
  });

  it('writes NO key for an omitted field, so a single-field PATCH cannot wipe the profile', async () => {
    const { controller: subject, updates } = controller();

    await subject.updatePersonalization('owner-1', dto({ about: 'Only this' }));

    // `toStrictEqual`, not `toEqual`: `{about, enabled: undefined}` compares
    // equal under `toEqual` yet still overwrites the stored toggle.
    expect(updates[0].update).toStrictEqual({ about: 'Only this' });
    expect(Object.keys(updates[0].update)).toStrictEqual(['about']);
  });

  it('writes an empty update for an empty body', async () => {
    const { controller: subject, updates } = controller();

    await subject.updatePersonalization('owner-1', dto({}));

    expect(updates[0].update).toStrictEqual({});
    expect(Object.keys(updates[0].update)).toHaveLength(0);
  });

  it.each([
    ['preferredName', { preferredName: 'Only name' }],
    ['about', { about: 'Only about' }],
    ['responsePreferences', { responsePreferences: 'Only prefs' }],
    ['enabled', { enabled: false }],
    ['shareAccountIdentity', { shareAccountIdentity: true }],
  ] as const)('carries %s alone and nothing else', async (key, body) => {
    const { controller: subject, updates } = controller();

    await subject.updatePersonalization('owner-1', dto(body));

    expect(Object.keys(updates[0].update)).toStrictEqual([key]);
    expect(updates[0].update).toStrictEqual(body);
  });

  it('maps the updated row through the same egress allowlist', async () => {
    const { controller: subject } = controller({
      row: {
        ...stored,
        preferredName: null,
        enabled: false,
        shareAccountIdentity: true,
      },
    });

    await expect(
      subject.updatePersonalization('owner-1', dto({ enabled: false })),
    ).resolves.toStrictEqual({
      preferredName: null,
      about: 'Staff engineer',
      responsePreferences: 'Terse',
      enabled: false,
      shareAccountIdentity: true,
    });
  });
});
