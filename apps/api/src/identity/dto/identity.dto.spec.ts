import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  ChangeMembershipRoleDto,
  CreateOrgUnitDto,
  GrantMembershipDto,
  UpdateOrgUnitDto,
} from './identity.dto';

const errorsFor = (obj: unknown) =>
  validateSync(plainToInstance(GrantMembershipDto, obj));

describe('CreateOrgUnitDto', () => {
  const errs = (obj: unknown) =>
    validateSync(plainToInstance(CreateOrgUnitDto, obj));

  it('accepts a name with no type (type is optional → schema default applies)', () => {
    expect(errs({ name: 'Acme' })).toHaveLength(0);
  });

  it('accepts a valid type and rejects an invalid one', () => {
    expect(errs({ name: 'Acme', type: 'team' })).toHaveLength(0);
    expect(errs({ name: 'Acme', type: 'nope' }).length).toBeGreaterThan(0);
    expect(errs({ type: 'team' }).length).toBeGreaterThan(0); // no name
  });

  it('rejects a whitespace-only name (passes MinLength but is visually blank)', () => {
    expect(errs({ name: '   ' }).length).toBeGreaterThan(0);
  });
});

describe('GrantMembershipDto — D3 widened grantable roles', () => {
  it('accepts every non-service_account role, INCLUDING owner (D3 — RLS, not the DTO, gates it to owner-tier callers)', () => {
    for (const role of [
      'owner',
      'admin',
      'maintainer',
      'member',
      'viewer',
      'guest',
    ]) {
      expect(errorsFor({ userId: 'u1', role })).toHaveLength(0);
    }
  });

  it('REJECTS service_account — no HTTP surface for it yet (#160/channels)', () => {
    expect(
      errorsFor({ userId: 'u1', role: 'service_account' }).length,
    ).toBeGreaterThan(0);
  });

  it('rejects a garbage role and a missing userId', () => {
    expect(
      errorsFor({ userId: 'u1', role: 'superuser' }).length,
    ).toBeGreaterThan(0);
    expect(errorsFor({ role: 'admin' }).length).toBeGreaterThan(0);
  });
});

describe('ChangeMembershipRoleDto — same grantable set as GrantMembershipDto', () => {
  const errs = (obj: unknown) =>
    validateSync(plainToInstance(ChangeMembershipRoleDto, obj));

  it('accepts owner and rejects service_account', () => {
    expect(errs({ role: 'owner' })).toHaveLength(0);
    expect(errs({ role: 'service_account' }).length).toBeGreaterThan(0);
  });
});

describe('UpdateOrgUnitDto — parentId distinguishes absent/null/id (D5 move semantics)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: UpdateOrgUnitDto,
  };

  it('an absent body applies no changes', async () => {
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
  });

  it('accepts a rename and rejects a blank name', async () => {
    await expect(
      pipe.transform({ name: 'Renamed' }, metadata),
    ).resolves.toMatchObject({ name: 'Renamed' });
    await expect(
      pipe.transform({ name: '   ' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a settings object and rejects a non-object settings value', async () => {
    await expect(
      pipe.transform({ settings: { theme: 'dark' } }, metadata),
    ).resolves.toMatchObject({ settings: { theme: 'dark' } });
    await expect(
      pipe.transform({ settings: 'not-an-object' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('an explicit null parentId (move to root) survives whitelist/transform', async () => {
    await expect(
      pipe.transform({ parentId: null }, metadata),
    ).resolves.toMatchObject({ parentId: null });
  });

  it('a UUID parentId (move under a parent) is accepted', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await expect(
      pipe.transform({ parentId: id }, metadata),
    ).resolves.toMatchObject({ parentId: id });
  });

  it('rejects a non-UUID, non-null parentId', async () => {
    await expect(
      pipe.transform({ parentId: 'not-a-uuid' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });
});
