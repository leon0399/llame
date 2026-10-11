/**
 * DB-enforced org-tree invariants (org-units change, D1/D2) — requires a real
 * PostgreSQL connection; same harness contract as identity-rls.integration.test.ts.
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
 * - Owner bootstrap (#1258): a root's creator may grant themselves `owner`
 *   only while the root has no memberships; after handing it over and
 *   leaving (as owner or demoted viewer) the self-grant is denied, through
 *   the service and direct SQL, and the freshness helper answers `false`
 *   for any root but the caller's own.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { ForbiddenException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { IdentityService } from './identity.service';
import {
  MembershipsRepository,
  OrgUnitsRepository,
} from './identity-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = Sql;

describeIfDb(
  'Org-tree invariants — DB-enforced path integrity & last-owner protection',
  () => {
    let sql: SqlClient;
    let db: Db;
    let tenantDb: TenantDbService;
    let identity: IdentityService;
    const userIds: Array<string> = [];
    const rootIds: Array<string> = [];

    const asUser = <T>(userId: string, fn: (tx: SqlClient) => Promise<T>) =>
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

    beforeAll(async () => {
      const postgres = await import('postgres');
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
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        if (!rejected) {
          throw new Error('Expected exactly one rejected attempt');
        }
        expect(rejected.reason).toMatchObject({ code: 'OW001' });

        const remainingOwners = await asUser(
          ownerA,
          (tx) =>
            tx`SELECT user_id FROM memberships WHERE org_unit_id = ${root.id} AND role = 'owner'`,
        );
        expect(remainingOwners.length).toBe(1);
      });
    });

    // #1258: `memberships_insert` branch (a) lets a root's creator grant
    // themselves `owner` only while the root is fresh (no membership rows
    // yet). Owner-tier grants are the only other way to mint `owner`, so a
    // creator who handed the org over and left must not be able to reclaim it.
    describe('owner bootstrap — fresh root only', () => {
      const selfGrantOwner = (userId: string, orgUnitId: string) =>
        asUser(
          userId,
          (tx) =>
            tx`INSERT INTO memberships (user_id, org_unit_id, role) VALUES (${userId}, ${orgUnitId}, 'owner')`,
        );

      const rosterOf = (viewer: string, orgUnitId: string) =>
        asUser(
          viewer,
          (tx) =>
            tx`SELECT user_id, role FROM memberships WHERE org_unit_id = ${orgUnitId} ORDER BY user_id`,
        );

      it('a creator who transferred ownership and left cannot re-grant themselves owner, via the service or direct SQL', async () => {
        const creator = await makeUser('Departed Creator');
        const heir = await makeUser('Heir Owner');
        const root = await identity.createRootOrg({
          userId: creator,
          name: 'Handed Over',
        });
        rootIds.push(root.id);
        await identity.grantMembership({
          callerId: creator,
          userId: heir,
          orgUnitId: root.id,
          role: 'owner',
        });
        await tenantDb.runAs(creator, (tx) =>
          new MembershipsRepository(tx).revoke(creator, root.id),
        );

        await expect(
          identity.grantMembership({
            callerId: creator,
            userId: creator,
            orgUnitId: root.id,
            role: 'owner',
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(selfGrantOwner(creator, root.id)).rejects.toMatchObject({
          code: '42501',
        });

        expect(await rosterOf(heir, root.id)).toEqual([
          { user_id: heir, role: 'owner' },
        ]);
      });

      it('a creator demoted to viewer who then left cannot re-grant themselves owner, via the service or direct SQL', async () => {
        const creator = await makeUser('Demoted Creator');
        const heir = await makeUser('Demoting Owner');
        const root = await identity.createRootOrg({
          userId: creator,
          name: 'Demoted',
        });
        rootIds.push(root.id);
        await identity.grantMembership({
          callerId: creator,
          userId: heir,
          orgUnitId: root.id,
          role: 'owner',
        });
        await identity.changeMembershipRole({
          callerId: heir,
          userId: creator,
          orgUnitId: root.id,
          role: 'viewer',
        });
        await tenantDb.runAs(creator, (tx) =>
          new MembershipsRepository(tx).revoke(creator, root.id),
        );

        await expect(
          identity.grantMembership({
            callerId: creator,
            userId: creator,
            orgUnitId: root.id,
            role: 'owner',
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(selfGrantOwner(creator, root.id)).rejects.toMatchObject({
          code: '42501',
        });

        expect(await rosterOf(heir, root.id)).toEqual([
          { user_id: heir, role: 'owner' },
        ]);
      });

      it('the atomic bootstrap still mints the creator as owner, through the service and through direct SQL in one transaction', async () => {
        const creator = await makeUser('Bootstrap Creator');
        const root = await identity.createRootOrg({
          userId: creator,
          name: 'Fresh',
        });
        rootIds.push(root.id);
        expect(await rosterOf(creator, root.id)).toEqual([
          { user_id: creator, role: 'owner' },
        ]);

        const rawRootId = crypto.randomUUID();
        await asUser(creator, async (tx) => {
          await tx`INSERT INTO org_units (id, parent_id, name, path, created_by)
            VALUES (${rawRootId}, NULL, 'Raw Fresh', ${rawRootId}, ${creator})`;
          await tx`INSERT INTO memberships (user_id, org_unit_id, role) VALUES (${creator}, ${rawRootId}, 'owner')`;
        });
        rootIds.push(rawRootId);
        expect(await rosterOf(creator, rawRootId)).toEqual([
          { user_id: creator, role: 'owner' },
        ]);
      });

      it('the freshness helper answers only for the caller’s own root, and only the creator can bootstrap it', async () => {
        const creator = await makeUser('Probed Creator');
        const stranger = await makeUser('Prober');
        const rootId = crypto.randomUUID();
        // A root with no membership rows yet: the bootstrap window is open.
        await asUser(
          creator,
          (tx) =>
            tx`INSERT INTO org_units (id, parent_id, name, path, created_by)
             VALUES (${rootId}, NULL, 'Unclaimed', ${rootId}, ${creator})`,
        );
        rootIds.push(rootId);

        const isFresh = (userId: string | null, unitId: string) =>
          sql.begin(async (tx: SqlClient) => {
            if (userId !== null) {
              await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
            }
            const [row] = await tx<
              Array<{ fresh: boolean }>
            >`SELECT llame_org_unit_is_fresh_root(${unitId}::uuid) AS fresh`;
            return row?.fresh;
          });

        // Someone else's fresh root, an unknown id, and no identity all read
        // the same `false` as a claimed root, so the helper cannot probe
        // whether another user's root exists or has members.
        expect(await isFresh(stranger, rootId)).toBe(false);
        expect(await isFresh(stranger, crypto.randomUUID())).toBe(false);
        expect(await isFresh(null, rootId)).toBe(false);
        await expect(selfGrantOwner(stranger, rootId)).rejects.toMatchObject({
          code: '42501',
        });

        expect(await isFresh(creator, rootId)).toBe(true);
        await selfGrantOwner(creator, rootId);
        expect(await isFresh(creator, rootId)).toBe(false);
        expect(await rosterOf(creator, rootId)).toEqual([
          { user_id: creator, role: 'owner' },
        ]);
      });

      it('the freshness helper is a pinned SECURITY DEFINER owned by a BYPASSRLS role, executable by app but not PUBLIC', async () => {
        const [fn] = await sql`
          SELECT p.prosecdef AS definer,
                 p.proconfig AS config,
                 r.rolbypassrls AS owner_bypasses_rls,
                 has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
                 has_function_privilege('app', p.oid, 'EXECUTE') AS app_execute
          FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
          WHERE p.proname = 'llame_org_unit_is_fresh_root'`;
        expect(fn).toMatchObject({
          definer: true,
          config: ['search_path=public'],
          owner_bypasses_rls: true,
          public_execute: false,
          app_execute: true,
        });
      });
    });

    // #1260: org-unit writes must not let an admin take a subtree out of its
    // owners' control or leave a root without an owner, via direct SQL too.
    describe('#1260 — moves out of a tree, created_by, and owner-row re-targeting', () => {
      /** The two statements of `OrgUnitsRepository.moveToRoot`, as raw SQL. */
      async function promoteIn(
        tx: SqlClient,
        unit: { id: string; path: string },
      ): Promise<void> {
        await tx`UPDATE org_units
          SET path = ${unit.id} || substr(path, ${unit.path.length + 1}::int)
          WHERE path = ${unit.path} OR path LIKE ${`${unit.path}/%`}`;
        await tx`UPDATE org_units SET parent_id = NULL WHERE id = ${unit.id}`;
      }

      const placeOf = (viewer: string, unitId: string) =>
        asUser(
          viewer,
          (tx) =>
            tx`SELECT parent_id, path, created_by FROM org_units WHERE id = ${unitId}`,
        );

      it('F1: an admin cannot forge created_by, promote their child to root, or then mint owner on it', async () => {
        const alice = await makeUser('F1 Sole Owner');
        const bob = await makeUser('F1 Admin');
        const root = await identity.createRootOrg({ userId: alice, name: 'R' });
        rootIds.push(root.id);
        await identity.grantMembership({
          callerId: alice,
          userId: bob,
          orgUnitId: root.id,
          role: 'admin',
        });
        const child = await identity.createChildOrg({
          userId: bob,
          parentId: root.id,
          name: 'C',
        });
        await identity.grantMembership({
          callerId: bob,
          userId: bob,
          orgUnitId: child.id,
          role: 'admin',
        });

        // created_by is immutable: admin tier passes the update policy on
        // Alice's root, but claiming or clearing its creator is refused.
        for (const forged of [bob, null]) {
          await expect(
            asUser(
              bob,
              (tx) =>
                tx`UPDATE org_units SET created_by = ${forged} WHERE id = ${root.id}`,
            ),
          ).rejects.toMatchObject({ code: '42501' });
        }

        // Moving C out of Alice's tree needs owner tier on its source path.
        await expect(
          asUser(bob, (tx) => promoteIn(tx, child)),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          tenantDb.runAs(bob, async (tx) => {
            const repo = new OrgUnitsRepository(tx);
            return repo.moveToRoot({ id: child.id });
          }),
        ).rejects.toMatchObject({
          cause: expect.objectContaining({ code: '42501' }),
        });

        // The rest of the chain: Bob leaves C and tries the creator's
        // self-grant. C is still a child, so it is not a fresh root.
        await asUser(
          bob,
          (tx) =>
            tx`DELETE FROM memberships WHERE user_id = ${bob} AND org_unit_id = ${child.id}`,
        );
        await expect(
          asUser(
            bob,
            (tx) =>
              tx`INSERT INTO memberships (user_id, org_unit_id, role) VALUES (${bob}, ${child.id}, 'owner')`,
          ),
        ).rejects.toMatchObject({ code: '42501' });

        expect(await placeOf(alice, child.id)).toEqual([
          { parent_id: root.id, path: child.path, created_by: bob },
        ]);
        expect(await placeOf(alice, root.id)).toEqual([
          { parent_id: null, path: root.id, created_by: alice },
        ]);
      });

      it('F1: even an owner cannot promote a unit to root unless the new root ends with an owner', async () => {
        const alice = await makeUser('F1 Promoting Owner');
        const root = await identity.createRootOrg({ userId: alice, name: 'R' });
        rootIds.push(root.id);
        const child = await identity.createChildOrg({
          userId: alice,
          parentId: root.id,
          name: 'C',
        });
        await identity.grantMembership({
          callerId: alice,
          userId: alice,
          orgUnitId: child.id,
          role: 'admin',
        });

        await expect(
          asUser(alice, (tx) => promoteIn(tx, child)),
        ).rejects.toMatchObject({ code: 'OW001' });
        expect(await placeOf(alice, child.id)).toEqual([
          { parent_id: root.id, path: child.path, created_by: alice },
        ]);

        // Granting owner on the unit in the same transaction satisfies the
        // commit-time check.
        await asUser(alice, async (tx) => {
          await tx`UPDATE memberships SET role = 'owner' WHERE user_id = ${alice} AND org_unit_id = ${child.id}`;
          await promoteIn(tx, child);
        });
        rootIds.push(child.id);
        expect(await placeOf(alice, child.id)).toEqual([
          { parent_id: null, path: child.id, created_by: alice },
        ]);
      });

      it('F1: a promotion racing the revoke of the unit’s only owner cannot commit an ownerless root', async () => {
        const alice = await makeUser('F1 Racing Owner');
        const root = await identity.createRootOrg({ userId: alice, name: 'R' });
        rootIds.push(root.id);
        const child = await identity.createChildOrg({
          userId: alice,
          parentId: root.id,
          name: 'C',
        });
        await identity.grantMembership({
          callerId: alice,
          userId: alice,
          orgUnitId: child.id,
          role: 'owner',
        });

        // Session B revokes C's only owner row while C is still a child, so
        // the last-owner guard allows it, and holds the unit's advisory lock.
        // Executor form: the API's TypeScript lib predates
        // `Promise.withResolvers`.
        let resolveRevoked: () => void;
        const revoked = new Promise<void>((resolve) => {
          resolveRevoked = resolve;
        });
        let resolveCommitB: () => void;
        const commitB = new Promise<void>((resolve) => {
          resolveCommitB = resolve;
        });
        const revoke = sql.begin(async (tx: SqlClient) => {
          await tx`SELECT set_config('app.current_user_id', ${alice}, true)`;
          await tx`DELETE FROM memberships WHERE user_id = ${alice} AND org_unit_id = ${child.id}`;
          resolveRevoked();
          await commitB;
        });
        await revoked;

        // Session A promotes C. Its snapshot still sees B's uncommitted
        // owner row; the commit-time check must wait for B and re-read.
        // B commits only once A is queued on the advisory lock for C (the
        // bigint key splits into classid/objid; other suites' locks differ).
        const promote = asUser(alice, (tx) => promoteIn(tx, child));
        let waiting = 0;
        for (let poll = 0; waiting === 0 && poll < 1000; poll++) {
          const [row] = await sql<Array<{ waiting: number }>>`
            SELECT count(*)::int AS waiting FROM pg_locks
            WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
              AND ((classid::bigint << 32) | objid::bigint)
                = hashtextextended(${child.id}, 0)`;
          waiting = row?.waiting ?? 0;
        }
        expect(waiting).toBe(1);
        resolveCommitB!();

        await revoke;
        await expect(promote).rejects.toMatchObject({ code: 'OW001' });
        expect(await placeOf(alice, child.id)).toEqual([
          { parent_id: root.id, path: child.path, created_by: alice },
        ]);
      });

      it('F2: an admin cannot move a unit into another tree; an owner of the source tree can', async () => {
        const owner = await makeUser('F2 Source Owner');
        const subOwner = await makeUser('F2 Unit Owner');
        const admin = await makeUser('F2 Admin');
        const rootA = await identity.createRootOrg({
          userId: owner,
          name: 'A',
        });
        rootIds.push(rootA.id);
        const y = await identity.createChildOrg({
          userId: owner,
          parentId: rootA.id,
          name: 'Y',
        });
        await identity.grantMembership({
          callerId: owner,
          userId: subOwner,
          orgUnitId: y.id,
          role: 'owner',
        });
        await identity.grantMembership({
          callerId: owner,
          userId: admin,
          orgUnitId: rootA.id,
          role: 'admin',
        });
        const rootB = await identity.createRootOrg({
          userId: admin,
          name: 'B',
        });
        rootIds.push(rootB.id);

        const moveUnder = (
          userId: string,
          newParent: { id: string; path: string },
        ) =>
          asUser(userId, async (tx) => {
            await tx`UPDATE org_units
              SET path = ${`${newParent.path}/${y.id}`} || substr(path, ${y.path.length + 1}::int)
              WHERE path = ${y.path} OR path LIKE ${`${y.path}/%`}`;
            await tx`UPDATE org_units SET parent_id = ${newParent.id} WHERE id = ${y.id}`;
          });

        await expect(moveUnder(admin, rootB)).rejects.toMatchObject({
          code: '42501',
        });
        expect(await placeOf(owner, y.id)).toEqual([
          { parent_id: rootA.id, path: y.path, created_by: owner },
        ]);

        await identity.grantMembership({
          callerId: admin,
          userId: owner,
          orgUnitId: rootB.id,
          role: 'admin',
        });
        await moveUnder(owner, rootB);
        expect(await placeOf(owner, y.id)).toEqual([
          {
            parent_id: rootB.id,
            path: `${rootB.id}/${y.id}`,
            created_by: owner,
          },
        ]);
      });

      it('F3: the sole owner of a root cannot re-target their owner row to a child or into another tree', async () => {
        const owner = await makeUser('F3 Sole Owner');
        const root = await identity.createRootOrg({ userId: owner, name: 'R' });
        rootIds.push(root.id);
        const child = await identity.createChildOrg({
          userId: owner,
          parentId: root.id,
          name: 'C',
        });
        const other = await identity.createRootOrg({
          userId: owner,
          name: 'S',
        });
        rootIds.push(other.id);
        const otherChild = await identity.createChildOrg({
          userId: owner,
          parentId: other.id,
          name: 'S child',
        });

        // Same-tree and cross-tree targets: both leave R without an owner.
        for (const target of [child.id, otherChild.id]) {
          await expect(
            asUser(
              owner,
              (tx) =>
                tx`UPDATE memberships SET org_unit_id = ${target} WHERE user_id = ${owner} AND org_unit_id = ${root.id}`,
            ),
          ).rejects.toMatchObject({ code: 'OW001' });
        }
        const owners = await asUser(
          owner,
          (tx) =>
            tx`SELECT user_id FROM memberships WHERE org_unit_id = ${root.id} AND role = 'owner'`,
        );
        expect(owners).toEqual([{ user_id: owner }]);
      });

      it('deleting a user who created a unit still anonymizes created_by to NULL', async () => {
        const owner = await makeUser('Anonymizing Owner');
        const creator = await makeUser('Departing Creator');
        const root = await identity.createRootOrg({ userId: owner, name: 'R' });
        rootIds.push(root.id);
        await identity.grantMembership({
          callerId: owner,
          userId: creator,
          orgUnitId: root.id,
          role: 'admin',
        });
        const child = await identity.createChildOrg({
          userId: creator,
          parentId: root.id,
          name: 'Made by the departing user',
        });

        await sql`DELETE FROM users WHERE id = ${creator}`;

        expect(await placeOf(owner, child.id)).toEqual([
          { parent_id: root.id, path: child.path, created_by: null },
        ]);
      });
    });
  },
);
