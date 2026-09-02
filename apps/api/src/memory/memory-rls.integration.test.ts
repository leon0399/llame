/**
 * RLS integration tests — owner-scoped memory settings.
 *
 * The integration harness connects as the non-superuser table owner, so these
 * tests prove FORCE closes the owner-bypass hole rather than merely proving
 * policies exist in schema metadata.
 */

import { type Sql } from 'postgres';

export {};

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = Sql;

describeIfDb('RLS integration — memory settings tenancy', () => {
  let sql: SqlClient;
  let userAId: string;
  let userBId: string;

  const asUser = <T>(userId: string, fn: (tx: SqlClient) => Promise<T>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

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
    await sql`INSERT INTO users (id, name, email) VALUES (${userAId}, 'Memory User A', ${`memory-a-${userAId}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userBId}, 'Memory User B', ${`memory-b-${userBId}@test.com`})`;
    await asUser(
      userAId,
      (tx) =>
        tx`INSERT INTO memory_settings (user_id, share_recent_chats) VALUES (${userAId}, true)`,
    );
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
  });

  it('runs as a constrained owner with RLS enabled and forced', async () => {
    const [role] =
      await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const [table] = await sql`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class WHERE relname = 'memory_settings'`;
    expect(table.relrowsecurity).toBe(true);
    expect(table.relforcerowsecurity).toBe(true);
  });

  it('denies cross-tenant reads, including an explicitly targeted read', async () => {
    const rows = await asUser(
      userBId,
      (tx) => tx`SELECT user_id, share_recent_chats FROM memory_settings`,
    );
    expect(rows).toHaveLength(0);

    const targeted = await asUser(
      userBId,
      (tx) =>
        tx`SELECT share_recent_chats FROM memory_settings WHERE user_id = ${userAId}`,
    );
    expect(targeted).toHaveLength(0);
  });

  it('denies the empty public identity any read', async () => {
    const rows = await asPublic(
      (tx) => tx`SELECT user_id, share_recent_chats FROM memory_settings`,
    );
    expect(rows).toHaveLength(0);
  });

  it('denies a cross-tenant update and leaves the target unchanged', async () => {
    const updated = await asUser(
      userBId,
      (tx) =>
        tx`UPDATE memory_settings SET share_recent_chats = false
           WHERE user_id = ${userAId} RETURNING user_id`,
    );
    expect(updated).toHaveLength(0);

    const [row] = await asUser(
      userAId,
      (tx) =>
        tx`SELECT share_recent_chats FROM memory_settings WHERE user_id = ${userAId}`,
    );
    expect(row.share_recent_chats).toBe(true);
  });

  it('serializes a binding share lock ahead of a concurrent disable', async () => {
    let releaseLock!: () => void;
    let reportLocked!: () => void;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const binding = asUser(userAId, async (tx) => {
      await tx`SELECT share_recent_chats FROM memory_settings
               WHERE user_id = ${userAId} FOR SHARE`;
      reportLocked();
      await holdLock;
    });
    await locked;

    const disableWhileLocked = asUser(userAId, async (tx) => {
      await tx`SET LOCAL lock_timeout = '100ms'`;
      return tx`UPDATE memory_settings SET share_recent_chats = false
                WHERE user_id = ${userAId}`;
    });
    await expect(disableWhileLocked).rejects.toMatchObject({ code: '55P03' });

    releaseLock();
    await binding;
    const [row] = await asUser(
      userAId,
      (tx) =>
        tx`SELECT share_recent_chats FROM memory_settings WHERE user_id = ${userAId}`,
    );
    expect(row.share_recent_chats).toBe(true);
  });
});
