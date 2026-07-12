/**
 * RLS integration tests — projects-foundation tenancy, requires a real
 * PostgreSQL connection.
 *
 * Set TEST_DATABASE_URL to a connection string to run. The connecting role MUST be:
 *   - NOT a superuser and NOT BYPASSRLS (those bypass RLS unconditionally), and
 *   - ideally the OWNER of the projects/chats/messages tables — that is the worst
 *     case for a self-hosted deployment (one Postgres role owns, migrates, AND
 *     serves the app). RLS only constrains a table owner when FORCE ROW LEVEL
 *     SECURITY is set, so a green run as the owner proves FORCE is doing its job.
 *
 * Example (scripts/rls-test.sh provisions exactly this — it picks a free port
 * in 55440–55490 per invocation, or honors RLS_TEST_PORT, and prints it):
 *   TEST_DATABASE_URL="postgres://app:app@localhost:<port>/llame_test" pnpm --filter api test
 *
 * If TEST_DATABASE_URL is not set, all tests in this file are skipped.
 *
 * Acceptance criteria covered (projects-foundation, tasks.md §3.1):
 * - owner-only visibility: a user sees only their own projects
 * - a non-owner cannot mutate (rename/delete) another's project
 * - insert forgery (owner_user_id spoof) is rejected by the implicit WITH CHECK
 * - identity-absent context denies all project reads (fail closed)
 * - RLS ENABLED *and* FORCED on projects (relforcerowsecurity)
 * - chat filing gate (`chats_owner` WITH CHECK, projects-foundation): filing
 *   into an owned project succeeds, filing into another owner's project is
 *   rejected, unfiling (project_id -> NULL) succeeds
 * - filing widens nothing: a filed chat (and its messages) remains invisible
 *   to a non-owner — no new cross-user access path
 * - deleting a project unfiles its chats (ON DELETE SET NULL), never destroys them
 *
 * NOTE: this file uses `any` for the postgres.js client, loaded dynamically so the
 * module does not connect at import time when TEST_DATABASE_URL is absent. Tests
 * operate at the raw-SQL/RLS level (mirroring the first describe block of
 * chats-rls.integration.spec.ts) — there is no separate app-layer describe block
 * here because ProjectsService/ChatsService are thin `TenantDbService.runAs`
 * pass-throughs already exercised by chats-rls.integration.spec.ts and
 * chat-pinning.integration.spec.ts; nothing project-specific happens above the
 * RLS boundary that isn't covered by proving the policies directly.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

describeIfDb('RLS integration — projects tenancy (projects-foundation)', () => {
  let sql: SqlClient;
  let userAId: string;
  let userBId: string;

  /**
   * Run `fn` inside a transaction scoped to `userId` via app.current_user_id.
   * Uses set_config(..., is_local = true) — the parameterizable equivalent of
   * `SET LOCAL` (plain `SET LOCAL x = $1` cannot take a bind parameter). Mirrors
   * chats-rls.integration.spec.ts's asUser exactly.
   */
  const asUser = (userId: string, fn: (tx: SqlClient) => Promise<any>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  beforeAll(async () => {
    // Dynamic import to avoid connecting at module load time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    // Local test databases (docker) have no TLS; only require it if the URL asks.
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    // max: 2 (not 1) so afterAll's raw-sql cleanup never deadlocks against a
    // still-open runAs transaction — see chats-rls.integration.spec.ts.
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });

    // users has no RLS, so the owner can seed it directly (no scope needed).
    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userAId}, 'Project User A', ${`proj-a-${userAId}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userBId}, 'Project User B', ${`proj-b-${userBId}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      // projects/chats cascade from users; deleting the users is enough, but
      // those deletes touch projects/chats under FORCE, so scope via cascade.
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
  });

  it('the harness is meaningful: non-superuser role, RLS ENABLED + FORCED on projects', async () => {
    const [role] =
      await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    // A superuser or BYPASSRLS role would make every assertion below vacuous.
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const [row] = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'projects'`;
    expect(row.relrowsecurity).toBe(true); // ENABLE
    expect(row.relforcerowsecurity).toBe(true); // FORCE — the load-bearing bit
  });

  it('owner-only visibility: A sees only their own projects, B sees none of them', async () => {
    const p1 = crypto.randomUUID();
    const p2 = crypto.randomUUID();
    await asUser(userAId, async (tx) => {
      await tx`INSERT INTO projects (id, owner_user_id, name) VALUES (${p1}, ${userAId}, 'A Project 1')`;
      await tx`INSERT INTO projects (id, owner_user_id, name) VALUES (${p2}, ${userAId}, 'A Project 2')`;
    });
    try {
      const aRows = await asUser(
        userAId,
        (tx) =>
          tx`SELECT id FROM projects WHERE id IN (${p1}, ${p2}) ORDER BY id`,
      );
      expect(aRows.map((r: { id: string }) => r.id).sort()).toEqual(
        [p1, p2].sort(),
      );

      const bRows = await asUser(
        userBId,
        (tx) => tx`SELECT id FROM projects WHERE id IN (${p1}, ${p2})`,
      );
      expect(bRows.length).toBe(0);
    } finally {
      await asUser(
        userAId,
        (tx) => tx`DELETE FROM projects WHERE id IN (${p1}, ${p2})`,
      ).catch(() => {});
    }
  });

  it("non-owner cannot mutate another's project: B's rename and delete affect zero rows; A's own mutations succeed", async () => {
    const projectId = crypto.randomUUID();
    try {
      await asUser(
        userAId,
        (tx) =>
          tx`INSERT INTO projects (id, owner_user_id, name) VALUES (${projectId}, ${userAId}, 'Original name')`,
      );

      // B's rename affects 0 rows — RLS's USING clause filters the target row
      // out of B's UPDATE before it ever matches.
      const bUpdate = await asUser(
        userBId,
        (tx) =>
          tx`UPDATE projects SET name = 'Hijacked' WHERE id = ${projectId} RETURNING id`,
      );
      expect(bUpdate.length).toBe(0);

      // B's delete likewise affects 0 rows.
      const bDelete = await asUser(
        userBId,
        (tx) => tx`DELETE FROM projects WHERE id = ${projectId} RETURNING id`,
      );
      expect(bDelete.length).toBe(0);

      // The project is untouched: still there, still named "Original name".
      const [stillA] = await asUser(
        userAId,
        (tx) => tx`SELECT name FROM projects WHERE id = ${projectId}`,
      );
      expect(stillA?.name).toBe('Original name');

      // A's own rename succeeds.
      const aUpdate = await asUser(
        userAId,
        (tx) =>
          tx`UPDATE projects SET name = 'Renamed by owner' WHERE id = ${projectId} RETURNING name`,
      );
      expect(aUpdate[0]?.name).toBe('Renamed by owner');

      // A's own delete succeeds.
      const aDelete = await asUser(
        userAId,
        (tx) => tx`DELETE FROM projects WHERE id = ${projectId} RETURNING id`,
      );
      expect(aDelete.length).toBe(1);
    } finally {
      // Safety net in case an assertion above threw before A's delete ran.
      await asUser(
        userAId,
        (tx) => tx`DELETE FROM projects WHERE id = ${projectId}`,
      ).catch(() => {});
    }
  });

  it('B cannot forge a project row claiming ownership by A (insert WITH CHECK)', async () => {
    await expect(
      asUser(
        userBId,
        (tx) =>
          tx`INSERT INTO projects (owner_user_id, name) VALUES (${userAId}, 'forged')`,
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    // No row leaked through under A's own read either.
    const rows = await asUser(
      userAId,
      (tx) => tx`SELECT id FROM projects WHERE name = 'forged'`,
    );
    expect(rows.length).toBe(0);
  });

  it('identity-absent context denies all project reads (fail closed)', async () => {
    const projectId = crypto.randomUUID();
    try {
      await asUser(
        userAId,
        (tx) =>
          tx`INSERT INTO projects (id, owner_user_id, name) VALUES (${projectId}, ${userAId}, 'Owned by A')`,
      );

      // No set_config call at all — mirrors identity-rls.integration.spec.ts's
      // "unscoped context sees nothing" case: current_setting(...) is NULL, so
      // `owner_user_id = NULL` never matches under the policy.
      const rows = await sql.begin(
        (tx: SqlClient) => tx`SELECT id FROM projects WHERE id = ${projectId}`,
      );
      expect(rows.length).toBe(0);
    } finally {
      await asUser(
        userAId,
        (tx) => tx`DELETE FROM projects WHERE id = ${projectId}`,
      ).catch(() => {});
    }
  });

  it("filing a chat into the owner's own project succeeds and sets project_id", async () => {
    const projectId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    try {
      await asUser(userAId, async (tx) => {
        await tx`INSERT INTO projects (id, owner_user_id, name) VALUES (${projectId}, ${userAId}, 'Filing target')`;
        await tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatId}, ${userAId}, 'To file')`;
      });

      const updated = await asUser(
        userAId,
        (tx) =>
          tx`UPDATE chats SET project_id = ${projectId} WHERE id = ${chatId} RETURNING project_id`,
      );
      expect(updated[0]?.project_id).toBe(projectId);
    } finally {
      await asUser(
        userAId,
        (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`,
      ).catch(() => {});
      await asUser(
        userAId,
        (tx) => tx`DELETE FROM projects WHERE id = ${projectId}`,
      ).catch(() => {});
    }
  });

  it("filing a chat into another owner's project is rejected (chats_owner WITH CHECK) and leaves the chat unfiled", async () => {
    const projectBId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    try {
      await asUser(
        userBId,
        (tx) =>
          tx`INSERT INTO projects (id, owner_user_id, name) VALUES (${projectBId}, ${userBId}, 'B project')`,
      );
      await asUser(
        userAId,
        (tx) =>
          tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatId}, ${userAId}, 'A chat')`,
      );

      // A owns the chat (USING passes) but the target project belongs to B, so
      // the chats_owner WITH CHECK rejects the new row — fail closed, not a
      // silent no-op.
      await expect(
        asUser(
          userAId,
          (tx) =>
            tx`UPDATE chats SET project_id = ${projectBId} WHERE id = ${chatId}`,
        ),
      ).rejects.toThrow(/row-level security|violates/i);

      // The rejected update did not partially apply: the chat remains unfiled.
      const [row] = await asUser(
        userAId,
        (tx) => tx`SELECT project_id FROM chats WHERE id = ${chatId}`,
      );
      expect(row?.project_id).toBeNull();
    } finally {
      await asUser(
        userAId,
        (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`,
      ).catch(() => {});
      await asUser(
        userBId,
        (tx) => tx`DELETE FROM projects WHERE id = ${projectBId}`,
      ).catch(() => {});
    }
  });

  it('unfiling (setting project_id back to NULL) succeeds', async () => {
    const projectId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    try {
      await asUser(userAId, async (tx) => {
        await tx`INSERT INTO projects (id, owner_user_id, name) VALUES (${projectId}, ${userAId}, 'Unfile target')`;
        await tx`INSERT INTO chats (id, owner_user_id, title, project_id) VALUES (${chatId}, ${userAId}, 'Filed chat', ${projectId})`;
      });

      const updated = await asUser(
        userAId,
        (tx) =>
          tx`UPDATE chats SET project_id = NULL WHERE id = ${chatId} RETURNING project_id`,
      );
      expect(updated[0]?.project_id).toBeNull();
    } finally {
      await asUser(
        userAId,
        (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`,
      ).catch(() => {});
      await asUser(
        userAId,
        (tx) => tx`DELETE FROM projects WHERE id = ${projectId}`,
      ).catch(() => {});
    }
  });

  // Filing must not open a new cross-user access path: grouping a chat under
  // a project is a metadata move, not a sharing primitive (folders-only, no
  // membership/sharing in this change).
  it('filing widens nothing: a non-owner still cannot read the filed chat or its messages', async () => {
    const projectId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    try {
      await asUser(userAId, async (tx) => {
        await tx`INSERT INTO projects (id, owner_user_id, name) VALUES (${projectId}, ${userAId}, 'Widen check')`;
        await tx`INSERT INTO chats (id, owner_user_id, title, project_id) VALUES (${chatId}, ${userAId}, 'Filed + private', ${projectId})`;
        await tx`
          INSERT INTO messages (id, chat_id, role, parts)
          VALUES (${messageId}, ${chatId}, 'assistant', ${JSON.stringify([{ type: 'text', text: 'secret' }])})`;
      });

      const chatRows = await asUser(
        userBId,
        (tx) => tx`SELECT id FROM chats WHERE id = ${chatId}`,
      );
      expect(chatRows.length).toBe(0);

      const messageRows = await asUser(
        userBId,
        (tx) => tx`SELECT id FROM messages WHERE id = ${messageId}`,
      );
      expect(messageRows.length).toBe(0);
    } finally {
      await asUser(
        userAId,
        (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`,
      ).catch(() => {});
      await asUser(
        userAId,
        (tx) => tx`DELETE FROM projects WHERE id = ${projectId}`,
      ).catch(() => {});
    }
  });

  it('deleting a project unfiles its chats (ON DELETE SET NULL) rather than destroying them', async () => {
    const projectId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    try {
      await asUser(userAId, async (tx) => {
        await tx`INSERT INTO projects (id, owner_user_id, name) VALUES (${projectId}, ${userAId}, 'To delete')`;
        await tx`INSERT INTO chats (id, owner_user_id, title, project_id) VALUES (${chatId}, ${userAId}, 'Survivor', ${projectId})`;
      });

      await asUser(
        userAId,
        (tx) => tx`DELETE FROM projects WHERE id = ${projectId}`,
      );

      const [chat] = await asUser(
        userAId,
        (tx) => tx`SELECT id, project_id FROM chats WHERE id = ${chatId}`,
      );
      expect(chat).toBeDefined();
      expect(chat.project_id).toBeNull();
      expect(chat.id).toBe(chatId);
    } finally {
      await asUser(
        userAId,
        (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`,
      ).catch(() => {});
    }
  });
});
