/**
 * Org/membership admin surface on a live DB (FORCE RLS) — the security
 * properties the HTTP slice depends on:
 * - create root org → creator is owner + sees it; a stranger does not;
 * - an owner/admin grants; a plain member CANNOT grant (RLS insert denies);
 * - a cross-tenant admin cannot grant into another org;
 * - re-granting an existing member → 409 (ConflictException);
 * - roster visibility: any member on the path sees it, a stranger sees none
 *   (org-units change, D4);
 * - an admin can revoke/change ANOTHER member's row — previously impossible
 *   under the own-rows-only `memberships_select` (Postgres applies the
 *   SELECT policy to UPDATE/DELETE targets too); `llame_role_on_unit_path`
 *   (D4) is the recursion-safe visibility change that unblocks it;
 * - owner-tier grants (D3): a plain admin still cannot mint `owner` through
 *   the service; an owner can.
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { IdentityService } from './identity.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

describeIfDb('org/membership admin surface — RLS + escalation guards', () => {
  let sql: SqlClient;
  let db: Db;
  let identity: IdentityService;
  let owner: string;
  let member: string;
  let stranger: string;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    identity = new IdentityService(new TenantDbService(db));
    owner = crypto.randomUUID();
    member = crypto.randomUUID();
    stranger = crypto.randomUUID();
    for (const id of [owner, member, stranger]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'Org', ${`org-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      // The last-owner trigger (org-units change, D2) now blocks deleting a
      // user who is the sole owner of a root org — every unit `owner` created
      // in this suite has to go leaf-first before the users can, same pattern
      // as identity-rls.integration.spec.ts's teardown.
      for (const creator of [owner, member, stranger]) {
        await sql.begin(async (tx: SqlClient) => {
          await tx`SELECT set_config('app.current_user_id', ${creator}, true)`;
          const units =
            await tx`SELECT id FROM org_units WHERE created_by = ${creator} ORDER BY length(path) DESC`;
          for (const u of units) {
            await tx`DELETE FROM org_units WHERE id = ${u.id}`;
          }
        });
      }
      await sql`DELETE FROM users WHERE id IN (${owner}, ${member}, ${stranger})`;
      await sql.end();
    }
  });

  const idsOf = async (userId: string) =>
    (await identity.listOrgUnits(userId)).map((u) => u.id);

  const asUser = (userId: string, fn: (tx: SqlClient) => Promise<any>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  it('create → creator is owner + sees it; a stranger does not', async () => {
    const unit = await identity.createRootOrg({ userId: owner, name: 'Acme' });
    expect(await idsOf(owner)).toContain(unit.id);
    expect(await idsOf(stranger)).not.toContain(unit.id);
  });

  it('owner grants a member; a plain member cannot grant (RLS)', async () => {
    const unit = await identity.createRootOrg({ userId: owner, name: 'Beta' });

    await identity.grantMembership({
      callerId: owner,
      userId: member,
      orgUnitId: unit.id,
      role: 'member',
    });
    expect(await idsOf(member)).toContain(unit.id); // now a member → visible

    // The plain member cannot grant anyone (not owner/admin) — RLS insert denies,
    // mapped to a 403, not a raw driver error.
    await expect(
      identity.grantMembership({
        callerId: member,
        userId: stranger,
        orgUnitId: unit.id,
        role: 'member',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await idsOf(stranger)).not.toContain(unit.id);
  });

  it('a cross-tenant admin cannot grant into another org', async () => {
    await identity.createRootOrg({ userId: owner, name: 'Mine' });
    const theirs = await identity.createRootOrg({
      userId: stranger,
      name: 'Theirs',
    });

    // owner is not a member of `theirs` → cannot grant into it.
    await expect(
      identity.grantMembership({
        callerId: owner,
        userId: member,
        orgUnitId: theirs.id,
        role: 'member',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // The attempted grant left no trace: `member` is still not a member of theirs.
    expect(await idsOf(member)).not.toContain(theirs.id);
  });

  it('re-granting an existing member → 409', async () => {
    const unit = await identity.createRootOrg({ userId: owner, name: 'Delta' });
    await identity.grantMembership({
      callerId: owner,
      userId: member,
      orgUnitId: unit.id,
      role: 'member',
    });
    await expect(
      identity.grantMembership({
        callerId: owner,
        userId: member,
        orgUnitId: unit.id,
        role: 'admin',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a member sees the unit’s roster (D4); a stranger sees none of it', async () => {
    const unit = await identity.createRootOrg({
      userId: owner,
      name: 'RosterOrg',
    });
    await identity.grantMembership({
      callerId: owner,
      userId: member,
      orgUnitId: unit.id,
      role: 'member',
    });

    const roster = await asUser(
      member,
      (tx) =>
        tx`SELECT user_id FROM memberships WHERE org_unit_id = ${unit.id}`,
    );
    expect(roster.map((r: { user_id: string }) => r.user_id).sort()).toEqual(
      [owner, member].sort(),
    );

    const strangerView = await asUser(
      stranger,
      (tx) => tx`SELECT id FROM memberships WHERE org_unit_id = ${unit.id}`,
    );
    expect(strangerView.length).toBe(0);
  });

  it('an admin can revoke or change ANOTHER member’s row (D4 — previously blocked by own-rows-only select)', async () => {
    const unit = await identity.createRootOrg({
      userId: owner,
      name: 'AdminOpsOrg',
    });
    const target = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${target}, 'Target', ${`target-${target}@t.com`})`;
    await identity.grantMembership({
      callerId: owner,
      userId: target,
      orgUnitId: unit.id,
      role: 'member',
    });

    // Role-change/revoke service methods don't exist until the HTTP-surface
    // slice (#44 tasks group 3) — this proves the DATASTORE now admits the
    // operation at all, which is what group 3's service methods will rely on.
    await asUser(
      owner,
      (tx) =>
        tx`UPDATE memberships SET role = 'viewer' WHERE user_id = ${target} AND org_unit_id = ${unit.id}`,
    );
    const changed = await asUser(
      owner,
      (tx) =>
        tx`SELECT role FROM memberships WHERE user_id = ${target} AND org_unit_id = ${unit.id}`,
    );
    expect(changed).toEqual([{ role: 'viewer' }]);

    await asUser(
      owner,
      (tx) =>
        tx`DELETE FROM memberships WHERE user_id = ${target} AND org_unit_id = ${unit.id}`,
    );
    const gone = await asUser(
      target,
      (tx) => tx`SELECT id FROM memberships WHERE org_unit_id = ${unit.id}`,
    );
    expect(gone.length).toBe(0);

    await sql`DELETE FROM users WHERE id = ${target}`;
  });

  it('a plain admin cannot mint owner via the service; an owner can (D3)', async () => {
    const unit = await identity.createRootOrg({
      userId: owner,
      name: 'ServiceOwnerOrg',
    });
    const adminUser = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${adminUser}, 'Admin', ${`admin-${adminUser}@t.com`})`;
    await identity.grantMembership({
      callerId: owner,
      userId: adminUser,
      orgUnitId: unit.id,
      role: 'admin',
    });

    await expect(
      identity.grantMembership({
        callerId: adminUser,
        userId: stranger,
        orgUnitId: unit.id,
        role: 'owner',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await idsOf(stranger)).not.toContain(unit.id);

    await identity.grantMembership({
      callerId: owner,
      userId: stranger,
      orgUnitId: unit.id,
      role: 'owner',
    });
    expect(await idsOf(stranger)).toContain(unit.id);

    await sql`DELETE FROM users WHERE id = ${adminUser}`;
  });

  it('list enrichment (D3): memberCount + directRole reflect visible membership rows', async () => {
    const unit = await identity.createRootOrg({
      userId: owner,
      name: 'EnrichOrg',
    });
    await identity.grantMembership({
      callerId: owner,
      userId: member,
      orgUnitId: unit.id,
      role: 'member',
    });

    const ownerList = await identity.listOrgUnits(owner);
    const seenByOwner = ownerList.find((u) => u.id === unit.id);
    expect(seenByOwner).toMatchObject({ memberCount: 2, directRole: 'owner' });

    const memberList = await identity.listOrgUnits(member);
    const seenByMember = memberList.find((u) => u.id === unit.id);
    expect(seenByMember).toMatchObject({
      memberCount: 2,
      directRole: 'member',
    });
  });

  it('a unit invisible to the caller is absent from the list — no count/role leaked (D3)', async () => {
    const unit = await identity.createRootOrg({
      userId: owner,
      name: 'HiddenOrg',
    });
    await identity.grantMembership({
      callerId: owner,
      userId: member,
      orgUnitId: unit.id,
      role: 'member',
    });

    const strangerList = await identity.listOrgUnits(stranger);
    expect(strangerList.find((u) => u.id === unit.id)).toBeUndefined();
  });

  it('a descendant’s directRole is null when the caller’s role is only on an ancestor (D3)', async () => {
    const root = await identity.createRootOrg({
      userId: owner,
      name: 'DeepOrg',
    });
    const child = await identity.createChildOrg({
      userId: owner,
      parentId: root.id,
      name: 'Child',
    });

    const list = await identity.listOrgUnits(owner);
    const childEntry = list.find((u) => u.id === child.id);
    expect(childEntry).toBeDefined();
    // owner's role is on root only — inherited on child, never a direct row.
    expect(childEntry!.directRole).toBeNull();
    expect(childEntry!.memberCount).toBe(0);

    const rootEntry = list.find((u) => u.id === root.id);
    expect(rootEntry).toMatchObject({ memberCount: 1, directRole: 'owner' });
  });

  it('unscoped context (no app.current_user_id) sees no memberships and cannot write (fail closed)', async () => {
    const unit = await identity.createRootOrg({
      userId: owner,
      name: 'UnscopedOrg',
    });

    const rows = await sql.begin(
      (tx: SqlClient) =>
        tx`SELECT id FROM memberships WHERE org_unit_id = ${unit.id}`,
    );
    expect(rows.length).toBe(0);

    await expect(
      sql.begin(
        (tx: SqlClient) =>
          tx`INSERT INTO memberships (user_id, org_unit_id, role) VALUES (${stranger}, ${unit.id}, 'member')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
