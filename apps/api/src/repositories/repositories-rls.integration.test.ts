/**
 * Isolation and cascade tests for the repository catalog, at the SQL boundary.
 *
 * The connecting role is the non-superuser, table-owning `app` role the
 * integration global setup provisions, so a green run proves FORCE ROW LEVEL
 * SECURITY constrains even the owner — the worst case for a self-hosted
 * deployment. Requires TEST_DATABASE_URL (the integration project sets it).
 *
 * Covers openspec `repositories` — "Repositories are owner-scoped records with
 * a display name", "Checkouts record one repository on one executor",
 * "Worktree leases are informational ownership receipts", "Repository and
 * checkout deletion cascades records and never files", and "Repository records
 * are isolated per owner": owner isolation for all four tables, the composite
 * owner foreign keys that make a cross-owner parent a `23503` rather than a
 * cross-owner cascade, a nullable branch, a lease with no unique key beyond
 * its primary key, and row-only deletion that removes checkouts and leases but
 * never a directory.
 */

import postgres, { type Sql } from 'postgres';

/* The postgres.js tagged template returns `any` rows; these tests assert on
   the raw SQL boundary on purpose, as `projects-rls.integration.test.ts` does. */
/* eslint-disable @typescript-eslint/no-unsafe-return */

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

// A lease records the HEAD that `git.worktreeAdd` reports, so every seeded
// lease carries one; the column has no default.
const LEASE_BASE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

type SqlClient = Sql;

describeIfDb('RLS integration — repository catalog isolation', () => {
  let sql: SqlClient;
  let userA: string;
  let userB: string;

  const asUser = <T>(userId: string, fn: (tx: SqlClient) => Promise<T>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  async function seedRepository(
    owner: string,
    remote: string | null,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await asUser(
      owner,
      (tx) =>
        tx`INSERT INTO repositories (id, owner_user_id, display_name, canonical_remote)
           VALUES (${id}, ${owner}, 'llame', ${remote})`,
    );
    return id;
  }

  async function seedCheckout(
    owner: string,
    repositoryId: string,
    options: {
      readonly kind?: 'main' | 'worktree';
      readonly parentCheckoutId?: string | null;
      readonly branch?: string | null;
      readonly path?: string;
    } = {},
  ): Promise<string> {
    const id = crypto.randomUUID();
    await asUser(
      owner,
      (tx) =>
        tx`INSERT INTO checkouts (id, owner_user_id, repository_id, executor_id, path, kind, parent_checkout_id, branch, origin)
           VALUES (
             ${id}, ${owner}, ${repositoryId}, 'host',
             ${options.path ?? `/srv/${id}`}, ${options.kind ?? 'main'},
             ${options.parentCheckoutId ?? null}, ${options.branch === undefined ? 'main' : options.branch},
             'registered'
           )`,
    );
    return id;
  }

  beforeAll(async () => {
    // Importing the driver connects nothing; the pool opens here, so a run
    // without TEST_DATABASE_URL never reaches the network.
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = postgres(TEST_DB_URL!, { ssl, max: 2 });

    userA = crypto.randomUUID();
    userB = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userA}, 'Repo A', ${`repo-a-${userA}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userB}, 'Repo B', ${`repo-b-${userB}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${userA}, ${userB})`;
      await sql.end();
    }
  });

  it('the harness is meaningful: every table is ENABLED and FORCED', async () => {
    const [role] =
      await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const rows = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('repositories', 'repository_aliases', 'checkouts', 'worktree_leases')
      ORDER BY relname`;
    expect(rows.map((row) => row.relname)).toEqual([
      'checkouts',
      'repositories',
      'repository_aliases',
      'worktree_leases',
    ]);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('a cross-owner SELECT returns no rows and a cross-owner mutation affects none', async () => {
    const repositoryId = await seedRepository(
      userA,
      `github.com/leon0399/isolated-${crypto.randomUUID()}`,
    );
    const checkoutId = await seedCheckout(userA, repositoryId);

    const seen = await asUser(
      userB,
      (tx) => tx`SELECT id FROM checkouts WHERE id = ${checkoutId}`,
    );
    expect(seen.length).toBe(0);

    const updated = await asUser(
      userB,
      (tx) =>
        tx`UPDATE repositories SET display_name = 'hijacked' WHERE id = ${repositoryId} RETURNING id`,
    );
    expect(updated.length).toBe(0);

    const deleted = await asUser(
      userB,
      (tx) => tx`DELETE FROM checkouts WHERE id = ${checkoutId} RETURNING id`,
    );
    expect(deleted.length).toBe(0);

    const [ownerRow] = await asUser(
      userA,
      (tx) =>
        tx`SELECT display_name FROM repositories WHERE id = ${repositoryId}`,
    );
    expect(ownerRow?.display_name).toBe('llame');
    const [ownerCheckout] = await asUser(
      userA,
      (tx) => tx`SELECT id FROM checkouts WHERE id = ${checkoutId}`,
    );
    expect(ownerCheckout?.id).toBe(checkoutId);
  });

  it("an INSERT naming another owner's owner id fails with 42501", async () => {
    await expect(
      asUser(
        userB,
        (tx) =>
          tx`INSERT INTO repositories (owner_user_id, display_name) VALUES (${userA}, 'forged')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it("a checkout naming another owner's repository fails with 23503", async () => {
    const repositoryId = await seedRepository(
      userA,
      `github.com/leon0399/foreign-repo-${crypto.randomUUID()}`,
    );

    await expect(
      asUser(
        userB,
        (tx) =>
          tx`INSERT INTO checkouts (owner_user_id, repository_id, executor_id, path, kind, origin)
             VALUES (${userB}, ${repositoryId}, 'host', ${`/srv/${crypto.randomUUID()}`}, 'main', 'registered')`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it("an alias declared on another owner's repository fails with 23503", async () => {
    const repositoryId = await seedRepository(
      userA,
      `github.com/leon0399/alias-owner-${crypto.randomUUID()}`,
    );

    await expect(
      asUser(
        userB,
        (tx) =>
          tx`INSERT INTO repository_aliases (owner_user_id, repository_id, canonical_alias)
             VALUES (${userB}, ${repositoryId}, 'github.com/leon0399/renamed')`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it("a worktree naming another owner's parent fails with 23503", async () => {
    const parentId = await seedCheckout(
      userA,
      await seedRepository(
        userA,
        `github.com/leon0399/parent-owner-${crypto.randomUUID()}`,
      ),
    );
    // B's own repository, so only the composite parent key can refuse the row.
    const ownRepository = await seedRepository(
      userB,
      `github.com/leon0399/parent-own-${crypto.randomUUID()}`,
    );

    await expect(
      asUser(
        userB,
        (tx) =>
          tx`INSERT INTO checkouts (owner_user_id, repository_id, executor_id, path, kind, parent_checkout_id, origin)
             VALUES (${userB}, ${ownRepository}, 'host', ${`/srv/${crypto.randomUUID()}`}, 'worktree', ${parentId}, 'registered')`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it("a lease naming another owner's chat fails with 23503", async () => {
    const chatA = crypto.randomUUID();
    await asUser(
      userA,
      (tx) =>
        tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatA}, ${userA}, 'A chat')`,
    );
    const checkoutB = await seedCheckout(
      userB,
      await seedRepository(
        userB,
        `github.com/leon0399/lease-b-${crypto.randomUUID()}`,
      ),
    );

    await expect(
      asUser(
        userB,
        (tx) =>
          tx`INSERT INTO worktree_leases (owner_user_id, chat_id, checkout_id, base_ref, base_commit)
             VALUES (${userB}, ${chatA}, ${checkoutB}, 'main', ${LEASE_BASE_COMMIT})`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts a null branch, and a checkout needs no lease key beyond its primary key', async () => {
    const repositoryId = await seedRepository(
      userA,
      `github.com/leon0399/detached-${crypto.randomUUID()}`,
    );
    const checkoutId = await seedCheckout(userA, repositoryId, {
      kind: 'worktree',
      parentCheckoutId: await seedCheckout(userA, repositoryId),
      branch: null,
    });
    const chatA = crypto.randomUUID();
    await asUser(
      userA,
      (tx) =>
        tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatA}, ${userA}, 'Lease chat')`,
    );

    const leases = await asUser(
      userA,
      (tx) =>
        tx`INSERT INTO worktree_leases (owner_user_id, chat_id, checkout_id, base_ref, base_commit)
           VALUES (${userA}, ${chatA}, ${checkoutId}, 'main', ${LEASE_BASE_COMMIT}),
                  (${userA}, ${chatA}, ${checkoutId}, 'HEAD~1', ${LEASE_BASE_COMMIT})
           RETURNING id`,
    );
    expect(leases.length).toBe(2);

    const [row] = await asUser(
      userA,
      (tx) => tx`SELECT branch FROM checkouts WHERE id = ${checkoutId}`,
    );
    expect(row?.branch).toBeNull();
  });

  it('deleting a repository cascades its checkouts and leases, and directories stay', async () => {
    const repositoryId = await seedRepository(
      userA,
      `github.com/leon0399/cascade-${crypto.randomUUID()}`,
    );
    const mainId = await seedCheckout(userA, repositoryId);
    const worktreeId = await seedCheckout(userA, repositoryId, {
      kind: 'worktree',
      parentCheckoutId: mainId,
      branch: 'feature',
    });
    const chatA = crypto.randomUUID();
    await asUser(
      userA,
      (tx) =>
        tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatA}, ${userA}, 'Cascade chat')`,
    );
    await asUser(
      userA,
      (tx) =>
        tx`INSERT INTO worktree_leases (owner_user_id, chat_id, checkout_id, base_ref, base_commit)
           VALUES (${userA}, ${chatA}, ${worktreeId}, 'main', ${LEASE_BASE_COMMIT})`,
    );

    await asUser(
      userA,
      (tx) => tx`DELETE FROM repositories WHERE id = ${repositoryId}`,
    );

    const checkoutsLeft = await asUser(
      userA,
      (tx) =>
        tx`SELECT id FROM checkouts WHERE id IN (${mainId}, ${worktreeId})`,
    );
    expect(checkoutsLeft.length).toBe(0);
    const leasesLeft = await asUser(
      userA,
      (tx) =>
        tx`SELECT id FROM worktree_leases WHERE checkout_id = ${worktreeId}`,
    );
    expect(leasesLeft.length).toBe(0);

    // The chat keeps its row; only the checkout records are gone.
    const [chat] = await asUser(
      userA,
      (tx) => tx`SELECT id FROM chats WHERE id = ${chatA}`,
    );
    expect(chat?.id).toBe(chatA);
  });

  it('deleting a main checkout cascades its worktree rows', async () => {
    const repositoryId = await seedRepository(
      userA,
      `github.com/leon0399/main-cascade-${crypto.randomUUID()}`,
    );
    const mainId = await seedCheckout(userA, repositoryId);
    const worktreeId = await seedCheckout(userA, repositoryId, {
      kind: 'worktree',
      parentCheckoutId: mainId,
    });

    await asUser(userA, (tx) => tx`DELETE FROM checkouts WHERE id = ${mainId}`);

    const left = await asUser(
      userA,
      (tx) => tx`SELECT id FROM checkouts WHERE id = ${worktreeId}`,
    );
    expect(left.length).toBe(0);
  });

  it('two owners hold the same path on one executor, each seeing only its own', async () => {
    const path = `/srv/shared-${crypto.randomUUID()}`;
    const repositoryA = await seedRepository(
      userA,
      `github.com/leon0399/shared-a-${crypto.randomUUID()}`,
    );
    const repositoryB = await seedRepository(
      userB,
      `github.com/leon0399/shared-b-${crypto.randomUUID()}`,
    );
    const checkoutA = await seedCheckout(userA, repositoryA, { path });
    const checkoutB = await seedCheckout(userB, repositoryB, { path });

    const seenByA = await asUser(
      userA,
      (tx) => tx`SELECT id FROM checkouts WHERE path = ${path}`,
    );
    const seenByB = await asUser(
      userB,
      (tx) => tx`SELECT id FROM checkouts WHERE path = ${path}`,
    );
    expect(seenByA.map((row) => row.id)).toEqual([checkoutA]);
    expect(seenByB.map((row) => row.id)).toEqual([checkoutB]);
  });

  it('an identity-absent context reads no repository row', async () => {
    const repositoryId = await seedRepository(
      userA,
      `github.com/leon0399/anonymous-${crypto.randomUUID()}`,
    );

    const rows = await sql.begin(
      (tx: SqlClient) =>
        tx`SELECT id FROM repositories WHERE id = ${repositoryId}`,
    );
    expect(rows.length).toBe(0);
  });
});
