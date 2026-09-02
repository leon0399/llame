import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import type { Membership, OrgUnit } from '../db/schema';
import {
  MembershipsRepository,
  MoveIntoOwnSubtreeError,
  OrgUnitsRepository,
} from './identity-repository';
import { IdentityService, ORG_UNITS_ERROR_CODES } from './identity.service';

const now = new Date('2026-09-01T00:00:00.000Z');
const ownerId = 'owner-1';
const memberId = 'member-1';

const root: OrgUnit = {
  id: '11111111-1111-4111-8111-111111111111',
  parentId: null,
  type: 'organization',
  name: 'Root',
  path: '11111111-1111-4111-8111-111111111111',
  createdBy: ownerId,
  settings: {},
  createdAt: now,
  updatedAt: now,
};
const child: OrgUnit = {
  ...root,
  id: '22222222-2222-4222-8222-222222222222',
  parentId: root.id,
  type: 'team',
  name: 'Child',
  path: `${root.path}/22222222-2222-4222-8222-222222222222`,
};
const membership: Membership = {
  id: '33333333-3333-4333-8333-333333333333',
  userId: memberId,
  orgUnitId: root.id,
  role: 'member',
  createdAt: now,
};

function makeService() {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  const runAs = vi
    .spyOn(tenantDb, 'runAs')
    .mockImplementation(
      async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    );
  return { service: new IdentityService(tenantDb), runAs };
}

function summaryFor(
  unit: OrgUnit,
  directRole: Membership['role'] | null = null,
) {
  return new Map([[unit.id, { memberCount: 1, directRole }]]);
}

describe('IdentityService organization operations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a root, grants the creator ownership, and enriches the result', async () => {
    const { service, runAs } = makeService();
    const createRoot = vi
      .spyOn(OrgUnitsRepository.prototype, 'createRoot')
      .mockResolvedValue(root);
    const grant = vi
      .spyOn(MembershipsRepository.prototype, 'grant')
      .mockResolvedValue(undefined);
    vi.spyOn(MembershipsRepository.prototype, 'summarize').mockResolvedValue(
      summaryFor(root, 'owner'),
    );

    await expect(
      service.createRootOrg({
        userId: ownerId,
        name: 'Root',
        type: 'organization',
      }),
    ).resolves.toMatchObject({
      id: root.id,
      memberCount: 1,
      directRole: 'owner',
    });
    expect(runAs).toHaveBeenCalledWith(ownerId, expect.any(Function));
    expect(createRoot).toHaveBeenCalledWith({
      name: 'Root',
      type: 'organization',
      createdBy: ownerId,
    });
    expect(grant).toHaveBeenCalledWith({
      userId: ownerId,
      orgUnitId: root.id,
      role: 'owner',
    });
  });

  it('creates a child under a visible parent and maps a missing summary to zero/null', async () => {
    const { service } = makeService();
    vi.spyOn(
      OrgUnitsRepository.prototype,
      'findByIdInLockedTree',
    ).mockResolvedValue(root);
    const createChild = vi
      .spyOn(OrgUnitsRepository.prototype, 'createChild')
      .mockResolvedValue(child);
    vi.spyOn(MembershipsRepository.prototype, 'summarize').mockResolvedValue(
      new Map(),
    );

    await expect(
      service.createChildOrg({
        userId: ownerId,
        parentId: root.id,
        name: 'Child',
        type: 'team',
      }),
    ).resolves.toMatchObject({
      id: child.id,
      memberCount: 0,
      directRole: null,
    });
    expect(createChild).toHaveBeenCalledWith({
      parent: root,
      name: 'Child',
      type: 'team',
      createdBy: ownerId,
    });
  });

  it('maps a missing child parent and deferred path violation', async () => {
    const { service } = makeService();
    vi.spyOn(
      OrgUnitsRepository.prototype,
      'findByIdInLockedTree',
    ).mockResolvedValue(undefined);
    await expect(
      service.createChildOrg({
        userId: ownerId,
        parentId: root.id,
        name: 'Child',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const { service: conflicted } = makeService();
    vi.spyOn(
      OrgUnitsRepository.prototype,
      'findByIdInLockedTree',
    ).mockRejectedValue(
      Object.assign(new Error('path changed'), { code: '23514' }),
    );
    await expect(
      conflicted.createChildOrg({
        userId: ownerId,
        parentId: root.id,
        name: 'Child',
      }),
    ).rejects.toMatchObject({
      response: { code: ORG_UNITS_ERROR_CODES.concurrentTreeChange },
    });
  });

  it('resolves inherited roles, returns null for an invisible unit, and lists enriched units', async () => {
    const { service } = makeService();
    vi.spyOn(OrgUnitsRepository.prototype, 'findById')
      .mockResolvedValueOnce(child)
      .mockResolvedValueOnce(undefined);
    const findOnPath = vi
      .spyOn(MembershipsRepository.prototype, 'findByUserOnUnits')
      .mockResolvedValue([membership]);

    await expect(
      service.resolveRole({ userId: memberId, orgUnitId: child.id }),
    ).resolves.toMatchObject({ role: 'member', inherited: true });
    await expect(
      service.resolveRole({ userId: memberId, orgUnitId: child.id }),
    ).resolves.toBeNull();
    expect(findOnPath).toHaveBeenCalledWith(memberId, [root.id, child.id]);

    const { service: listed } = makeService();
    vi.spyOn(OrgUnitsRepository.prototype, 'listVisible').mockResolvedValue([
      root,
      child,
    ]);
    const summarize = vi
      .spyOn(MembershipsRepository.prototype, 'summarize')
      .mockResolvedValue(summaryFor(root, 'owner'));
    await expect(listed.listOrgUnits(ownerId)).resolves.toEqual([
      { ...root, memberCount: 1, directRole: 'owner' },
      { ...child, memberCount: 0, directRole: null },
    ]);
    expect(summarize).toHaveBeenCalledWith(ownerId, [root.id, child.id]);
  });

  it('gets a summarized unit and maps an absent unit to 404', async () => {
    const { service } = makeService();
    vi.spyOn(OrgUnitsRepository.prototype, 'findById')
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce(undefined);
    vi.spyOn(MembershipsRepository.prototype, 'summarize').mockResolvedValue(
      summaryFor(root, 'owner'),
    );

    await expect(
      service.getOrgUnit({ userId: ownerId, orgUnitId: root.id }),
    ).resolves.toMatchObject({ id: root.id, directRole: 'owner' });
    await expect(
      service.getOrgUnit({ userId: ownerId, orgUnitId: root.id }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates a name, settings, and move-to-root in one owner-scoped operation', async () => {
    const { service } = makeService();
    const findById = vi
      .spyOn(OrgUnitsRepository.prototype, 'findById')
      .mockResolvedValueOnce(child)
      .mockResolvedValueOnce(child);
    const moveToRoot = vi
      .spyOn(OrgUnitsRepository.prototype, 'moveToRoot')
      .mockResolvedValue(child);
    const rename = vi
      .spyOn(OrgUnitsRepository.prototype, 'rename')
      .mockResolvedValue(child);
    const updateSettings = vi
      .spyOn(OrgUnitsRepository.prototype, 'updateSettings')
      .mockResolvedValue(child);
    vi.spyOn(MembershipsRepository.prototype, 'summarize').mockResolvedValue(
      summaryFor(child, 'admin'),
    );

    await expect(
      service.updateOrgUnit({
        userId: ownerId,
        orgUnitId: child.id,
        name: 'Renamed',
        settings: { color: 'blue' },
        parentId: null,
      }),
    ).resolves.toMatchObject({ id: child.id, directRole: 'admin' });
    expect(findById).toHaveBeenCalledTimes(2);
    expect(moveToRoot).toHaveBeenCalledWith({ id: child.id });
    expect(rename).toHaveBeenCalledWith(child.id, 'Renamed');
    expect(updateSettings).toHaveBeenCalledWith(child.id, { color: 'blue' });
  });

  it('updates under a new parent and maps missing parents and denied writes', async () => {
    const { service } = makeService();
    vi.spyOn(OrgUnitsRepository.prototype, 'findById')
      .mockResolvedValueOnce(child)
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce(child);
    const move = vi
      .spyOn(OrgUnitsRepository.prototype, 'move')
      .mockResolvedValue(child);
    vi.spyOn(MembershipsRepository.prototype, 'summarize').mockResolvedValue(
      new Map(),
    );
    await expect(
      service.updateOrgUnit({
        userId: ownerId,
        orgUnitId: child.id,
        parentId: root.id,
      }),
    ).resolves.toMatchObject({ id: child.id, memberCount: 0 });
    expect(move).toHaveBeenCalledWith({ id: child.id }, root);

    const { service: missingParent } = makeService();
    vi.spyOn(OrgUnitsRepository.prototype, 'findById')
      .mockResolvedValueOnce(child)
      .mockResolvedValueOnce(undefined);
    await expect(
      missingParent.updateOrgUnit({
        userId: ownerId,
        orgUnitId: child.id,
        parentId: root.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const { service: denied } = makeService();
    vi.spyOn(OrgUnitsRepository.prototype, 'findById').mockResolvedValue(child);
    vi.spyOn(OrgUnitsRepository.prototype, 'rename').mockResolvedValue(
      undefined,
    );
    await expect(
      denied.updateOrgUnit({
        userId: ownerId,
        orgUnitId: child.id,
        name: 'Denied',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maps update move, integrity, and RLS failures to their domain errors', async () => {
    const { service } = makeService();
    vi.spyOn(OrgUnitsRepository.prototype, 'findById').mockResolvedValue(child);
    vi.spyOn(OrgUnitsRepository.prototype, 'moveToRoot').mockRejectedValue(
      new MoveIntoOwnSubtreeError(
        'Cannot move an org unit into its own subtree.',
      ),
    );
    await expect(
      service.updateOrgUnit({
        userId: ownerId,
        orgUnitId: child.id,
        parentId: null,
      }),
    ).rejects.toMatchObject({
      response: { code: ORG_UNITS_ERROR_CODES.moveIntoOwnSubtree },
    });

    const { service: integrity } = makeService();
    vi.spyOn(OrgUnitsRepository.prototype, 'findById').mockResolvedValue(child);
    vi.spyOn(OrgUnitsRepository.prototype, 'rename').mockRejectedValue(
      Object.assign(new Error('tree changed'), { code: '23514' }),
    );
    await expect(
      integrity.updateOrgUnit({
        userId: ownerId,
        orgUnitId: child.id,
        name: 'x',
      }),
    ).rejects.toMatchObject({
      response: { code: ORG_UNITS_ERROR_CODES.concurrentTreeChange },
    });

    const { service: forbidden } = makeService();
    vi.spyOn(OrgUnitsRepository.prototype, 'findById').mockResolvedValue(child);
    vi.spyOn(OrgUnitsRepository.prototype, 'rename').mockRejectedValue(
      Object.assign(new Error('rls'), { code: '42501' }),
    );
    await expect(
      forbidden.updateOrgUnit({
        userId: ownerId,
        orgUnitId: child.id,
        name: 'x',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deletes leaf units and maps absent, denied, and child-restricted deletes', async () => {
    const { service } = makeService();
    vi.spyOn(OrgUnitsRepository.prototype, 'findById')
      .mockResolvedValueOnce(child)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(child)
      .mockResolvedValueOnce(child);
    const remove = vi
      .spyOn(OrgUnitsRepository.prototype, 'delete')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(
        Object.assign(new Error('children'), { code: '23503' }),
      );

    await expect(
      service.deleteOrgUnit({ userId: ownerId, orgUnitId: child.id }),
    ).resolves.toBeUndefined();
    await expect(
      service.deleteOrgUnit({ userId: ownerId, orgUnitId: child.id }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.deleteOrgUnit({ userId: ownerId, orgUnitId: child.id }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deleteOrgUnit({ userId: ownerId, orgUnitId: child.id }),
    ).rejects.toMatchObject({
      response: { code: ORG_UNITS_ERROR_CODES.hasChildren },
    });
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it('lists a visible roster and maps missing units to 404', async () => {
    const { service } = makeService();
    const findById = vi
      .spyOn(OrgUnitsRepository.prototype, 'findById')
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce(undefined);
    const listByUnit = vi
      .spyOn(MembershipsRepository.prototype, 'listByUnit')
      .mockResolvedValue([membership]);

    await expect(
      service.listMemberships({ userId: memberId, orgUnitId: root.id }),
    ).resolves.toEqual([membership]);
    await expect(
      service.listMemberships({ userId: memberId, orgUnitId: root.id }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findById).toHaveBeenCalledTimes(2);
    expect(listByUnit).toHaveBeenCalledWith(root.id);
  });

  it('changes and revokes memberships with existence and permission mapping', async () => {
    const { service } = makeService();
    vi.spyOn(MembershipsRepository.prototype, 'findByUserAndUnit')
      .mockResolvedValueOnce(membership)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(membership)
      .mockResolvedValueOnce(membership)
      .mockResolvedValueOnce(membership)
      .mockResolvedValueOnce(membership);
    const changeRole = vi
      .spyOn(MembershipsRepository.prototype, 'changeRole')
      .mockResolvedValueOnce({ ...membership, role: 'admin' })
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: '42501' }),
      );

    await expect(
      service.changeMembershipRole({
        callerId: ownerId,
        userId: memberId,
        orgUnitId: root.id,
        role: 'admin',
      }),
    ).resolves.toMatchObject({ role: 'admin' });
    await expect(
      service.changeMembershipRole({
        callerId: ownerId,
        userId: memberId,
        orgUnitId: root.id,
        role: 'admin',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.changeMembershipRole({
        callerId: ownerId,
        userId: memberId,
        orgUnitId: root.id,
        role: 'admin',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(changeRole).toHaveBeenCalledWith(memberId, root.id, 'admin');

    const revoke = vi
      .spyOn(MembershipsRepository.prototype, 'revoke')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(
        Object.assign(new Error('last owner'), { code: 'OW001' }),
      );
    await expect(
      service.revokeMembership({
        callerId: ownerId,
        userId: memberId,
        orgUnitId: root.id,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.revokeMembership({
        callerId: ownerId,
        userId: memberId,
        orgUnitId: root.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.revokeMembership({
        callerId: ownerId,
        userId: memberId,
        orgUnitId: root.id,
      }),
    ).rejects.toMatchObject({
      response: { code: ORG_UNITS_ERROR_CODES.lastOwner },
    });
    expect(revoke).toHaveBeenCalledTimes(3);
  });

  it('grants memberships and maps duplicate, foreign-key, RLS, and passthrough errors', async () => {
    const { service } = makeService();
    const grant = vi
      .spyOn(MembershipsRepository.prototype, 'grant')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Object.assign(new Error('duplicate'), { code: '23505' }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('missing'), { code: '23503' }),
      )
      .mockRejectedValueOnce(Object.assign(new Error('rls'), { code: '42501' }))
      .mockRejectedValueOnce(new Error('other'));
    const input = {
      callerId: ownerId,
      userId: memberId,
      orgUnitId: root.id,
      role: 'member' as const,
    };

    await expect(service.grantMembership(input)).resolves.toBeUndefined();
    await expect(service.grantMembership(input)).rejects.toMatchObject({
      response: { code: ORG_UNITS_ERROR_CODES.duplicateMembership },
    });
    await expect(service.grantMembership(input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.grantMembership(input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.grantMembership(input)).rejects.toThrow('other');
    expect(grant).toHaveBeenCalledWith({
      userId: memberId,
      orgUnitId: root.id,
      role: 'member',
    });
  });
});
