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

      const project = await identity.createChildOrg({
        userId: ownerId,
        parentId: teamId,
        name: 'Assistant',
        type: 'project',
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
