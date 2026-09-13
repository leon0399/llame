/**
 * Negative datastore tests for the `message_turn_contexts` table and
 * continuation-state FK constraints on `chats` and `compactions`.
 *
 * Verifies:
 * - FORCE RLS on message_turn_contexts (absent identity reads zero)
 * - Same-Chat message FK rejects cross-Chat messages
 * - Owner-scoped snapshot FK rejects cross-owner snapshots
 * - Same-Chat compaction FKs reject cross-Chat checkpoints
 * - Chats initial-state FKs reject cross-Chat compactions
 * - Compactions companion FKs reject cross-Chat compactions
 *
 * Requires TEST_DATABASE_URL (self-provisioned by the integration project).
 */

import type { Sql, TransactionSql } from 'postgres';
const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

/** Extract `id` from the first RETURNING row; shared across seed helpers (4+ call sites). */
function firstId(rows: ReadonlyArray<{ id?: string }>): string {
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('Expected a RETURNING row with a string id');
  }
  return id;
}
type SqlClient = Sql;

describeIfDb('message_turn_contexts — FK constraints and RLS', () => {
  let sql: SqlClient;
  let ownerA: string;
  let ownerB: string;

  const asUser = <T>(userId: string, fn: (tx: TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  /** Insert a chat owned by `owner` and return its id. */
  const seedChat = (tx: TransactionSql, owner: string) =>
    tx`INSERT INTO chats (owner_user_id) VALUES (${owner}) RETURNING id`.then(
      firstId,
    );

  /** Insert a message in the given chat (4+ call sites). */
  const seedMessage = (
    tx: TransactionSql,
    chatId: string,
    seq: number,
    role: string,
  ) =>
    tx`INSERT INTO messages (chat_id, seq, role, parts)
       VALUES (${chatId}, ${seq}, ${role}, '[]'::jsonb)
       RETURNING id`.then(firstId);

  /** Insert a compaction in the given chat (4+ call sites). */
  const seedCompaction = (tx: TransactionSql, chatId: string, seq: number) =>
    tx`INSERT INTO compactions (chat_id, upto_seq, summary, replacement_history)
       VALUES (${chatId}, ${seq}, 'test', '[]'::jsonb)
       RETURNING id`.then(firstId);

  /** Insert a model_context_snapshot for an owner. */
  const seedSnapshot = (tx: TransactionSql, owner: string) =>
    tx`INSERT INTO model_context_snapshots
         (owner_user_id, content_hash, availability_hash, prompt_hash, tool_hash, source, system_prompt, tool_availability_manifest, tool_declarations)
       VALUES (${owner}, ${crypto.randomUUID()}, 'a', 'p', 't', 'project_default', 'sys', '{}'::jsonb, '[]'::jsonb)
       RETURNING id`.then(firstId);

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 3 });
    ownerA = crypto.randomUUID();
    ownerB = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES
        (${ownerA}, 'Owner A', ${`tc-a-${ownerA}@test.com`}),
        (${ownerB}, 'Owner B', ${`tc-b-${ownerB}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${ownerA}, ${ownerB})`;
      await sql.end();
    }
  });

  it('FORCE RLS is enabled on message_turn_contexts', async () => {
    const [row] = await sql`
        SELECT relrowsecurity, relforcerowsecurity
        FROM pg_class WHERE relname = 'message_turn_contexts'`;
    expect(row.relrowsecurity).toBe(true);
    expect(row.relforcerowsecurity).toBe(true);
  });

  it('absent identity reads zero rows from message_turn_contexts', async () => {
    // Insert a valid row first, then try to read without identity.
    const chatId = await asUser(ownerA, async (tx) => {
      const id = await seedChat(tx, ownerA);
      const msgId = await seedMessage(tx, id, 1, 'user');
      await tx`INSERT INTO message_turn_contexts
          (chat_id, origin_run_id, message_id, owner_user_id, model_id, accepted_at, context_revision, source_max_seq)
          VALUES (${id}, ${crypto.randomUUID()}, ${msgId}, ${ownerA}, 'test-model', now(), 1, 1)`;
      return id;
    });

    // Read without setting identity — RLS should filter it out.
    const rows =
      await sql`SELECT * FROM message_turn_contexts WHERE chat_id = ${chatId}`;
    expect(rows.length).toBe(0);

    // But it's visible with the correct identity.
    const visible = await asUser(
      ownerA,
      (tx) => tx`SELECT * FROM message_turn_contexts WHERE chat_id = ${chatId}`,
    );
    expect(visible.length).toBe(1);

    // Cross-tenant reads zero.
    const cross = await asUser(
      ownerB,
      (tx) => tx`SELECT * FROM message_turn_contexts WHERE chat_id = ${chatId}`,
    );
    expect(cross.length).toBe(0);

    // Cleanup
    await asUser(ownerA, (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`);
  });

  it('rejects a message_turn_contexts row with a message from a different chat', async () => {
    await expect(
      asUser(ownerA, async (tx) => {
        const chatA = await seedChat(tx, ownerA);
        const chatB = await seedChat(tx, ownerA);
        const msgInB = await seedMessage(tx, chatB, 1, 'user');
        // Try to insert a turn context for chatA using a message from chatB.
        await tx`INSERT INTO message_turn_contexts
            (chat_id, origin_run_id, message_id, owner_user_id, model_id, accepted_at, context_revision, source_max_seq)
            VALUES (${chatA}, ${crypto.randomUUID()}, ${msgInB}, ${ownerA}, 'test-model', now(), 1, 1)`;
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('rejects a message_turn_contexts row with a cross-owner snapshot', async () => {
    // Create snapshot owned by B, try to use in a turn context owned by A.
    // Snapshot insert needs to be done under B's identity.
    const snapshotId = await asUser(ownerB, (tx) => seedSnapshot(tx, ownerB));

    await expect(
      asUser(ownerA, async (tx) => {
        const chatA = await seedChat(tx, ownerA);
        const msgA = await seedMessage(tx, chatA, 1, 'user');
        await tx`INSERT INTO message_turn_contexts
            (chat_id, origin_run_id, message_id, owner_user_id, model_id, accepted_at, context_revision, source_max_seq, snapshot_id)
            VALUES (${chatA}, ${crypto.randomUUID()}, ${msgA}, ${ownerA}, 'test-model', now(), 1, 1, ${snapshotId})`;
      }),
    ).rejects.toThrow(/foreign key/i);

    // Cleanup
    await asUser(
      ownerB,
      (tx) => tx`DELETE FROM model_context_snapshots WHERE id = ${snapshotId}`,
    );
  });

  it('rejects a message_turn_contexts compaction FK from a different chat', async () => {
    await expect(
      asUser(ownerA, async (tx) => {
        const chatA = await seedChat(tx, ownerA);
        const chatB = await seedChat(tx, ownerA);
        const msgA = await seedMessage(tx, chatA, 1, 'user');
        const compB = await seedCompaction(tx, chatB, 1);
        // Try to use chatB's compaction as chatA's active compaction.
        await tx`INSERT INTO message_turn_contexts
            (chat_id, origin_run_id, message_id, owner_user_id, model_id, accepted_at, context_revision, source_max_seq, active_compaction_id)
            VALUES (${chatA}, ${crypto.randomUUID()}, ${msgA}, ${ownerA}, 'test-model', now(), 1, 1, ${compB})`;
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('rejects chats initial_active_compaction_id from a different chat', async () => {
    await expect(
      asUser(ownerA, async (tx) => {
        const chatA = await seedChat(tx, ownerA);
        const chatB = await seedChat(tx, ownerA);
        const compB = await seedCompaction(tx, chatB, 1);
        // Try to set chatA's initial active compaction to chatB's checkpoint.
        await tx`UPDATE chats SET initial_active_compaction_id = ${compB}
                   WHERE id = ${chatA}`;
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('rejects compactions companion_active_compaction_id from a different chat', async () => {
    await expect(
      asUser(ownerA, async (tx) => {
        const chatA = await seedChat(tx, ownerA);
        const chatB = await seedChat(tx, ownerA);
        const compA = await seedCompaction(tx, chatA, 1);
        const compB = await seedCompaction(tx, chatB, 1);
        // Try to set compA's companion to chatB's checkpoint.
        await tx`UPDATE compactions
                   SET companion_active_compaction_id = ${compB}
                   WHERE id = ${compA}`;
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('allows same-chat compaction references and rejects standalone checkpoint deletion', async () => {
    // Create a chat with a compaction referenced from initial state.
    const { chatId, compId } = await asUser(ownerA, async (tx) => {
      const chatId = await seedChat(tx, ownerA);
      const compId = await seedCompaction(tx, chatId, 1);
      await tx`UPDATE chats SET initial_active_compaction_id = ${compId}
                 WHERE id = ${chatId}`;
      return { chatId, compId };
    });

    // Standalone checkpoint deletion in a SEPARATE transaction — FK rejects.
    await expect(
      asUser(ownerA, (tx) => tx`DELETE FROM compactions WHERE id = ${compId}`),
    ).rejects.toThrow(/foreign key|violates/i);

    // Deleting the whole chat cascades cleanly (chat row first, then compaction).
    await asUser(ownerA, (tx) => tx`DELETE FROM chats WHERE id = ${chatId}`);
  });
});
