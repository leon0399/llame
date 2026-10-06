import { escapeSqlLiteral, runSeedSql } from "../../support/seed-sql";

import { createCompactionCheckpointPart } from "../../../apps/api/src/chats/context-item-producers";

export type SeedCompactionUsage = {
  inputTokens: number;
  outputTokens: number;
  modelId: string;
};

/**
 * Direct-DB seed for a checkpoint message row (#57 UI surfacing, browser e2e
 * for the checkpoint feature). The chat/messages themselves are created
 * through the real app (UI send, like the other chat specs) — only the
 * deterministic checkpoint is seeded directly, since driving a real
 * compaction through the token threshold would depend on the mock model's
 * accounting.
 *
 * The checkpoint stores the same complete data-context part the API writer
 * persists: the rendered envelope text plus `{ v: 1, summary }` payload.
 * `usage` exercises the real owner DTO's compression-stat rendering.
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

/**
 * The row lands at the chat's NEXT sequence, whatever its boundary: seeded
 * after later turns it sits past rows it does not absorb, the order production
 * publishes it in (after the triggering user row).
 */
export function seedCheckpoint(
  chatId: string,
  absorbedThroughSeq: number,
  summary: string,
  options: SeedCompactionOptions = {},
): void {
  const checkpointId = crypto.randomUUID();
  const part = createCompactionCheckpointPart(summary);
  const partsColumn = `'${escapeSqlLiteral(JSON.stringify([part]))}'::jsonb`;
  const usageColumn = usageColumnSql(options.usage);

  runSeedSql(
    `INSERT INTO messages (id, chat_id, seq, role, absorbed_through_seq, sender_user_id, parts, attachments, usage, in_reply_to) VALUES ('${escapeSqlLiteral(
      checkpointId,
    )}', '${escapeSqlLiteral(
      chatId,
    )}', (SELECT coalesce(max(seq), 0) + 1 FROM messages WHERE chat_id = '${escapeSqlLiteral(
      chatId,
    )}'), 'checkpoint', ${absorbedThroughSeq}, NULL, ${partsColumn}, '[]'::jsonb, ${usageColumn}, NULL);`,
    options.ownerUserId,
  );
}
