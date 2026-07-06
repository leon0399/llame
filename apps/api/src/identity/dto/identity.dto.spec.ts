import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateOrgUnitDto, GrantMembershipDto } from './identity.dto';

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

describe('GrantMembershipDto — the owner-escalation guard (#44)', () => {
  it('accepts admin and member', () => {
    expect(errorsFor({ userId: 'u1', role: 'admin' })).toHaveLength(0);
    expect(errorsFor({ userId: 'u1', role: 'member' })).toHaveLength(0);
  });

  it('REJECTS owner — the API can never mint or escalate to owner', () => {
    expect(errorsFor({ userId: 'u1', role: 'owner' }).length).toBeGreaterThan(
      0,
    );
  });

  it('rejects other roles and a missing userId', () => {
    expect(errorsFor({ userId: 'u1', role: 'viewer' }).length).toBeGreaterThan(
      0,
    );
    expect(
      errorsFor({ userId: 'u1', role: 'maintainer' }).length,
    ).toBeGreaterThan(0);
    expect(errorsFor({ role: 'admin' }).length).toBeGreaterThan(0);
  });
});
