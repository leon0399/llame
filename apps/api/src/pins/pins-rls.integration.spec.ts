/**
 * RLS integration tests — per-user pins tenancy (rework-item-pinning). Requires
 * a real PostgreSQL connection.
 *
 * Set TEST_DATABASE_URL to run. The connecting role MUST be NOT a superuser and
 * NOT BYPASSRLS, and ideally the OWNER of the tables — the worst case for a
 * self-hosted deployment (one role owns, migrates, AND serves). RLS only
 * constrains a table owner under FORCE ROW LEVEL SECURITY, so a green run as the
 * owner proves FORCE is doing its job. scripts/rls-test.sh provisions exactly
 * this. If TEST_DATABASE_URL is not set, all tests here are skipped.
 *
 * Acceptance criteria (item-pins spec):
 * - RLS ENABLED *and* FORCED on pins (relforcerowsecurity)
 * - per-user isolation: A sees only A's pins; B sees none of them
 * - a non-owner cannot read or remove another user's pin
 * - identity-absent context returns no pins (fail closed / runAsPublic)
 * - write gate: a user may pin only an item they own; pinning another user's
 *   item, or a nonexistent id, is rejected by the WITH CHECK (42501)
 * - a user cannot forge a pin row owned by someone else
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

// Make this file a module so its top-level `TEST_DB_URL`/`describeIfDb`/
// `SqlClient` are module-scoped, not globals that collide with the sibling
// *-rls.integration.spec.ts files (which are scripts using the same names).
export {};

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

describeIfDb('RLS integration — pins tenancy (rework-item-pinning)', () => {
  let sql: SqlClient;
  let userAId: string;
  let userBId: string;
  let chatAId: string; // owned by A
  let chatBId: string; // owned by B
  let projectAId: string; // owned by A

  const asUser = (userId: string, fn: (tx: SqlClient) => Promise<any>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  // Identity-absent scope: current_user_id = '' — the no-identity (runAsPublic)
  // path. Every pins policy compares user_id to '' and matches nothing.
  const asPublic = (fn: (tx: SqlClient) => Promise<any>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', '', true)`;
      return fn(tx);
    });

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });

    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    chatAId = crypto.randomUUID();
    chatBId = crypto.randomUUID();
    projectAId = crypto.randomUUID();

    // users has no RLS — seed directly.
    await sql`INSERT INTO users (id, name, email) VALUES (${userAId}, 'Pin User A', ${`pin-a-${userAId}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userBId}, 'Pin User B', ${`pin-b-${userBId}@test.com`})`;
    // Seed each user's own items under their own scope (chats/projects are FORCE-RLS).
    await asUser(
      userAId,
      (tx) =>
        tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatAId}, ${userAId}, 'A chat')`,
    );
    await asUser(
      userAId,
      (tx) =>
        tx`INSERT INTO projects (id, owner_user_id, name) VALUES (${projectAId}, ${userAId}, 'A project')`,
    );
    await asUser(
      userBId,
      (tx) =>
        tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatBId}, ${userBId}, 'B chat')`,
    );
  });

  afterAll(async () => {
    if (sql) {
      // pins/chats/projects all cascade from users — deleting the users is enough.
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
  });

  it('the harness is meaningful: non-superuser role, RLS ENABLED + FORCED on pins', async () => {
    const [role] =
      await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const [row] = await sql`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class WHERE relname = 'pins'`;
    expect(row.relrowsecurity).toBe(true); // ENABLE
    expect(row.relforcerowsecurity).toBe(true); // FORCE — the load-bearing bit
  });

  it('per-user isolation: A pins their chat and project; A sees both, B sees none', async () => {
    await asUser(userAId, async (tx) => {
      await tx`INSERT INTO pins (user_id, item_type, item_id) VALUES (${userAId}, 'chat', ${chatAId})`;
      await tx`INSERT INTO pins (user_id, item_type, item_id) VALUES (${userAId}, 'project', ${projectAId})`;
    });

    const aRows = await asUser(
      userAId,
      (tx) =>
        tx`SELECT item_type, item_id FROM pins WHERE user_id = ${userAId}`,
    );
    expect(aRows.length).toBe(2);

    // B sees none of A's pins.
    const bRows = await asUser(
      userBId,
      (tx) =>
        tx`SELECT item_id FROM pins WHERE item_id IN (${chatAId}, ${projectAId})`,
    );
    expect(bRows.length).toBe(0);
  });

  it("a non-owner cannot remove another user's pin (RLS DELETE affects 0 rows)", async () => {
    const bDelete = await asUser(
      userBId,
      (tx) => tx`DELETE FROM pins WHERE item_id = ${chatAId} RETURNING item_id`,
    );
    expect(bDelete.length).toBe(0);

    // A's pin is untouched.
    const [stillA] = await asUser(
      userAId,
      (tx) =>
        tx`SELECT item_id FROM pins WHERE user_id = ${userAId} AND item_id = ${chatAId}`,
    );
    expect(stillA?.item_id).toBe(chatAId);
  });

  it('identity-absent context returns no pins (fail closed)', async () => {
    const rows = await asPublic(
      (tx) =>
        tx`SELECT item_id FROM pins WHERE item_id IN (${chatAId}, ${projectAId})`,
    );
    expect(rows.length).toBe(0);
  });

  it("write gate: A cannot pin B's chat (WITH CHECK rejects)", async () => {
    await expect(
      asUser(
        userAId,
        (tx) =>
          tx`INSERT INTO pins (user_id, item_type, item_id) VALUES (${userAId}, 'chat', ${chatBId})`,
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it('write gate: A cannot pin a nonexistent item id (WITH CHECK rejects)', async () => {
    const ghost = crypto.randomUUID();
    await expect(
      asUser(
        userAId,
        (tx) =>
          tx`INSERT INTO pins (user_id, item_type, item_id) VALUES (${userAId}, 'chat', ${ghost})`,
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it('write gate: A CAN pin their own chat, and re-pinning is idempotent (ON CONFLICT DO NOTHING)', async () => {
    const chat2 = crypto.randomUUID();
    await asUser(
      userAId,
      (tx) =>
        tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chat2}, ${userAId}, 'A chat 2')`,
    );

    await asUser(
      userAId,
      (tx) =>
        tx`INSERT INTO pins (user_id, item_type, item_id) VALUES (${userAId}, 'chat', ${chat2}) ON CONFLICT DO NOTHING`,
    );
    // Re-pin: no error, still exactly one row.
    await asUser(
      userAId,
      (tx) =>
        tx`INSERT INTO pins (user_id, item_type, item_id) VALUES (${userAId}, 'chat', ${chat2}) ON CONFLICT DO NOTHING`,
    );
    const rows = await asUser(
      userAId,
      (tx) =>
        tx`SELECT item_id FROM pins WHERE user_id = ${userAId} AND item_id = ${chat2}`,
    );
    expect(rows.length).toBe(1);
  });

  it('B cannot forge a pin row owned by A (insert WITH CHECK)', async () => {
    await expect(
      asUser(
        userBId,
        (tx) =>
          tx`INSERT INTO pins (user_id, item_type, item_id) VALUES (${userAId}, 'chat', ${chatBId})`,
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });
});
