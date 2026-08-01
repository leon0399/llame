import { resolveEffectiveRole } from './role-resolution';

describe('resolveEffectiveRole', () => {
  const root = 'aaaaaaaa-0000-0000-0000-000000000001';
  const team = 'bbbbbbbb-0000-0000-0000-000000000002';
  const project = 'cccccccc-0000-0000-0000-000000000003';
  const path = `${root}/${team}/${project}`;

  it('returns null with no memberships anywhere on the path', () => {
    expect(resolveEffectiveRole(path, [])).toBeNull();
    expect(
      resolveEffectiveRole(path, [
        { orgUnitId: 'dddddddd-0000-0000-0000-000000000004', role: 'owner' },
      ]),
    ).toBeNull();
  });

  it('uses an explicit membership on the unit itself (not inherited)', () => {
    expect(
      resolveEffectiveRole(path, [{ orgUnitId: project, role: 'member' }]),
    ).toEqual({ role: 'member', viaOrgUnitId: project, inherited: false });
  });

  it('inherits from the nearest ancestor when the unit has no membership', () => {
    expect(
      resolveEffectiveRole(path, [{ orgUnitId: root, role: 'admin' }]),
    ).toEqual({ role: 'admin', viaOrgUnitId: root, inherited: true });
  });

  it('nearest membership wins — a subtree can demote an org-wide role', () => {
    expect(
      resolveEffectiveRole(path, [
        { orgUnitId: root, role: 'admin' },
        { orgUnitId: team, role: 'viewer' },
      ]),
    ).toEqual({ role: 'viewer', viaOrgUnitId: team, inherited: true });
  });

  it('nearest membership wins — and can promote', () => {
    expect(
      resolveEffectiveRole(path, [
        { orgUnitId: root, role: 'viewer' },
        { orgUnitId: project, role: 'owner' },
      ]),
    ).toEqual({ role: 'owner', viaOrgUnitId: project, inherited: false });
  });
});
