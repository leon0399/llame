/**
 * RLS integration tests — personalization tenancy (add-user-personalization).
 * Requires a real PostgreSQL connection.
 *
 * Set TEST_DATABASE_URL to run. The connecting role MUST be NOT a superuser and
 * NOT BYPASSRLS, and ideally the OWNER of the tables — the worst case for a
 * self-hosted deployment (one role owns, migrates, AND serves). RLS only
 * constrains a table owner under FORCE ROW LEVEL SECURITY, so a green run as the
 * owner proves FORCE is doing its job. the test:integration globalSetup provisions exactly
 * this. If TEST_DATABASE_URL is not set, all tests here are skipped.
 *
 * Acceptance criteria (personalization spec):
 * - RLS ENABLED *and* FORCED on personalization (relforcerowsecurity)
 * - per-user isolation: A sees only A's profile; B sees none of it
 * - identity-absent context returns nothing (fail closed / runAsPublic) — this
 *   is the public-chat path, which must never reach a chat owner's profile
 * - a cross-tenant UPDATE and DELETE affect no row and change nothing
 * - a user cannot forge a profile row owned by someone else (42501)
 * - a user cannot hand their row to someone else by rewriting user_id
 * - `users` has NO RLS, so the account-field read for prompt context has no
 *   datastore backstop and MUST be filtered on the owner id in the query
 */

/* eslint-disable @typescript-eslint/no-unsafe-return */

import { type Sql } from 'postgres';

// Make this file a module so its top-level `TEST_DB_URL`/`describeIfDb`/
// `SqlClient` are module-scoped, not globals that collide with the sibling
// *-rls.integration.test.ts files (which are scripts using the same names).
export {};

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = Sql;

describeIfDb('RLS integration — personalization tenancy', () => {
  let sql: SqlClient;
  let userAId: string;
  let userBId: string;

  const asUser = <T>(userId: string, fn: (tx: SqlClient) => Promise<T>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  // Identity-absent scope: current_user_id = '' — the no-identity (runAsPublic)
  // path taken when an unauthenticated caller reads a publicly shared chat.
  const asPublic = <T>(fn: (tx: SqlClient) => Promise<T>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', '', true)`;
      return fn(tx);
    });

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });

    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();

    // users has no RLS — seed directly.
    await sql`INSERT INTO users (id, name, email) VALUES (${userAId}, 'Profile User A', ${`profile-a-${userAId}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userBId}, 'Profile User B', ${`profile-b-${userBId}@test.com`})`;

    await asUser(
      userAId,
      (tx) =>
        tx`INSERT INTO personalization (user_id, preferred_name, about, response_preferences)
           VALUES (${userAId}, 'Ana', 'A''s private about text', 'A''s private preferences')`,
    );
  });

  afterAll(async () => {
    if (sql) {
      // personalization cascades from users — deleting the users is enough.
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
  });

  it('the harness is meaningful: non-superuser role, RLS ENABLED + FORCED on personalization', async () => {
    const [role] =
      await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const [row] = await sql`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class WHERE relname = 'personalization'`;
    expect(row.relrowsecurity).toBe(true); // ENABLE
    expect(row.relforcerowsecurity).toBe(true); // FORCE — the load-bearing bit
  });

  it('per-user isolation: A reads their own profile, B reads none of it', async () => {
    const aRows = await asUser(
      userAId,
      (tx) => tx`SELECT preferred_name, about FROM personalization`,
    );
    expect(aRows.length).toBe(1);
    expect(aRows[0].preferred_name).toBe('Ana');

    // B sees nothing at all — not a redacted row, no row.
    const bRows = await asUser(
      userBId,
      (tx) => tx`SELECT user_id, preferred_name, about FROM personalization`,
    );
    expect(bRows.length).toBe(0);

    // And cannot reach it by naming the owner explicitly.
    const bTargeted = await asUser(
      userBId,
      (tx) => tx`SELECT about FROM personalization WHERE user_id = ${userAId}`,
    );
    expect(bTargeted.length).toBe(0);
  });

  it('the public identity reads nothing, so a shared chat never exposes its owner profile', async () => {
    const rows = await asPublic(
      (tx) => tx`SELECT user_id, about FROM personalization`,
    );
    expect(rows.length).toBe(0);
  });

  it('a cross-tenant update changes nothing', async () => {
    const updated = await asUser(
      userBId,
      (tx) =>
        tx`UPDATE personalization SET about = 'overwritten by B'
           WHERE user_id = ${userAId} RETURNING user_id`,
    );
    expect(updated.length).toBe(0);

    const [row] = await asUser(
      userAId,
      (tx) => tx`SELECT about FROM personalization`,
    );
    expect(row.about).toBe("A's private about text");
  });

  it('a cross-tenant delete removes nothing', async () => {
    const deleted = await asUser(
      userBId,
      (tx) =>
        tx`DELETE FROM personalization WHERE user_id = ${userAId} RETURNING user_id`,
    );
    expect(deleted.length).toBe(0);

    const stillThere = await asUser(
      userAId,
      (tx) => tx`SELECT user_id FROM personalization`,
    );
    expect(stillThere.length).toBe(1);
  });

  it('a user cannot forge a profile row owned by someone else', async () => {
    await expect(
      asUser(
        userBId,
        (tx) =>
          tx`INSERT INTO personalization (user_id, about) VALUES (${userAId}, 'forged by B')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('a user cannot hand their own row to another user', async () => {
    await asUser(
      userBId,
      (tx) =>
        tx`INSERT INTO personalization (user_id, preferred_name) VALUES (${userBId}, 'Bee')`,
    );

    // WITH CHECK constrains the RESULT of the update, so rewriting user_id to
    // someone else's id is rejected rather than silently succeeding.
    await expect(
      asUser(
        userBId,
        (tx) =>
          tx`UPDATE personalization SET user_id = ${userAId} WHERE user_id = ${userBId}`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('users has no RLS, so the account read for prompt context needs an explicit owner filter', async () => {
    // This test documents a GAP rather than a guarantee. `user.name`/`user.email`
    // are rendered into prompts, and they come from `users`, which carries no
    // row-level security — an unfiltered read here would happily return every
    // account. The filter in the query is the only thing standing between the
    // two, which is why the spec requires it to be stated where it is written.
    const [table] = await sql`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'users'`;
    expect(table.relrowsecurity).toBe(false);

    const unfiltered = await asUser(
      userBId,
      (tx) => tx`SELECT id FROM users WHERE id IN (${userAId}, ${userBId})`,
    );
    expect(unfiltered.length).toBe(2); // <- no datastore backstop

    // The shape the prompt-context read MUST use.
    const filtered = await asUser(
      userBId,
      (tx) => tx`SELECT id, name, email FROM users WHERE id = ${userBId}`,
    );
    expect(filtered.map((row) => row.id)).toEqual([userBId]);
  });
});
