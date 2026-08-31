/**
 * Coverage readout (chat-search-embeddings/operations, layer 7, task 7.5) —
 * per-chat embedded/failed/outstanding counts for `(modelId, inputVersion)`,
 * kept as three distinct numbers so an operator can tell ordinary backfill
 * lag apart from permanent failure (never folded into one ratio).
 *
 * Reads `llame_search_embedding_report`, a same-signature sibling of
 * `llame_search_embedding_coverage` with a widened `HAVING` so a chat with
 * zero outstanding but nonzero failed is still reported — see that
 * function's migration header for why it is a sibling rather than an
 * in-place edit of `coverage`.
 */
import { sql } from 'drizzle-orm';

import type { TenantDbService } from '../../db/tenant-db.service';

export type CoverageRow = {
  chatId: string;
  ownerUserId: string;
  outstanding: number;
  embedded: number;
  failed: number;
};

type ReportRow = {
  chat_id: string;
  owner_user_id: string;
  outstanding_count: number;
  embedded_count: number;
  failed_count: number;
};

export async function getEmbeddingCoverageReport(
  tenantDb: Pick<TenantDbService, 'runAsPublic'>,
  modelId: string,
  inputVersion: number,
  maxRows: number,
): Promise<Array<CoverageRow>> {
  const rows = await tenantDb.runAsPublic((tx) =>
    tx.execute<ReportRow>(sql`
      SELECT chat_id, owner_user_id, outstanding_count, embedded_count, failed_count
      FROM llame_search_embedding_report(${modelId}, ${inputVersion}, ${maxRows})
    `),
  );
  return [...rows].map((row) => ({
    chatId: row.chat_id,
    ownerUserId: row.owner_user_id,
    outstanding: row.outstanding_count,
    embedded: row.embedded_count,
    failed: row.failed_count,
  }));
}
