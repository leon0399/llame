/**
 * Model-independent projection readiness readout for the canonical conversation
 * locator cutover. Unlike the embedding reports, this operation has no model
 * or provider inputs and returns only bounded aggregate counts.
 */
import { sql, type SQLWrapper } from 'drizzle-orm';

export type ProjectionCoverage = {
  chunkerVersion: number;
  chatCount: number;
  readyChatCount: number;
  staleChatCount: number;
  documentCount: number;
  completeDocumentCount: number;
};

type ProjectionCoverageRow = {
  chunker_version: number;
  chat_count: number;
  ready_chat_count: number;
  stale_chat_count: number;
  document_count: number;
  complete_document_count: number;
};

/** Minimal DB capability required by the operator readout. */
export type ProjectionCoverageQueryRunner = {
  runAsPublic(
    fn: (tx: {
      execute: (query: SQLWrapper) => Promise<Iterable<ProjectionCoverageRow>>;
    }) => Promise<Iterable<ProjectionCoverageRow>>,
  ): Promise<Iterable<ProjectionCoverageRow>>;
};

/**
 * Read current-version locator readiness across every Chat. The SQL function is
 * SECURITY DEFINER and intentionally returns no Chat IDs, owner IDs, or content;
 * the caller gets a single aggregate row suitable for a cutover gate.
 */
export async function getProjectionCoverageReport(
  tenantDb: ProjectionCoverageQueryRunner,
  chunkerVersion: number,
): Promise<ProjectionCoverage> {
  const rows = await tenantDb.runAsPublic((tx) =>
    tx.execute(sql`
      SELECT chunker_version, chat_count, ready_chat_count, stale_chat_count,
             document_count, complete_document_count
      FROM llame_search_projection_coverage(${chunkerVersion})
    `),
  );
  const row = [...rows][0];
  if (!row) {
    throw new Error('projection coverage returned no aggregate row');
  }

  return {
    chunkerVersion: Number(row.chunker_version),
    chatCount: Number(row.chat_count),
    readyChatCount: Number(row.ready_chat_count),
    staleChatCount: Number(row.stale_chat_count),
    documentCount: Number(row.document_count),
    completeDocumentCount: Number(row.complete_document_count),
  };
}
