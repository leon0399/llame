/**
 * Org/membership admin surface on a live DB (FORCE RLS) — the security
 * properties the HTTP slice depends on:
 * - create root org → creator is owner + sees it; a stranger does not;
 * - an owner/admin grants; a plain member CANNOT grant (RLS insert denies);
 * - a cross-tenant admin cannot grant into another org;
 * - re-granting an existing member → 409 (ConflictException).
 *
 * Member REVOKE is NOT covered here — it is deliberately deferred (see
 * identity.controller.ts's NOTE): Postgres applies the own-rows
 * `memberships_select` policy to a DELETE's targets, so an admin removing
 * ANOTHER member needs a recursion-safe SECURITY DEFINER visibility change
 * first.
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

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
      await sql`DELETE FROM users WHERE id IN (${owner}, ${member}, ${stranger})`;
      await sql.end();
    }
  });

  const idsOf = async (userId: string) =>
    (await identity.listOrgUnits(userId)).map((u) => u.id);

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
});
