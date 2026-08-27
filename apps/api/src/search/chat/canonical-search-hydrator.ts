import { sql } from 'drizzle-orm';

import {
  isImmutableEvidenceMessage,
  visibleMessageText,
} from '../../chats/conversation-evidence';
import { type Db } from '../../db/tenant-db.service';
import { CHUNKER_VERSION } from './conversation-chunker';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Internal candidate from the shared ranked search query. */
export type CanonicalSearchCandidate = {
  chatId: string;
  bestDocumentId: string | null;
};

/**
 * The raw row returned by the one-statement canonical hydration query.
 * Sequence values are cast to text so an unsafe PostgreSQL bigint cannot be
 * rounded before the public-safe-integer check.
 */
export type CanonicalHydrationRow = {
  message_id: string;
  message_chat_id: string;
  message_seq: string;
  message_role: string;
  message_parts: unknown;
  message_usage: unknown;
  message_created_at: Date | string;
  first_message_id: string;
  last_message_id: string;
  first_seq: string;
  last_seq: string;
  first_message_text_offset: number | null;
  last_message_text_offset_exclusive: number | null;
};

export type CanonicalSearchMessage = {
  messageSeq: number;
  role: 'user' | 'assistant';
  timestamp: Date;
  visibleText: string;
  sourceStart: number;
  sourceEndExclusive: number;
};

export type HydratedCanonicalSearchDocument = {
  chatId: string;
  messages: CanonicalSearchMessage[];
};

function parseSafePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseValidOffset(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function parseTimestamp(value: Date | string): Date | null {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sameDocumentBoundary(
  row: CanonicalHydrationRow,
  firstMessageId: string,
  lastMessageId: string,
  firstSeq: string,
  lastSeq: string,
  firstOffset: number,
  lastOffset: number,
): boolean {
  return (
    row.first_message_id === firstMessageId &&
    row.last_message_id === lastMessageId &&
    row.first_seq === firstSeq &&
    row.last_seq === lastSeq &&
    row.first_message_text_offset === firstOffset &&
    row.last_message_text_offset_exclusive === lastOffset
  );
}

function isEligibleVisibleRole(
  row: CanonicalHydrationRow,
): row is CanonicalHydrationRow & { message_role: 'user' | 'assistant' } {
  return (
    (row.message_role === 'user' || row.message_role === 'assistant') &&
    isImmutableEvidenceMessage({
      role: row.message_role,
      usage: row.message_usage,
    })
  );
}

/**
 * Convert one database snapshot's rows into canonical source records.
 * Returning null is intentional: any stale, malformed, or unauthorized
 * projection/source state is a closed internal miss and must never fall back
 * to presentation projection bytes.
 */
export function hydrateCanonicalSearchRows(
  rows: readonly CanonicalHydrationRow[],
  candidate: CanonicalSearchCandidate,
): HydratedCanonicalSearchDocument | null {
  if (candidate.bestDocumentId === null || rows.length === 0) return null;

  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const firstMessageId = firstRow.first_message_id;
  const lastMessageId = firstRow.last_message_id;
  const firstOffset = parseValidOffset(firstRow.first_message_text_offset);
  const lastOffset = parseValidOffset(
    firstRow.last_message_text_offset_exclusive,
  );
  const firstSeq = parseSafePositiveInteger(firstRow.first_seq);
  const lastSeq = parseSafePositiveInteger(firstRow.last_seq);

  if (
    firstOffset === null ||
    lastOffset === null ||
    firstSeq === null ||
    lastSeq === null ||
    firstSeq > lastSeq ||
    firstRow.message_id !== firstMessageId ||
    lastRow.message_id !== lastMessageId ||
    firstRow.message_chat_id !== candidate.chatId ||
    lastRow.message_chat_id !== candidate.chatId ||
    (firstMessageId === lastMessageId && rows.length !== 1) ||
    (firstMessageId !== lastMessageId && rows.length < 2)
  ) {
    return null;
  }

  const messages: CanonicalSearchMessage[] = [];
  let previousSeq = 0;

  for (const [index, row] of rows.entries()) {
    if (
      row.message_chat_id !== candidate.chatId ||
      !sameDocumentBoundary(
        row,
        firstMessageId,
        lastMessageId,
        firstRow.first_seq,
        firstRow.last_seq,
        firstOffset,
        lastOffset,
      ) ||
      !isEligibleVisibleRole(row) ||
      !Array.isArray(row.message_parts)
    ) {
      return null;
    }

    const messageSeq = parseSafePositiveInteger(row.message_seq);
    const timestamp = parseTimestamp(row.message_created_at);
    if (
      messageSeq === null ||
      messageSeq <= previousSeq ||
      messageSeq < firstSeq ||
      messageSeq > lastSeq ||
      timestamp === null
    ) {
      return null;
    }

    const visibleText = visibleMessageText(row.message_parts);
    const sourceStart =
      index === 0 || firstMessageId === lastMessageId ? firstOffset : 0;
    const sourceEndExclusive =
      index === rows.length - 1 || firstMessageId === lastMessageId
        ? lastOffset
        : visibleText.length;

    if (
      sourceStart > visibleText.length ||
      sourceEndExclusive > visibleText.length ||
      (firstMessageId === lastMessageId && sourceStart > sourceEndExclusive)
    ) {
      return null;
    }

    messages.push({
      messageSeq,
      role: row.message_role,
      timestamp,
      visibleText,
      sourceStart,
      sourceEndExclusive,
    });
    previousSeq = messageSeq;
  }

  return { chatId: candidate.chatId, messages };
}

/**
 * Hydrate a winning projection document from a caller-provided owner-scoped
 * transaction. The caller MUST pass the `tx` from `TenantDbService.runAs`;
 * this function intentionally does not open a nested transaction or a public
 * sharing read path.
 */
export async function hydrateCanonicalSearchCandidate(
  tx: Db,
  ownerUserId: string,
  candidate: CanonicalSearchCandidate,
): Promise<HydratedCanonicalSearchDocument | null> {
  if (
    !ownerUserId.trim() ||
    !UUID_PATTERN.test(candidate.chatId) ||
    candidate.bestDocumentId === null ||
    !UUID_PATTERN.test(candidate.bestDocumentId)
  ) {
    return null;
  }

  const rows = await tx.execute<CanonicalHydrationRow>(sql`
    WITH winning_document AS (
      SELECT
        d.first_message_id,
        d.last_message_id,
        d.first_message_text_offset,
        d.last_message_text_offset_exclusive
      FROM search_chat_documents AS d
      INNER JOIN chats AS document_chat
        ON document_chat.id = d.chat_id
       AND document_chat.owner_user_id = ${ownerUserId}
      WHERE d.id = ${candidate.bestDocumentId}
        AND d.chat_id = ${candidate.chatId}
        AND d.owner_user_id = ${ownerUserId}
        AND d.chunker_version = ${CHUNKER_VERSION}
      LIMIT 1
    ), boundaries AS (
      SELECT
        d.first_message_id,
        d.last_message_id,
        d.first_message_text_offset,
        d.last_message_text_offset_exclusive,
        first_message.seq AS first_seq,
        last_message.seq AS last_seq
      FROM winning_document AS d
      INNER JOIN messages AS first_message
        ON first_message.id = d.first_message_id
       AND first_message.chat_id = ${candidate.chatId}
      INNER JOIN messages AS last_message
        ON last_message.id = d.last_message_id
       AND last_message.chat_id = ${candidate.chatId}
      INNER JOIN chats AS first_chat
        ON first_chat.id = first_message.chat_id
       AND first_chat.owner_user_id = ${ownerUserId}
      INNER JOIN chats AS last_chat
        ON last_chat.id = last_message.chat_id
       AND last_chat.owner_user_id = ${ownerUserId}
      WHERE first_message.seq <= last_message.seq
    )
    SELECT
      message.id AS message_id,
      message.chat_id AS message_chat_id,
      message.seq::text AS message_seq,
      message.role AS message_role,
      message.parts AS message_parts,
      message.usage AS message_usage,
      message.created_at AS message_created_at,
      boundaries.first_message_id,
      boundaries.last_message_id,
      boundaries.first_seq::text AS first_seq,
      boundaries.last_seq::text AS last_seq,
      boundaries.first_message_text_offset,
      boundaries.last_message_text_offset_exclusive
    FROM boundaries
    INNER JOIN messages AS message
      ON message.chat_id = ${candidate.chatId}
     AND message.seq >= boundaries.first_seq
     AND message.seq <= boundaries.last_seq
    INNER JOIN chats AS message_chat
      ON message_chat.id = message.chat_id
     AND message_chat.owner_user_id = ${ownerUserId}
    ORDER BY message.seq ASC
  `);

  return hydrateCanonicalSearchRows([...rows], candidate);
}
