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
  messages: Array<CanonicalSearchMessage>;
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

/** The boundary row's text-offset span, each end independently validated. */
function resolveOffsetSpan(row: CanonicalHydrationRow) {
  return {
    firstOffset: parseValidOffset(row.first_message_text_offset),
    lastOffset: parseValidOffset(row.last_message_text_offset_exclusive),
  };
}

/** The winning projection document's identity, as recorded on every row. */
type DocumentBoundary = {
  firstMessageId: string;
  lastMessageId: string;
  firstProjectionSeq: string;
  lastProjectionSeq: string;
  firstOffset: number;
  lastOffset: number;
};

/** The document's message sequence span, parsed to safe integers. */
type MessageSeqRange = {
  firstSeq: number;
  lastSeq: number;
};

function sameDocumentBoundary(
  row: CanonicalHydrationRow,
  boundary: DocumentBoundary,
): boolean {
  return (
    row.first_message_id === boundary.firstMessageId &&
    row.last_message_id === boundary.lastMessageId &&
    row.first_seq === boundary.firstProjectionSeq &&
    row.last_seq === boundary.lastProjectionSeq &&
    row.first_message_text_offset === boundary.firstOffset &&
    row.last_message_text_offset_exclusive === boundary.lastOffset
  );
}

type DecodedCanonicalMessage = {
  messageSeq: number;
  kind: 'source' | 'presentation' | 'invalid';
  role: 'user' | 'assistant' | null;
  timestamp: Date | null;
  visibleText: string | null;
};

/** A row that carries no source text — presentation-only or malformed. */
function nonSourceMessage(
  messageSeq: number,
  kind: 'presentation' | 'invalid',
): DecodedCanonicalMessage {
  return { messageSeq, kind, role: null, timestamp: null, visibleText: null };
}

/** Decode and validate one canonical source row before range mapping. */
function decodeCanonicalMessage(
  row: CanonicalHydrationRow,
  candidate: CanonicalSearchCandidate,
  boundary: DocumentBoundary,
  range: MessageSeqRange,
): DecodedCanonicalMessage | null {
  if (
    row.message_chat_id !== candidate.chatId ||
    !sameDocumentBoundary(row, boundary)
  ) {
    return null;
  }

  const messageSeq = parseSafePositiveInteger(row.message_seq);
  const { firstSeq, lastSeq } = range;
  if (messageSeq === null || messageSeq < firstSeq || messageSeq > lastSeq) {
    return null;
  }

  if (row.message_role === 'system' || row.message_role === 'tool') {
    return nonSourceMessage(messageSeq, 'presentation');
  }

  if (
    (row.message_role !== 'user' && row.message_role !== 'assistant') ||
    !isImmutableEvidenceMessage({
      role: row.message_role,
      usage: row.message_usage,
    }) ||
    !Array.isArray(row.message_parts)
  ) {
    return nonSourceMessage(messageSeq, 'invalid');
  }

  const timestamp = parseTimestamp(row.message_created_at);
  return {
    messageSeq,
    kind: 'source',
    role: row.message_role,
    timestamp,
    visibleText: visibleMessageText(row.message_parts),
  };
}

type RowPosition = { isFirst: boolean; isLast: boolean };
type SourceRange = { start: number; end: number };

function hasValidSourceRange(
  position: RowPosition,
  sameMessage: boolean,
  textLength: number,
  range: SourceRange,
): boolean {
  return (
    range.start <= textLength &&
    range.end <= textLength &&
    (!position.isFirst || range.start < textLength) &&
    (!position.isLast || range.end > 0) &&
    (!sameMessage || range.start < range.end)
  );
}

/**
 * Resolve and validate the winning projection document's boundary and message
 * sequence span from the query's boundary-carrying rows. Every row repeats
 * the same boundary columns; the first row is authoritative.
 */
function resolveDocumentBoundary(
  rows: ReadonlyArray<CanonicalHydrationRow>,
  candidate: CanonicalSearchCandidate,
): { boundary: DocumentBoundary; range: MessageSeqRange } | null {
  const [firstRow] = rows;
  const lastRow = rows.at(-1);
  if (firstRow === undefined || lastRow === undefined) return null;
  const firstMessageId = firstRow.first_message_id;
  const lastMessageId = firstRow.last_message_id;
  const { firstOffset, lastOffset } = resolveOffsetSpan(firstRow);
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

  return {
    boundary: {
      firstMessageId,
      lastMessageId,
      firstProjectionSeq: firstRow.first_seq,
      lastProjectionSeq: firstRow.last_seq,
      firstOffset,
      lastOffset,
    },
    range: { firstSeq, lastSeq },
  };
}

/**
 * What one already-decoded row contributes to the hydrated document: a
 * source message, nothing (a skippable presentation/empty row in the
 * interior), or a fatal stop — any stale, malformed, or unauthorized
 * projection/source state is a closed internal miss and must never fall back
 * to presentation projection bytes.
 */
type RowOutcome =
  | { kind: 'message'; message: CanonicalSearchMessage }
  | { kind: 'skip' }
  | { kind: 'stop' };

/** The candidate source range for one row: the boundary offset at either end
 * of the message span, the full text otherwise. */
function sourceOffsets(
  position: RowPosition,
  sameMessage: boolean,
  boundary: DocumentBoundary,
  textLength: number,
): SourceRange {
  return {
    start: position.isFirst || sameMessage ? boundary.firstOffset : 0,
    end: position.isLast || sameMessage ? boundary.lastOffset : textLength,
  };
}

function resolveRowOutcome(
  decoded: DecodedCanonicalMessage,
  position: RowPosition,
  boundary: DocumentBoundary,
): RowOutcome {
  const sameMessage = boundary.firstMessageId === boundary.lastMessageId;
  const isBoundary = position.isFirst || position.isLast;

  if (decoded.kind === 'presentation') {
    return isBoundary ? { kind: 'stop' } : { kind: 'skip' };
  }
  if (decoded.kind === 'invalid') return { kind: 'stop' };
  if (
    decoded.role === null ||
    decoded.timestamp === null ||
    decoded.visibleText === null
  ) {
    return { kind: 'stop' };
  }

  const textLength = decoded.visibleText.length;
  if (textLength === 0) {
    // The chunker skips empty eligible messages, so an empty boundary means
    // the projection no longer identifies the source it was built from.
    return isBoundary ? { kind: 'stop' } : { kind: 'skip' };
  }

  const range = sourceOffsets(position, sameMessage, boundary, textLength);
  if (!hasValidSourceRange(position, sameMessage, textLength, range)) {
    return { kind: 'stop' };
  }

  return {
    kind: 'message',
    message: {
      messageSeq: decoded.messageSeq,
      role: decoded.role,
      timestamp: decoded.timestamp,
      visibleText: decoded.visibleText,
      sourceStart: range.start,
      sourceEndExclusive: range.end,
    },
  };
}

/** Convert one database snapshot's rows into canonical source records. */
export function hydrateCanonicalSearchRows(
  rows: ReadonlyArray<CanonicalHydrationRow>,
  candidate: CanonicalSearchCandidate,
): HydratedCanonicalSearchDocument | null {
  if (candidate.bestDocumentId === null || rows.length === 0) return null;

  const resolved = resolveDocumentBoundary(rows, candidate);
  if (resolved === null) return null;
  const { boundary, range } = resolved;

  const messages: Array<CanonicalSearchMessage> = [];
  let previousSeq = 0;

  for (const [index, row] of rows.entries()) {
    const decoded = decodeCanonicalMessage(row, candidate, boundary, range);
    if (decoded === null || decoded.messageSeq <= previousSeq) {
      return null;
    }
    previousSeq = decoded.messageSeq;

    const position = {
      isFirst: index === 0,
      isLast: index === rows.length - 1,
    };
    const outcome = resolveRowOutcome(decoded, position, boundary);
    if (outcome.kind === 'stop') return null;
    if (outcome.kind === 'message') messages.push(outcome.message);
  }

  return { chatId: candidate.chatId, messages };
}

/** The winning projection document's identity and text-offset boundary. */
function winningDocumentCte(
  ownerUserId: string,
  bestDocumentId: string,
  chatId: string,
) {
  return sql`
      SELECT
        d.first_message_id,
        d.last_message_id,
        d.first_message_text_offset,
        d.last_message_text_offset_exclusive
      FROM search_chat_documents AS d
      INNER JOIN chats AS document_chat
        ON document_chat.id = d.chat_id
       AND document_chat.owner_user_id = ${ownerUserId}
      WHERE d.id = ${bestDocumentId}
        AND d.chat_id = ${chatId}
        AND d.owner_user_id = ${ownerUserId}
        AND d.chunker_version = ${CHUNKER_VERSION}
      LIMIT 1
    `;
}

/** The winning document's message sequence boundary, owner-scoped. */
function boundariesCte(ownerUserId: string, chatId: string) {
  return sql`
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
       AND first_message.chat_id = ${chatId}
      INNER JOIN messages AS last_message
        ON last_message.id = d.last_message_id
       AND last_message.chat_id = ${chatId}
      INNER JOIN chats AS first_chat
        ON first_chat.id = first_message.chat_id
       AND first_chat.owner_user_id = ${ownerUserId}
      INNER JOIN chats AS last_chat
        ON last_chat.id = last_message.chat_id
       AND last_chat.owner_user_id = ${ownerUserId}
      WHERE first_message.seq <= last_message.seq
    `;
}

/** Every message row within the resolved boundary, owner-scoped. */
function messagesInBoundarySelect(ownerUserId: string, chatId: string) {
  return sql`
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
      ON message.chat_id = ${chatId}
     AND message.seq >= boundaries.first_seq
     AND message.seq <= boundaries.last_seq
    INNER JOIN chats AS message_chat
      ON message_chat.id = message.chat_id
     AND message_chat.owner_user_id = ${ownerUserId}
    ORDER BY message.seq ASC
  `;
}

/**
 * Hydrate a winning projection document from a caller-provided owner-scoped
 * transaction. The caller MUST pass the `tx` from `TenantDbService.runAs`;
 * this function intentionally does not open a nested transaction or a public
 * sharing read path.
 *
 * The three CTEs below mirror the query's own `winning_document` /
 * `boundaries` / final-select structure; splitting them into named fragments
 * composes back into the exact same single statement (verified byte-for-byte
 * against the prior monolithic query), never a second round trip.
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
    WITH winning_document AS (${winningDocumentCte(ownerUserId, candidate.bestDocumentId, candidate.chatId)}), boundaries AS (${boundariesCte(ownerUserId, candidate.chatId)})
    ${messagesInBoundarySelect(ownerUserId, candidate.chatId)}
  `);

  return hydrateCanonicalSearchRows([...rows], candidate);
}
