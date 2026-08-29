import { escapeSqlLiteral, runSeedSql } from "../../support/seed-sql";

/**
 * Direct-DB bulk seed of chat messages (#187 windowed-history browser e2e).
 * The chat itself is created through the real app (UI send, like the other
 * chat specs) — only the long history is seeded directly: driving 100+ real
 * turns through the durable-run pipeline would take minutes where a single
 * insert is exact and instant. The seed derives Chat-local sequence values
 * from the existing maximum, so the rows land strictly after the chat's real
 * messages in conversation order.
 *
 * Rows alternate user/assistant with a text part of `seeded turn N`
 * (N = 1..count), so specs can address any turn by its text. The actual
 * read remains the real, RLS-scoped `GET /chats/:id/messages` window walk.
 * Connection paths live in e2e/support/seed-sql.ts.
 */
export function seedMessages(
  chatId: string,
  count: number,
  ownerUserId?: string,
): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`seedMessages count must be a positive integer: ${count}`);
  }

  runSeedSql(
    `WITH chat_sequence AS (
      SELECT COALESCE(MAX(seq), 0) AS last_seq
      FROM messages
      WHERE chat_id = '${escapeSqlLiteral(chatId)}'::uuid
    )
    INSERT INTO messages (chat_id, seq, role, parts)
    SELECT '${escapeSqlLiteral(chatId)}'::uuid,
           chat_sequence.last_seq + n,
           (CASE WHEN n % 2 = 1 THEN 'user' ELSE 'assistant' END)::message_role,
           jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'seeded turn ' || n))
    FROM generate_series(1, ${count}) AS n
    CROSS JOIN chat_sequence;`,
    ownerUserId,
  );
}
