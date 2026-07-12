/**
 * Identity RLS integration tests (#44) — requires a real PostgreSQL
 * connection; same harness contract as chats-rls.integration.spec.ts:
 * set TEST_DATABASE_URL to run, connecting role must be non-superuser and
 * ideally the table owner (a green run as the owner proves FORCE works).
 *
 * Covered:
 * - RLS ENABLED *and* FORCED on org_units / memberships / external_identities
 * - creator bootstrap: root org + own owner membership in one tx
 * - subtree visibility via the id-based materialized path (inherited)
 * - cross-tenant invisibility (org units, memberships, identities)
 * - membership grant policy: admins can grant, strangers and members cannot
 * - self-grant escalation into a foreign org is denied
 * - owner can never be minted through the general (ancestor-admin) grant
 *   path, even at the raw repository level — only the creator-bootstrap
 *   branch can mint it (datastore backstop for the DTO-level guard)
 * - move keeps the subtree path consistent (#44 acceptance)
 * - nearest-wins role resolution against real rows (service-level)
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { IdentityService } from './identity.service';
import {
  MembershipsRepository,
  OrgUnitsRepository,
} from './identity-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

describeIfDb(
  'Identity RLS integration — org tree isolation under FORCE',
  () => {
    let sql: SqlClient;
    let db: Db;
    let tenantDb: TenantDbService;
    let identity: IdentityService;
    let ownerId: string; // creates the org, owner at root
    let memberId: string; // plain member of the team
    let strangerId: string; // no memberships at all

    const asUser = (userId: string, fn: (tx: SqlClient) => Promise<any>) =>
      sql.begin(async (tx: SqlClient) => {
        await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
        return fn(tx);
      });

    beforeAll(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const postgres = require('postgres');
      const connect = postgres.default ?? postgres;
      const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
      sql = connect(TEST_DB_URL!, { ssl, max: 2 });
      db = drizzle(sql, { schema });
      tenantDb = new TenantDbService(db);
      identity = new IdentityService(tenantDb);

      ownerId = crypto.randomUUID();
      memberId = crypto.randomUUID();
      strangerId = crypto.randomUUID();
      for (const [id, name] of [
        [ownerId, 'Org Owner'],
        [memberId, 'Team Member'],
        [strangerId, 'Stranger'],
      ] as const) {
        await sql`INSERT INTO users (id, name, email) VALUES (${id}, ${name}, ${`${name.replace(/\s/g, '-').toLowerCase()}-${id}@test.com`})`;
      }
    });

    afterAll(async () => {
      if (sql) {
        // org_units.created_by is SET NULL on user delete and children RESTRICT
        // their parent — delete units leaf-first as the owner, then the users.
        await asUser(ownerId, async (tx) => {
          const units =
            await tx`SELECT id, path FROM org_units WHERE created_by = ${ownerId} ORDER BY length(path) DESC`;
          for (const u of units) {
            await tx`DELETE FROM org_units WHERE id = ${u.id}`;
          }
        });
        await sql`DELETE FROM users WHERE id IN (${ownerId}, ${memberId}, ${strangerId})`;
        await sql.end();
      }
    });

    it('harness is meaningful: non-superuser, RLS ENABLED + FORCED on all three tables', async () => {
      const [role] =
        await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);

      const rows = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('org_units', 'memberships', 'external_identities')
      ORDER BY relname`;
      expect(rows.length).toBe(3);
      for (const r of rows) {
        expect(r.relrowsecurity).toBe(true);
        expect(r.relforcerowsecurity).toBe(true);
      }
    });

    it("org_unit_type no longer contains 'project' post-migration (admin-area-org-tree D5) — directly testing the migration's stray-row UPDATE is impractical here (a fresh test DB applies every migration before seeding, so no pre-migration 'project' row ever exists to convert); this pins the migration's actual outcome, the enum vocabulary, instead", async () => {
      const rows = await sql`
        SELECT e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'org_unit_type'
        ORDER BY e.enumsortorder`;
      const labels = rows.map((r: { enumlabel: string }) => r.enumlabel);
      expect(labels).toEqual(['organization', 'group', 'team', 'department']);
      expect(labels).not.toContain('project');
    });

    let rootId: string;
    let teamId: string;
    let projectId: string;

    it('creator bootstrap: root org + owner membership land in one transaction', async () => {
      const root = await identity.createRootOrg({
        userId: ownerId,
        name: 'Acme',
        type: 'organization',
      });
      rootId = root.id;
      expect(root.path).toBe(root.id);

      const role = await identity.resolveRole({
        userId: ownerId,
        orgUnitId: rootId,
      });
      expect(role).toEqual({
        role: 'owner',
        viaOrgUnitId: rootId,
        inherited: false,
      });
    });

    it('nesting: children materialize the ancestor path', async () => {
      const team = await identity.createChildOrg({
        userId: ownerId,
        parentId: rootId,
        name: 'Platform',
        type: 'team',
      });
      teamId = team.id;
      expect(team.path).toBe(`${rootId}/${teamId}`);

      // NB: this unit is named/varnamed "project" for the test's own tree
      // narrative only — `'project'` is not an org_unit_type value (dropped,
      // admin-area-org-tree D5); use a real vocabulary type.
      const project = await identity.createChildOrg({
        userId: ownerId,
        parentId: teamId,
        name: 'Assistant',
        type: 'department',
      });
      projectId = project.id;
      expect(project.path).toBe(`${rootId}/${teamId}/${projectId}`);
    });

    it('a stranger sees nothing and cannot create children in a foreign org', async () => {
      const visible = await asUser(
        strangerId,
        (tx) => tx`SELECT id FROM org_units WHERE id = ${rootId}`,
      );
      expect(visible.length).toBe(0);

      await expect(
        identity.createChildOrg({
          userId: strangerId,
          parentId: rootId,
          name: 'Sneaky',
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('self-grant escalation into a foreign org is denied by RLS', async () => {
      await expect(
        asUser(
          strangerId,
          (tx) =>
            tx`INSERT INTO memberships (user_id, org_unit_id, role) VALUES (${strangerId}, ${rootId}, 'owner')`,
        ),
      ).rejects.toThrow(/row-level security/i);

      // Forged path on a child insert doesn't help either: the WITH CHECK only
      // passes when the caller actually holds admin on a path segment, and the
      // stranger holds nothing.
      await expect(
        asUser(
          strangerId,
          (tx) =>
            tx`INSERT INTO org_units (parent_id, name, path, created_by)
             VALUES (${rootId}, 'Forged', ${rootId} || '/' || gen_random_uuid(), ${strangerId})`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('admins grant memberships; inherited subtree visibility follows', async () => {
      await identity.grantMembership({
        callerId: ownerId,
        userId: memberId,
        orgUnitId: teamId,
        role: 'member',
      });

      // The member now sees the team AND its subtree (project), but not by
      // membership on the project itself — inheritance via the path.
      const visible = await asUser(
        memberId,
        (tx) => tx`SELECT id FROM org_units ORDER BY path`,
      );
      const ids = visible.map((r: { id: string }) => r.id);
      expect(ids).toContain(teamId);
      expect(ids).toContain(projectId);
      // The ROOT is not on any of the member's membership paths' subtrees —
      // wait: the root IS an ancestor, not a descendant. Ancestors stay
      // invisible: membership grants subtree visibility downward only.
      expect(ids).not.toContain(rootId);

      const projectRole = await identity.resolveRole({
        userId: memberId,
        orgUnitId: projectId,
      });
      expect(projectRole).toEqual({
        role: 'member',
        viaOrgUnitId: teamId,
        inherited: true,
      });
    });

    it('a plain member cannot grant memberships (not admin)', async () => {
      // Drizzle wraps the Postgres RLS violation — assert the rejection, then
      // prove no row landed (the stranger still sees zero own memberships).
      await expect(
        identity.grantMembership({
          callerId: memberId,
          userId: strangerId,
          orgUnitId: projectId,
          role: 'member',
        }),
      ).rejects.toThrow();
      const rows = await asUser(
        strangerId,
        (tx) => tx`SELECT id FROM memberships WHERE user_id = ${strangerId}`,
      );
      expect(rows.length).toBe(0);
    });

    it('an owner-tier ancestor CAN mint an owner on a descendant (D3 — deliberate scope change)', async () => {
      // ownerId legitimately holds `owner` on rootId, an ancestor of teamId —
      // D3 lets an owner-tier caller grant/set `owner` ANYWHERE on their
      // path, not just the exact unit they hold it on (an owner already
      // dominates the whole subtree; this adds no new power). Called at the
      // repository level, bypassing IdentityService's mapping AND
      // GrantMembershipDto's role enum entirely, to prove the DATASTORE
      // itself admits this — not just app code.
      await tenantDb.runAs(ownerId, async (tx) => {
        await new MembershipsRepository(tx).grant({
          userId: strangerId,
          orgUnitId: teamId,
          role: 'owner',
        });
      });

      const granted = await asUser(
        strangerId,
        (tx) =>
          tx`SELECT role FROM memberships WHERE org_unit_id = ${teamId} AND user_id = ${strangerId}`,
      );
      expect(granted).toEqual([{ role: 'owner' }]);

      // Clean up — later tests assume strangerId holds nothing on teamId.
      await tenantDb.runAs(ownerId, async (tx) => {
        await new MembershipsRepository(tx).revoke(strangerId, teamId);
      });
    });

    it('a plain admin (not owner) can never mint owner through the general grant path (RLS backstop)', async () => {
      // adminOnTeamId holds `admin` — not `owner` — on teamId. The
      // ancestor-admin branch of `memberships_insert` admits admin-tier
      // grants of any role EXCEPT `owner`; the datastore backstop is the
      // `role <> 'owner'` clause on that branch specifically. Drizzle wraps
      // the raw driver error (its own `.message` is just "Failed query: ...")
      // so assert on the underlying SQLSTATE via `.cause`, not a message
      // substring — 42501 is Postgres's code for an RLS policy violation.
      const adminOnTeamId = crypto.randomUUID();
      await sql`INSERT INTO users (id, name, email) VALUES (${adminOnTeamId}, 'Team Admin', ${`team-admin-${adminOnTeamId}@test.com`})`;
      await tenantDb.runAs(ownerId, async (tx) => {
        await new MembershipsRepository(tx).grant({
          userId: adminOnTeamId,
          orgUnitId: teamId,
          role: 'admin',
        });
      });

      await expect(
        tenantDb.runAs(adminOnTeamId, async (tx) => {
          await new MembershipsRepository(tx).grant({
            userId: strangerId,
            orgUnitId: teamId,
            role: 'owner',
          });
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: '42501' }),
      });

      const granted = await asUser(
        strangerId,
        (tx) => tx`SELECT id FROM memberships WHERE org_unit_id = ${teamId}`,
      );
      expect(granted.length).toBe(0);

      await sql`DELETE FROM users WHERE id = ${adminOnTeamId}`;
    });

    it('a plain admin cannot demote or revoke an existing owner (F1 — targeting an owner row needs owner-tier)', async () => {
      // D2's last-owner trigger only guards the LAST owner; without F1's
      // fix, an admin (not owner-tier) could freely demote or revoke a
      // co-owner as long as another owner remains, since neither the old
      // memberships_update USING nor memberships_delete USING looked at the
      // TARGET row's role, only at the caller's own tier.
      const coOwnerId = crypto.randomUUID();
      const adminId = crypto.randomUUID();
      await sql`INSERT INTO users (id, name, email) VALUES (${coOwnerId}, 'Co Owner', ${`f1-co-${coOwnerId}@test.com`})`;
      await sql`INSERT INTO users (id, name, email) VALUES (${adminId}, 'Plain Admin', ${`f1-admin-${adminId}@test.com`})`;

      await tenantDb.runAs(ownerId, async (tx) => {
        const repo = new MembershipsRepository(tx);
        // Owner-tier mints a co-owner (D3) and a plain admin on the SAME unit.
        await repo.grant({
          userId: coOwnerId,
          orgUnitId: teamId,
          role: 'owner',
        });
        await repo.grant({ userId: adminId, orgUnitId: teamId, role: 'admin' });
      });

      // The admin can demote/revoke an ordinary member (sanity: F1 didn't
      // over-tighten normal admin-tier operations) — reuse memberId, who
      // already holds `member` on teamId from an earlier test.
      await asUser(
        adminId,
        (tx) =>
          tx`UPDATE memberships SET role = 'viewer' WHERE user_id = ${memberId} AND org_unit_id = ${teamId}`,
      );
      const memberNowViewer = await asUser(
        memberId,
        (tx) =>
          tx`SELECT role FROM memberships WHERE user_id = ${memberId} AND org_unit_id = ${teamId}`,
      );
      expect(memberNowViewer).toEqual([{ role: 'viewer' }]);

      // But the SAME admin cannot touch the co-owner's row at all — not
      // demote it, not revoke it — despite another owner (ownerId) remaining.
      // Postgres RLS for UPDATE/DELETE doesn't throw when the target row is
      // invisible under USING — the row is simply not a candidate, so the
      // statement "succeeds" affecting zero rows. Assert on the affected-row
      // count and the resulting state, not a thrown exception (unlike INSERT,
      // where a WITH CHECK failure on an attempted row DOES throw).
      const updateResult = await asUser(
        adminId,
        (tx) =>
          tx`UPDATE memberships SET role = 'member' WHERE user_id = ${coOwnerId} AND org_unit_id = ${teamId}`,
      );
      expect(updateResult.count).toBe(0);

      const deleteResult = await asUser(
        adminId,
        (tx) =>
          tx`DELETE FROM memberships WHERE user_id = ${coOwnerId} AND org_unit_id = ${teamId}`,
      );
      expect(deleteResult.count).toBe(0);

      const stillOwner = await asUser(
        coOwnerId,
        (tx) =>
          tx`SELECT role FROM memberships WHERE user_id = ${coOwnerId} AND org_unit_id = ${teamId}`,
      );
      expect(stillOwner).toEqual([{ role: 'owner' }]);

      // Cleanup: owner-tier (ownerId) can legitimately revoke the co-owner —
      // proves the backstop is tier-specific, not a blanket "owners are
      // untouchable" rule.
      await tenantDb.runAs(ownerId, (tx) =>
        new MembershipsRepository(tx).revoke(coOwnerId, teamId),
      );
      await sql`DELETE FROM users WHERE id IN (${coOwnerId}, ${adminId})`;
    });

    it('move rewrites the whole subtree path consistently (#44 acceptance)', async () => {
      // Give the org a second top-level team, then move the project under it.
      const ops = await identity.createChildOrg({
        userId: ownerId,
        parentId: rootId,
        name: 'Ops',
        type: 'team',
      });

      await tenantDb.runAs(ownerId, async (tx) => {
        const repo = new OrgUnitsRepository(tx);
        const project = (await repo.findById(projectId))!;
        const newParent = (await repo.findById(ops.id))!;
        await repo.move(project, newParent);
      });

      const moved = await tenantDb.runAs(ownerId, (tx) =>
        new OrgUnitsRepository(tx).findById(projectId),
      );
      expect(moved?.path).toBe(`${rootId}/${ops.id}/${projectId}`);
      expect(moved?.parentId).toBe(ops.id);

      // The member's inherited access followed the tree: the project left the
      // member's team subtree, so it is no longer visible to them.
      const visible = await asUser(
        memberId,
        (tx) => tx`SELECT id FROM org_units WHERE id = ${projectId}`,
      );
      expect(visible.length).toBe(0);
    });

    it('move into the own subtree is refused', async () => {
      await expect(
        tenantDb.runAs(ownerId, async (tx) => {
          const repo = new OrgUnitsRepository(tx);
          const root = (await repo.findById(rootId))!;
          const team = (await repo.findById(teamId))!;
          await repo.move(root, team);
        }),
      ).rejects.toThrow(/own subtree/);
    });

    it('memberships and external identities are cross-tenant invisible', async () => {
      const foreign = await asUser(
        strangerId,
        (tx) => tx`SELECT id FROM memberships`,
      );
      expect(foreign.length).toBe(0);

      await asUser(
        memberId,
        (tx) =>
          tx`INSERT INTO external_identities (user_id, provider, external_subject)
           VALUES (${memberId}, 'telegram', ${`tg-${memberId}`})`,
      );
      const mine = await asUser(
        memberId,
        (tx) => tx`SELECT provider FROM external_identities`,
      );
      expect(mine.length).toBe(1);
      const others = await asUser(
        ownerId,
        (tx) => tx`SELECT provider FROM external_identities`,
      );
      expect(others.length).toBe(0);
    });

    it('unscoped context sees nothing (fail closed)', async () => {
      const rows = await sql.begin(
        (tx: SqlClient) => tx`SELECT id FROM org_units`,
      );
      expect(rows.length).toBe(0);
    });

    it('nearest-wins demotion works against real rows', async () => {
      // Owner grants themselves viewer on the team: explicit nearest membership
      // must beat the inherited root ownership.
      await tenantDb.runAs(ownerId, async (tx) => {
        await new MembershipsRepository(tx).grant({
          userId: ownerId,
          orgUnitId: teamId,
          role: 'viewer',
        });
      });
      const demoted = await identity.resolveRole({
        userId: ownerId,
        orgUnitId: teamId,
      });
      expect(demoted).toEqual({
        role: 'viewer',
        viaOrgUnitId: teamId,
        inherited: false,
      });
      // Root scope is untouched.
      const atRoot = await identity.resolveRole({
        userId: ownerId,
        orgUnitId: rootId,
      });
      expect(atRoot?.role).toBe('owner');
    });
  },
);
