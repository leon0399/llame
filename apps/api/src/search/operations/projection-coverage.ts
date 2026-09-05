/**
 * Model-independent projection readiness readout for the canonical conversation
 * locator cutover. Unlike the embedding reports, this operation has no model
 * or provider inputs and returns only bounded aggregate counts.
 */
import { sql, type SQLWrapper } from 'drizzle-orm';

import { isNumber, isRecord, type UnknownRecord } from '@workspace/runtime-safety';

export type ProjectionCoverage = {
  chunkerVersion: number;
  chatCount: number;
  readyChatCount: number;
  staleChatCount: number;
  documentCount: number;
  completeDocumentCount: number;
};

const PROJECTION_COVERAGE_FIELDS = [
  'chunker_version',
  'chat_count',
  'ready_chat_count',
  'stale_chat_count',
  'document_count',
  'complete_document_count',
] as const;

/** Minimal DB capability required by the operator readout. */
export type ProjectionCoverageQueryRunner = {
  runAsPublic(
    fn: (tx: {
      execute: (query: SQLWrapper) => Promise<Iterable<unknown>>;
    }) => Promise<Iterable<unknown>>,
  ): Promise<Iterable<unknown>>;
};

function readCount(row: UnknownRecord, field: string): number {
  const value = row[field];
  if (
    !isNumber(value) ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(
      `projection coverage field '${field}' must be a finite non-negative safe integer`,
    );
  }
  return value;
}

function readProjectionCoverageRow(
  row: unknown,
  requestedChunkerVersion: number,
): ProjectionCoverage {
  if (!isRecord(row)) {
    throw new Error('projection coverage returned a non-object aggregate row');
  }

  const expectedFields = [...PROJECTION_COVERAGE_FIELDS].sort();
  const actualFields = Object.keys(row).sort();
  if (
    actualFields.length !== expectedFields.length ||
    actualFields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new Error(
      `projection coverage returned unexpected fields; expected exactly ${expectedFields.join(', ')}`,
    );
  }

  const chunkerVersion = readCount(row, 'chunker_version');
  if (chunkerVersion === 0) {
    throw new Error('projection coverage chunker_version must be positive');
  }
  if (chunkerVersion !== requestedChunkerVersion) {
    throw new Error(
      `projection coverage chunker_version ${chunkerVersion} does not match requested ${requestedChunkerVersion}`,
    );
  }

  return {
    chunkerVersion,
    chatCount: readCount(row, 'chat_count'),
    readyChatCount: readCount(row, 'ready_chat_count'),
    staleChatCount: readCount(row, 'stale_chat_count'),
    documentCount: readCount(row, 'document_count'),
    completeDocumentCount: readCount(row, 'complete_document_count'),
  };
}

/**
 * Read current-version locator readiness across every Chat. The SQL function is
 * SECURITY DEFINER and intentionally returns no Chat IDs, owner IDs, or content;
 * the caller gets a single aggregate row suitable for a cutover gate.
 */
export async function getProjectionCoverageReport(
  tenantDb: ProjectionCoverageQueryRunner,
  chunkerVersion: number,
): Promise<ProjectionCoverage> {
  if (
    !Number.isFinite(chunkerVersion) ||
    !Number.isSafeInteger(chunkerVersion) ||
    chunkerVersion <= 0
  ) {
    throw new Error(
      'projection coverage requested chunker version must be a positive safe integer',
    );
  }

  const rows = await tenantDb.runAsPublic((tx) =>
    tx.execute(sql`
      SELECT chunker_version, chat_count, ready_chat_count, stale_chat_count,
             document_count, complete_document_count
      FROM llame_search_projection_coverage_v2(${chunkerVersion})
    `),
  );
  const result = [...rows];
  if (result.length === 0) {
    throw new Error('projection coverage returned no aggregate row');
  }
  if (result.length !== 1) {
    throw new Error(
      `projection coverage expected exactly one aggregate row, received ${result.length}`,
    );
  }
  return readProjectionCoverageRow(result[0], chunkerVersion);
}
