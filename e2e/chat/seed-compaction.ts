import { execFileSync } from "node:child_process";

/**
 * Direct-DB seed for a compaction row (#57 UI surfacing, browser e2e for the
 * Checkpoint feature). The chat/messages themselves are created through the
 * real app (UI send, like the other chat specs) — only the compaction is
 * seeded directly, since driving a real compaction through
 * COMPACTION_TOKEN_THRESHOLD would be nondeterministic (depends on the mock
 * model's token accounting) where a direct insert is exact and instant.
 *
 * Mirrors e2e/db-server.ts's own `docker exec ... psql` idiom (same
 * container/database defaults) rather than adding a `postgres` client
 * dependency at the repo root purely for one seed call. Connects as the
 * `postgres` superuser, which bypasses the compactions table's FORCE RLS
 * policy — appropriate for test seeding (the actual read path under test is
 * the real, RLS-scoped GET /chats/:id/compaction call the app makes).
 */
export function seedCompaction(
  chatId: string,
  uptoSeq: number,
  summary: string,
): void {
  const container = process.env.E2E_DB_CONTAINER ?? "llame-e2e-postgres";
  const dbPort = process.env.E2E_DB_PORT ?? "55433";
  const postgresUrl =
    process.env.POSTGRES_URL ??
    `postgres://app:app@localhost:${dbPort}/llame_e2e`;
  const databaseName = new URL(postgresUrl).pathname.replace(/^\//, "");

  // Single-quote literals only: chatId is a UUID from the app's own response,
  // uptoSeq is a number, and the summary is test-authored — escape defensively
  // anyway (doubling embedded single quotes is standard SQL literal escaping).
  const escape = (value: string) => value.replace(/'/g, "''");

  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `INSERT INTO compactions (chat_id, upto_seq, summary) VALUES ('${escape(
        chatId,
      )}', ${uptoSeq}, '${escape(summary)}');`,
    ],
    { stdio: "inherit" },
  );
}
