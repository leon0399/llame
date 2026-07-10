/**
 * DB-enforced org-tree invariants (org-units change, D1/D2) — requires a real
 * PostgreSQL connection; same harness contract as identity-rls.integration.spec.ts.
 *
 * Covered:
 * - D1: a path that doesn't match its parent's current path is rejected at
 *   commit, even when the writer holds admin/owner on the path (so RLS alone
 *   would have let it through) — direct SQL, not just the repository's own
 *   (always-correct) path computation.
 * - D1: a concurrent move and a child-creation under a DESCENDANT of the
 *   moved subtree serialize on the shared tree-root lock — the exact race
 *   per-row/subtree-root locking alone doesn't close (see design.md D1 and
 *   identity-repository.ts's `lockTreeRoot` doc).
 * - D2: the last owner of a ROOT org unit can neither revoke their own
 *   membership nor be demoted; a co-owner may leave; deleting the user
 *   account of a sole root owner is blocked; deleting the org unit itself
 *   (which cascades its memberships) remains allowed even for a sole owner.
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
import { MembershipsRepository } from './identity-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

describeIfDb(
  'Org-tree invariants — DB-enforced path integrity & last-owner protection',
  () => {
    let sql: SqlClient;
    let db: Db;
    let tenantDb: TenantDbService;
    let identity: IdentityService;
    const userIds: string[] = [];
    const rootIds: string[] = [];

    const asUser = (userId: string, fn: (tx: SqlClient) => Promise<any>) =>
      sql.begin(async (tx: SqlClient) => {
        await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
        return fn(tx);
      });

    /** A fresh test user, tracked for teardown. */
    async function makeUser(name: string): Promise<string> {
      const id = crypto.randomUUID();
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, ${name}, ${`${name}-${id}@test.com`})`;
      userIds.push(id);
      return id;
    }

    beforeAll(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const postgres = require('postgres');
      const connect = postgres.default ?? postgres;
      const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
      sql = connect(TEST_DB_URL!, { ssl, max: 5 });
      db = drizzle(sql, { schema });
      tenantDb = new TenantDbService(db);
      identity = new IdentityService(tenantDb);
    });

    afterAll(async () => {
      if (sql) {
        // Ownership can move around within a test (grants, demotions) — a
        // root's CREATOR isn't necessarily its owner by the time cleanup runs
        // (e.g. the "demoting a non-last owner" test demotes the creator away
        // from `owner`). So this tries every known root's WHOLE SUBTREE
        // (leaf-first — FK `RESTRICT` refuses to delete a unit with children)
        // against every known user context instead of trusting `created_by`:
        // RLS's owner-tier `org_units_delete` check just no-ops for a user
        // who isn't owner-tier on that path, and a delete of an already-gone
        // row also no-ops — whichever user currently holds `owner` succeeds.
        // DELETE FROM users below would otherwise re-trip the last-owner
        // trigger on anything left behind.
        for (const rootId of rootIds) {
          for (const candidate of userIds) {
            await asUser(candidate, async (tx) => {
              const subtree = await tx`
                SELECT id FROM org_units
                WHERE id = ${rootId} OR path LIKE ${`${rootId}/%`}
                ORDER BY length(path) DESC
              `;
              for (const node of subtree) {
                await tx`DELETE FROM org_units WHERE id = ${node.id}`;
              }
            });
          }
        }
        if (userIds.length > 0) {
          await sql`DELETE FROM users WHERE id = ANY(${userIds})`;
        }
        await sql.end();
      }
    });

    describe('D1 — path/parent integrity', () => {
      it('a path that does not match its parent’s current path is rejected at commit, even via direct SQL', async () => {
        const owner = await makeUser('Path Owner');
        const root = await identity.createRootOrg({
          userId: owner,
          name: 'Acme',
        });
        rootIds.push(root.id);

        // owner legitimately holds `owner` on root.id, so the RLS WITH CHECK
        // (created_by = self AND admin-tier on an ancestor embedded in the new
        // row's path) is satisfied — root.id IS in the path array below. What
        // it does NOT check is whether the path's LAST segment matches this
        // row's own id, or whether the prefix matches the parent's actual
        // current path — that's exactly what the deferred trigger enforces.
        await expect(
          asUser(
            owner,
            (tx) =>
              tx`INSERT INTO org_units (id, parent_id, name, path, created_by)
             VALUES (gen_random_uuid(), ${root.id}, 'Corrupt', ${root.id} || '/' || gen_random_uuid(), ${owner})`,
          ),
          // Direct call on the raw postgres.js client (not through Drizzle), so
          // the driver error surfaces as-is — `.code`, not `.cause.code`.
        ).rejects.toMatchObject({ code: '23514' });
      });

      it('a root unit whose path does not equal its own id is rejected at commit', async () => {
        const owner = await makeUser('Root Owner');
        // Anyone may create a root (org_units_insert: parent_id IS NULL branch
        // needs no path-role check at all), so a caller with no memberships
        // anywhere can still reach the trigger by hand-forging a root row.
        await expect(
          asUser(
            owner,
            (tx) =>
              tx`INSERT INTO org_units (id, parent_id, name, path, created_by)
             VALUES (gen_random_uuid(), NULL, 'Bad Root', 'not-my-own-id', ${owner})`,
          ),
        ).rejects.toMatchObject({ code: '23514' });
      });

      it('concurrent move + createChild-under-a-descendant serializes on the shared tree-root lock', async () => {
        const owner = await makeUser('Concurrency Owner');
        const root = await identity.createRootOrg({
          userId: owner,
          name: 'ConcurrencyRoot',
        });
        rootIds.push(root.id);
        const team = await identity.createChildOrg({
          userId: owner,
          parentId: root.id,
          name: 'Team',
        });
        const project = await identity.createChildOrg({
          userId: owner,
          parentId: team.id,
          name: 'Project',
        });
        const ops = await identity.createChildOrg({
          userId: owner,
          parentId: root.id,
          name: 'Ops',
        });

        let resolveALocked: () => void;
        const aLocked = new Promise<void>((resolve) => {
          resolveALocked = resolve;
        });
        let resolveProceed: () => void;
        const proceed = new Promise<void>((resolve) => {
          resolveProceed = resolve;
        });

        // Session A mirrors OrgUnitsRepository.move(team, ops): lock the
        // tree root, then PAUSE before rewriting anything — this forces a
        // genuine overlap with session B below instead of hoping timing
        // happens to produce one.
        const movePromise = sql.begin(async (tx: SqlClient) => {
          await tx`SELECT set_config('app.current_user_id', ${owner}, true)`;
          await tx`SELECT id FROM org_units WHERE id = ${root.id} FOR UPDATE`;
          resolveALocked();
          await proceed;
          const oldPrefix = team.path;
          const newPrefix = `${ops.path}/${team.id}`;
          await tx`UPDATE org_units SET path = ${newPrefix} || substr(path, ${oldPrefix.length + 1}::int)
                    WHERE path = ${oldPrefix} OR path LIKE ${`${oldPrefix}/%`}`;
          await tx`UPDATE org_units SET parent_id = ${ops.id} WHERE id = ${team.id}`;
        });

        await aLocked;

        let resolveBAttempted: () => void;
        const bAttempted = new Promise<void>((resolve) => {
          resolveBAttempted = resolve;
        });
        let childId = '';
        // Session B mirrors OrgUnitsRepository.createChild under `project` —
        // a STRICT DESCENDANT of `team`, the unit session A is moving, never
        // the same row. Per-row/subtree-root locking alone would let this
        // proceed unblocked (see design.md D1); only the shared tree-root
        // lock forces it to wait for session A.
        const createChildPromise = sql.begin(async (tx: SqlClient) => {
          await tx`SELECT set_config('app.current_user_id', ${owner}, true)`;
          resolveBAttempted();
          await tx`SELECT id FROM org_units WHERE id = ${root.id} FOR UPDATE`;
          const [freshParent] =
            await tx`SELECT path FROM org_units WHERE id = ${project.id}`;
          childId = crypto.randomUUID();
          await tx`INSERT INTO org_units (id, parent_id, name, path, created_by)
                    VALUES (${childId}, ${project.id}, 'RaceChild', ${freshParent.path} || '/' || ${childId}, ${owner})`;
        });

        await bAttempted;
        // Give session B's lock request time to actually reach Postgres and
        // register as waiting before letting session A proceed — otherwise A
        // could finish before B's request even arrives, which wouldn't force
        // the overlap this test exists to prove is handled.
        await new Promise((resolve) => setTimeout(resolve, 200));
        resolveProceed!();

        await movePromise;
        await createChildPromise;

        const [child] = await asUser(
          owner,
          (tx) =>
            tx`SELECT path, parent_id FROM org_units WHERE id = ${childId}`,
        );
        // Session B (the race loser, blocked on the tree-root lock) observed
        // session A's (the winner's) already-committed result: the child's
        // path is rooted through team's NEW location under `ops`, never the
        // stale pre-move prefix directly under `root` — proving the two
        // operations serialized instead of racing into an inconsistent tree.
        expect(child.path).toBe(
          `${root.id}/${ops.id}/${team.id}/${project.id}/${childId}`,
        );
        expect(child.parent_id).toBe(project.id);
      });

      it('a partial reparent that leaves descendants stale is rejected at commit (F2 — checks both directions)', async () => {
        const owner = await makeUser('Partial Reparent Owner');
        const root = await identity.createRootOrg({
          userId: owner,
          name: 'PartialRoot',
        });
        rootIds.push(root.id);
        const team = await identity.createChildOrg({
          userId: owner,
          parentId: root.id,
          name: 'Team',
        });
        const project = await identity.createChildOrg({
          userId: owner,
          parentId: team.id,
          name: 'Project',
        });
        const ops = await identity.createChildOrg({
          userId: owner,
          parentId: root.id,
          name: 'Ops',
        });

        // Direct SQL reparents `team` under `ops`, writing a path for `team`
        // that is internally self-consistent with ITS new parent — but
        // never rewrites `project` (team's child), which is left pointing at
        // the stale `root/team/project` prefix. RLS admits this (owner holds
        // owner-tier across the whole path), and the UPWARD check alone
        // (team against its new parent `ops`) would pass, since only `team`
        // was modified and its own row is internally consistent. Only the
        // DOWNWARD check — team's row also validating ITS children —
        // catches that `project` no longer matches team's new path.
        await expect(
          asUser(
            owner,
            (tx) =>
              tx`UPDATE org_units SET parent_id = ${ops.id}, path = ${ops.path} || '/' || ${team.id}
                 WHERE id = ${team.id}`,
          ),
        ).rejects.toMatchObject({ code: '23514' });

        // The whole transaction rolled back — `project` (the descendant that
        // would have been orphaned) never moved, and neither did `team`.
        const [teamAfter, projectAfter] = await Promise.all([
          asUser(
            owner,
            (tx) => tx`SELECT path FROM org_units WHERE id = ${team.id}`,
          ),
          asUser(
            owner,
            (tx) => tx`SELECT path FROM org_units WHERE id = ${project.id}`,
          ),
        ]);
        expect(teamAfter[0].path).toBe(team.path);
        expect(projectAfter[0].path).toBe(project.path);
      });
    });

    describe('D2 — last-owner protection', () => {
      it('the sole owner of a root org cannot revoke their own membership', async () => {
        const owner = await makeUser('Sole Owner (leave)');
        const root = await identity.createRootOrg({
          userId: owner,
          name: 'SoleCo',
        });
        rootIds.push(root.id);

        await expect(
          tenantDb.runAs(owner, (tx) =>
            new MembershipsRepository(tx).revoke(owner, root.id),
          ),
        ).rejects.toMatchObject({
          cause: expect.objectContaining({ code: 'OW001' }),
        });

        const stillThere = await asUser(
          owner,
          (tx) =>
            tx`SELECT role FROM memberships WHERE user_id = ${owner} AND org_unit_id = ${root.id}`,
        );
        expect(stillThere).toEqual([{ role: 'owner' }]);
      });

      it('the sole owner of a root org cannot be demoted', async () => {
        const owner = await makeUser('Sole Owner (demote)');
        const root = await identity.createRootOrg({
          userId: owner,
          name: 'SoleCo2',
        });
        rootIds.push(root.id);

        await expect(
          asUser(
            owner,
            (tx) =>
              tx`UPDATE memberships SET role = 'member' WHERE user_id = ${owner} AND org_unit_id = ${root.id}`,
          ),
        ).rejects.toMatchObject({ code: 'OW001' });
      });

      it('a co-owner may leave a root org that still has another owner', async () => {
        const ownerA = await makeUser('Co-owner A');
        const ownerB = await makeUser('Co-owner B');
        const root = await identity.createRootOrg({
          userId: ownerA,
          name: 'Duo',
        });
        rootIds.push(root.id);

        // Owner-tier grant of `owner` (D3) — ownerA mints ownerB as co-owner.
        await identity.grantMembership({
          callerId: ownerA,
          userId: ownerB,
          orgUnitId: root.id,
          role: 'owner',
        });

        await tenantDb.runAs(ownerA, (tx) =>
          new MembershipsRepository(tx).revoke(ownerA, root.id),
        );

        const remaining = await asUser(
          ownerB,
          (tx) =>
            tx`SELECT user_id, role FROM memberships WHERE org_unit_id = ${root.id}`,
        );
        expect(remaining).toEqual([{ user_id: ownerB, role: 'owner' }]);
      });

      it('demoting a non-last owner (a co-owner remains) succeeds', async () => {
        const ownerA = await makeUser('Demotable Owner A');
        const ownerB = await makeUser('Demotable Owner B');
        const root = await identity.createRootOrg({
          userId: ownerA,
          name: 'Trio',
        });
        rootIds.push(root.id);
        await identity.grantMembership({
          callerId: ownerA,
          userId: ownerB,
          orgUnitId: root.id,
          role: 'owner',
        });

        await asUser(
          ownerA,
          (tx) =>
            tx`UPDATE memberships SET role = 'admin' WHERE user_id = ${ownerA} AND org_unit_id = ${root.id}`,
        );

        const role = await asUser(
          ownerB,
          (tx) =>
            tx`SELECT role FROM memberships WHERE user_id = ${ownerA} AND org_unit_id = ${root.id}`,
        );
        expect(role).toEqual([{ role: 'admin' }]);
      });

      it('deleting a leaf org unit cascades its memberships, even a sole owner’s (unit deletion stays allowed)', async () => {
        const owner = await makeUser('Deleter Owner');
        const root = await identity.createRootOrg({
          userId: owner,
          name: 'ToDelete',
        });

        await asUser(
          owner,
          (tx) => tx`DELETE FROM org_units WHERE id = ${root.id}`,
        );

        const gone = await asUser(
          owner,
          (tx) => tx`SELECT id FROM memberships WHERE org_unit_id = ${root.id}`,
        );
        expect(gone.length).toBe(0);
      });

      it('deleting a user who is the sole owner of a root org is blocked', async () => {
        const owner = await makeUser('Undeletable Owner');
        const root = await identity.createRootOrg({
          userId: owner,
          name: 'BlocksDeletion',
        });
        rootIds.push(root.id);

        // Direct call on the raw postgres.js client (not through Drizzle), so
        // the driver error surfaces as-is — `.code`, not `.cause.code`.
        await expect(
          sql`DELETE FROM users WHERE id = ${owner}`,
        ).rejects.toMatchObject({ code: 'OW001' });

        const stillExists = await sql`SELECT id FROM users WHERE id = ${owner}`;
        expect(stillExists.length).toBe(1);
      });

      it('concurrent departures of both owners cannot orphan the org (F3 — TOCTOU closed by locking inside the trigger)', async () => {
        const ownerA = await makeUser('Concurrent Departure A');
        const ownerB = await makeUser('Concurrent Departure B');
        const root = await identity.createRootOrg({
          userId: ownerA,
          name: 'ConcurrentDepartureRoot',
        });
        rootIds.push(root.id);
        await identity.grantMembership({
          callerId: ownerA,
          userId: ownerB,
          orgUnitId: root.id,
          role: 'owner',
        });

        let resolveALocked: () => void;
        const aLocked = new Promise<void>((resolve) => {
          resolveALocked = resolve;
        });
        let resolveProceed: () => void;
        const proceed = new Promise<void>((resolve) => {
          resolveProceed = resolve;
        });

        // Session A explicitly locks the org unit row FIRST (the same row
        // the last-owner trigger itself locks internally), then pauses —
        // forcing a genuine overlap with session B instead of hoping timing
        // produces one. Without the trigger's own FOR UPDATE (F3), both
        // sessions would count the OTHER's still-uncommitted owner row as
        // "remaining" and both departures would succeed, orphaning the org.
        const leaveAPromise = sql.begin(async (tx: SqlClient) => {
          await tx`SELECT set_config('app.current_user_id', ${ownerA}, true)`;
          await tx`SELECT id FROM org_units WHERE id = ${root.id} FOR UPDATE`;
          resolveALocked();
          await proceed;
          await tx`DELETE FROM memberships WHERE user_id = ${ownerA} AND org_unit_id = ${root.id}`;
        });

        await aLocked;

        let resolveBAttempted: () => void;
        const bAttempted = new Promise<void>((resolve) => {
          resolveBAttempted = resolve;
        });
        const leaveBPromise = sql.begin(async (tx: SqlClient) => {
          await tx`SELECT set_config('app.current_user_id', ${ownerB}, true)`;
          resolveBAttempted();
          // This DELETE's own BEFORE trigger tries to lock the SAME
          // org_units row — blocks until session A commits or rolls back.
          await tx`DELETE FROM memberships WHERE user_id = ${ownerB} AND org_unit_id = ${root.id}`;
        });

        await bAttempted;
        await new Promise((resolve) => setTimeout(resolve, 200));
        resolveProceed!();

        const [aResult, bResult] = await Promise.allSettled([
          leaveAPromise,
          leaveBPromise,
        ]);
        const outcomes = [aResult.status, bResult.status];
        expect(outcomes.filter((s) => s === 'fulfilled')).toHaveLength(1);
        // Both sessions use the raw postgres.js client directly (not
        // Drizzle), so the driver error surfaces as-is — `.code`, not
        // `.cause.code`.
        const rejected = [aResult, bResult].find(
          (r) => r.status === 'rejected',
        ) as PromiseRejectedResult;
        expect(rejected.reason).toMatchObject({ code: 'OW001' });

        const remainingOwners = await asUser(
          ownerA,
          (tx) =>
            tx`SELECT user_id FROM memberships WHERE org_unit_id = ${root.id} AND role = 'owner'`,
        );
        expect(remainingOwners.length).toBe(1);
      });
    });
  },
);
