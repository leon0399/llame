import { escapeSqlLiteral, runSeedSql } from "../../support/seed-sql";

import { renderConversationCheckpoint } from "../../../apps/api/src/chats/context-builder";

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
 * Connection paths (throwaway-DB docker exec vs. POSTGRES_URL as the app
 * role under FORCE RLS, which requires ownerUserId) live in
 * e2e/support/seed-sql.ts; the actual read remains the real, RLS-scoped
 * compaction embed in `GET /chats/:id/messages`.
 */
function usageColumnSql(usage: SeedCompactionUsage | undefined): string {
  if (!usage) return "NULL";
  return `'${escapeSqlLiteral(
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
  )}'::jsonb`;
}

export type SeedCompactionOptions = {
  usage?: SeedCompactionUsage;
  ownerUserId?: string;
};

export function seedCompaction(
  chatId: string,
  uptoSeq: number,
  summary: string,
  options: SeedCompactionOptions = {},
): void {
  const usageColumn = usageColumnSql(options.usage);

  // The compaction writer now requires its already-materialized replacement
  // history. Keep the seed shape minimal: one user record containing the
  // complete stored checkpoint text. The browser assertion exercises the
  // owner-facing summary; this record only makes the row valid for subsequent
  // model-context reads.
  const replacementHistory = JSON.stringify([
    {
      role: "user",
      parts: [
        {
          type: "text",
          text: renderConversationCheckpoint(summary),
        },
      ],
    },
  ]);
  runSeedSql(
    `INSERT INTO compactions (chat_id, upto_seq, summary, replacement_history, usage) VALUES ('${escapeSqlLiteral(
      chatId,
    )}', ${uptoSeq}, '${escapeSqlLiteral(summary)}', '${escapeSqlLiteral(
      replacementHistory,
    )}'::jsonb, ${usageColumn});`,
    options.ownerUserId,
  );
}
