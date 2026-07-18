import { execFileSync } from "node:child_process";

export type SeedCompactionUsage = {
  inputTokens: number;
  outputTokens: number;
  modelId: string;
};

/**
 * Direct-DB seed for a compaction row (#57 UI surfacing, browser e2e for the
 * Checkpoint feature). The chat/messages themselves are created through the
 * real app (UI send, like the other chat specs) — only the compaction is
 * seeded directly, since driving a real compaction through
 * COMPACTION_TOKEN_THRESHOLD would be nondeterministic (depends on the mock
 * model's token accounting) where a direct insert is exact and instant.
 *
 * `usage` (optional) seeds the TurnTelemetry-shaped jsonb column #136's
 * embedded `GET :id/messages` response derives `stats.beforeTokens` /
 * `afterTokens` / `modelId` from — pass it to exercise the design's real
 * compression-stats rendering ("N messages · saved X tokens" /
 * "before → after · model"); omit it to exercise the null-safe fallback
 * (an older/seeded-without-usage compaction shows a relative timestamp
 * instead).
 *
 * The normal throwaway-DB path mirrors e2e/db-server.ts's own
 * `docker exec ... psql` idiom and connects as the `postgres` superuser. When
 * Playwright is pointed at an existing POSTGRES_URL, it instead invokes the
 * local `psql` client as that URL's app role and requires ownerUserId so the
 * insert runs under FORCE RLS. Neither path adds a root-level database client
 * dependency purely for one seed call; the actual read remains the real,
 * RLS-scoped compaction embed in `GET /chats/:id/messages`.
 */
export function seedCompaction(
  chatId: string,
  uptoSeq: number,
  summary: string,
  usage?: SeedCompactionUsage,
  ownerUserId?: string,
): void {
  const container = process.env.E2E_DB_CONTAINER ?? "llame-e2e-postgres";
  const dbPort = process.env.E2E_DB_PORT ?? "55433";
  const postgresUrl =
    process.env.POSTGRES_URL ??
    `postgres://app:app@localhost:${dbPort}/llame_e2e`;
  const databaseName = new URL(postgresUrl).pathname.replace(/^\//, "");

  // Single-quote literals only: chatId is a UUID from the app's own response,
  // uptoSeq is a number, and the summary/usage are test-authored — escape
  // defensively anyway (doubling embedded single quotes is standard SQL
  // literal escaping).
  const escape = (value: string) => value.replace(/'/g, "''");

  const usageColumn = usage
    ? `'${escape(
        JSON.stringify({
          inputTokens: usage.inputTokens,
          cachedInputTokens: 0,
          outputTokens: usage.outputTokens,
          totalTokens: usage.inputTokens + usage.outputTokens,
          modelId: usage.modelId,
          provider: "openai",
          latencyMs: 0,
          finishReason: "stop",
          status: "completed",
          costUsd: null,
        }),
      )}'::jsonb`
    : "NULL";

  const insert = `INSERT INTO compactions (chat_id, upto_seq, summary, usage) VALUES ('${escape(
    chatId,
  )}', ${uptoSeq}, '${escape(summary)}', ${usageColumn});`;

  // A caller-supplied POSTGRES_URL means Playwright is using an already
  // migrated external database instead of the Docker-backed harness. Seed as
  // the real app role under the chat owner's tenant context so FORCE RLS stays
  // engaged; never require superuser access merely to run this browser proof.
  if (process.env.POSTGRES_URL) {
    if (!ownerUserId) {
      throw new Error(
        "seedCompaction requires ownerUserId when POSTGRES_URL is set",
      );
    }
    execFileSync(
      "psql",
      [
        postgresUrl,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `BEGIN; SET LOCAL app.current_user_id = '${escape(ownerUserId)}'; ${insert} COMMIT;`,
      ],
      { stdio: "inherit" },
    );
    return;
  }

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
      insert,
    ],
    { stdio: "inherit" },
  );
}
