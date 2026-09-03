/**
 * ProjectsRepository integration tests — the application-layer methods
 * (`listForUser`, `findById`, `create`, `update`, `delete`) against a real
 * Postgres, exercised through the repository itself rather than raw SQL.
 *
 * `projects-repository.test.ts` already proves the SQL SHAPE of
 * `listForUser`'s pinned branches against a mocked driver (no rows, no real
 * ordering/filtering result). `projects-rls.integration.test.ts` already
 * proves the RLS POLICIES directly with raw SQL. Neither exercises
 * `ProjectsRepository`'s own business logic: the owner-scoping filter this
 * file's header calls "defense-in-depth" (the seatbelt, not the airbag), the
 * archive guard's branching in `update`, or `delete`'s boolean-return
 * contract — this file closes that gap.
 *
 * Requires TEST_DATABASE_URL; run by test:integration.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { ConflictException } from '@nestjs/common';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ProjectsRepository } from './projects-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
if (!TEST_DB_URL) {
  throw new Error(
    'projects-repository.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}
type SqlClient = ReturnType<typeof postgres>;

describe('ProjectsRepository (real Postgres)', () => {
  let sqlClient: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let ownerA: string;
  let ownerB: string;

  const asA = <T>(fn: (repo: ProjectsRepository) => Promise<T>) =>
    tenantDb.runAs(ownerA, (tx) => fn(new ProjectsRepository(tx)));
  const asB = <T>(fn: (repo: ProjectsRepository) => Promise<T>) =>
    tenantDb.runAs(ownerB, (tx) => fn(new ProjectsRepository(tx)));

  // Scoped through tenantDb.runAs, not the raw owner connection: pins is
  // under FORCE RLS with an owner-matching WITH CHECK, so an insert with no
  // app.current_user_id set is rejected exactly like a spoofed owner would be.
  async function pin(
    userId: string,
    projectId: string,
    position: number,
  ): Promise<void> {
    await tenantDb.runAs(userId, (tx) =>
      tx.execute(sql`
        INSERT INTO pins (user_id, item_type, item_id, position)
        VALUES (${userId}, 'project', ${projectId}, ${position})
      `),
    );
  }

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;
    sqlClient = postgres(TEST_DB_URL, { ssl, max: 5 });
    db = drizzle(sqlClient, { schema });
    tenantDb = new TenantDbService(db);
    ownerA = crypto.randomUUID();
    ownerB = crypto.randomUUID();
    for (const id of [ownerA, ownerB]) {
      await sqlClient`INSERT INTO users (id, name, email) VALUES (${id}, 'Proj Repo', ${`proj-repo-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id IN (${ownerA}, ${ownerB})`;
      await sqlClient.end();
    }
  });

  describe('create + findById', () => {
    it('creates a project owned by the caller, not archived', async () => {
      const created = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'New project' }),
      );
      try {
        expect(created.ownerUserId).toBe(ownerA);
        expect(created.name).toBe('New project');
        expect(created.archivedAt).toBeNull();

        const found = await asA((repo) => repo.findById(created.id, ownerA));
        expect(found?.id).toBe(created.id);
      } finally {
        await asA((repo) => repo.delete(created.id, ownerA));
      }
    });

    // Mutation this kills: dropping `eq(projects.ownerUserId, ownerUserId)`
    // from findById's WHERE (matching on id alone) — the row would come back
    // for B instead of undefined.
    it("findById returns undefined for another owner's project", async () => {
      const created = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'A-only project' }),
      );
      try {
        const foundByB = await asB((repo) => repo.findById(created.id, ownerB));
        expect(foundByB).toBeUndefined();
      } finally {
        await asA((repo) => repo.delete(created.id, ownerA));
      }
    });

    it('findById returns undefined for a nonexistent id', async () => {
      const found = await asA((repo) =>
        repo.findById(crypto.randomUUID(), ownerA),
      );
      expect(found).toBeUndefined();
    });
  });

  describe('listForUser', () => {
    it("only returns the caller's own projects, ordered by updatedAt desc by default", async () => {
      const p1 = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'A first' }),
      );
      const p2 = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'A second' }),
      );
      const bProject = await asB((repo) =>
        repo.create({ ownerUserId: ownerB, name: 'B project' }),
      );
      try {
        const aList = await asA((repo) => repo.listForUser(ownerA));
        const aIds = aList.map((p) => p.id);
        expect(aIds).toContain(p1.id);
        expect(aIds).toContain(p2.id);
        expect(aIds).not.toContain(bProject.id);
        // Newest-created sorts first (both just inserted, p2 after p1).
        expect(aIds.indexOf(p2.id)).toBeLessThan(aIds.indexOf(p1.id));

        const bList = await asB((repo) => repo.listForUser(ownerB));
        expect(bList.map((p) => p.id)).not.toContain(p1.id);
        expect(bList.map((p) => p.id)).not.toContain(p2.id);
      } finally {
        await asA((repo) => repo.delete(p1.id, ownerA));
        await asA((repo) => repo.delete(p2.id, ownerA));
        await asB((repo) => repo.delete(bProject.id, ownerB));
      }
    });

    it('archived filter: default excludes archived, "only" returns just archived, "with" returns both', async () => {
      const active = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'Active' }),
      );
      const archived = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'To archive' }),
      );
      try {
        await asA((repo) =>
          repo.update(archived.id, ownerA, { archived: true }),
        );

        const defaultList = await asA((repo) => repo.listForUser(ownerA));
        const defaultIds = defaultList.map((p) => p.id);
        expect(defaultIds).toContain(active.id);
        expect(defaultIds).not.toContain(archived.id);

        const onlyArchived = await asA((repo) =>
          repo.listForUser(ownerA, { archived: 'only' }),
        );
        const onlyIds = onlyArchived.map((p) => p.id);
        expect(onlyIds).toContain(archived.id);
        expect(onlyIds).not.toContain(active.id);

        const withArchived = await asA((repo) =>
          repo.listForUser(ownerA, { archived: 'with' }),
        );
        const withIds = withArchived.map((p) => p.id);
        expect(withIds).toContain(active.id);
        expect(withIds).toContain(archived.id);
      } finally {
        await asA((repo) => repo.delete(active.id, ownerA));
        await asA((repo) => repo.delete(archived.id, ownerA));
      }
    });

    // Mutation this kills: flipping `not(exists(pinSubquery))` to
    // `exists(pinSubquery)` (or dropping the `pinned === 'exclude'` branch
    // entirely) — the pinned project would stay in the "exclude" result.
    it('pinned "exclude" omits a pinned project; pinned "only" returns just it, ordered by position', async () => {
      const pinned = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'Pinned' }),
      );
      const unpinned = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'Unpinned' }),
      );
      try {
        await pin(ownerA, pinned.id, 0);

        const excluded = await asA((repo) =>
          repo.listForUser(ownerA, { pinned: 'exclude' }),
        );
        const excludedIds = excluded.map((p) => p.id);
        expect(excludedIds).not.toContain(pinned.id);
        expect(excludedIds).toContain(unpinned.id);

        const onlyPinned = await asA((repo) =>
          repo.listForUser(ownerA, { pinned: 'only' }),
        );
        expect(onlyPinned.map((p) => p.id)).toEqual([pinned.id]);
      } finally {
        await tenantDb.runAs(ownerA, (tx) =>
          tx.execute(
            sql`DELETE FROM pins WHERE user_id = ${ownerA} AND item_id = ${pinned.id}`,
          ),
        );
        await asA((repo) => repo.delete(pinned.id, ownerA));
        await asA((repo) => repo.delete(unpinned.id, ownerA));
      }
    });
  });

  describe('update', () => {
    it('renames a project and bumps updatedAt', async () => {
      const created = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'Original' }),
      );
      try {
        const updated = await asA((repo) =>
          repo.update(created.id, ownerA, { name: 'Renamed' }),
        );
        expect(updated?.name).toBe('Renamed');
        expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
          created.updatedAt.getTime(),
        );
      } finally {
        await asA((repo) => repo.delete(created.id, ownerA));
      }
    });

    it('a no-op patch ({}) returns the current row unchanged', async () => {
      const created = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'Untouched' }),
      );
      try {
        const result = await asA((repo) => repo.update(created.id, ownerA, {}));
        expect(result).toEqual(created);
      } finally {
        await asA((repo) => repo.delete(created.id, ownerA));
      }
    });

    it('archiving then unarchiving (pure unarchive) succeeds without the archive guard rejecting it', async () => {
      const created = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'Archive cycle' }),
      );
      try {
        const archived = await asA((repo) =>
          repo.update(created.id, ownerA, { archived: true }),
        );
        expect(archived?.archivedAt).not.toBeNull();

        const unarchived = await asA((repo) =>
          repo.update(created.id, ownerA, { archived: false }),
        );
        expect(unarchived?.archivedAt).toBeNull();
      } finally {
        await asA((repo) => repo.delete(created.id, ownerA));
      }
    });

    it('re-archiving an already-archived project is an idempotent no-op, not a rejection', async () => {
      const created = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'Re-archive' }),
      );
      try {
        const archived = await asA((repo) =>
          repo.update(created.id, ownerA, { archived: true }),
        );
        const reArchived = await asA((repo) =>
          repo.update(created.id, ownerA, { archived: true }),
        );
        expect(reArchived?.archivedAt).toEqual(archived?.archivedAt);
      } finally {
        await asA((repo) => repo.delete(created.id, ownerA));
      }
    });

    // Mutation this kills: dropping the `isPureUnarchive`/`isPureReArchive`
    // exemptions (always calling assertNotArchived when archivedAt !== null)
    // — the pure-unarchive test above would then throw instead of succeeding.
    it('renaming an archived project is rejected (409) and the name is unchanged', async () => {
      const created = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'Locked' }),
      );
      try {
        await asA((repo) =>
          repo.update(created.id, ownerA, { archived: true }),
        );

        await expect(
          asA((repo) => repo.update(created.id, ownerA, { name: 'Sneaky' })),
        ).rejects.toBeInstanceOf(ConflictException);

        const stillLocked = await asA((repo) =>
          repo.findById(created.id, ownerA),
        );
        expect(stillLocked?.name).toBe('Locked');
      } finally {
        await asA((repo) => repo.delete(created.id, ownerA));
      }
    });

    it("another owner's update affects nothing and returns undefined", async () => {
      const created = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'A owns this' }),
      );
      try {
        const result = await asB((repo) =>
          repo.update(created.id, ownerB, { name: 'Hijacked' }),
        );
        expect(result).toBeUndefined();

        const stillA = await asA((repo) => repo.findById(created.id, ownerA));
        expect(stillA?.name).toBe('A owns this');
      } finally {
        await asA((repo) => repo.delete(created.id, ownerA));
      }
    });

    it('updating a nonexistent project returns undefined', async () => {
      const result = await asA((repo) =>
        repo.update(crypto.randomUUID(), ownerA, { name: 'Ghost' }),
      );
      expect(result).toBeUndefined();
    });
  });

  describe('delete', () => {
    it("deletes the caller's own project and returns true", async () => {
      const created = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'To delete' }),
      );
      const deleted = await asA((repo) => repo.delete(created.id, ownerA));
      expect(deleted).toBe(true);
      const found = await asA((repo) => repo.findById(created.id, ownerA));
      expect(found).toBeUndefined();
    });

    // Mutation this kills: dropping `eq(projects.ownerUserId, ownerUserId)`
    // from delete's WHERE (matching on id alone) — B's delete would report
    // true and the row would actually be gone.
    it("another owner's delete affects nothing, returns false, and the project survives", async () => {
      const created = await asA((repo) =>
        repo.create({ ownerUserId: ownerA, name: 'B cannot delete this' }),
      );
      try {
        const deleted = await asB((repo) => repo.delete(created.id, ownerB));
        expect(deleted).toBe(false);

        const survives = await asA((repo) => repo.findById(created.id, ownerA));
        expect(survives?.id).toBe(created.id);
      } finally {
        await asA((repo) => repo.delete(created.id, ownerA));
      }
    });

    it('deleting a nonexistent project returns false', async () => {
      const deleted = await asA((repo) =>
        repo.delete(crypto.randomUUID(), ownerA),
      );
      expect(deleted).toBe(false);
    });
  });
});
