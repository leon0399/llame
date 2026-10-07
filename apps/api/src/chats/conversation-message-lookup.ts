/**
 * Owner-scoped lookup of one immutable conversation source row plus its
 * nearest eligible neighbours (split from messages-repository.ts, which
 * delegates `findConversationMessage` here).
 */
import { sql, type SQL } from 'drizzle-orm';
import { type Db } from '../db/tenant-db.service';
import { eligibleMessagePredicate } from './message-eligibility';

export type ConversationMessageLookup = {
  chatId: string;
  seq: number;
  role: 'user' | 'assistant';
  parts: Array<unknown>;
  usage: unknown;
  createdAt: Date;
  previousMessageSeq?: number;
  nextMessageSeq?: number;
};

type ConversationMessageLookupRow = {
  message_chat_id: string;
  message_seq: string;
  message_role: string;
  message_parts: unknown;
  message_usage: unknown;
  message_created_at: Date | string;
  previous_message_seq: string | null;
  next_message_seq: string | null;
};

function parseSafePositiveSequence(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** The eligible-source CTE body, bound to one chat and the calling owner. */
function eligibleSourceCte(chatId: string, ownerUserId: string): SQL {
  return sql`
    eligible AS (
      SELECT
        m.chat_id,
        m.seq,
        m.role,
        m.parts,
        m.usage,
        m.created_at
      FROM messages AS m
      INNER JOIN chats AS c
        ON c.id = m.chat_id
      WHERE m.chat_id = ${chatId}
        AND c.owner_user_id = ${ownerUserId}
        AND current_setting('app.current_user_id', true) = ${ownerUserId}
        AND ${eligibleMessagePredicate('m')}
    )`;
}

async function selectLookupRow(
  db: Db,
  chatId: string,
  ownerUserId: string,
  messageSeq: number,
): Promise<ConversationMessageLookupRow | undefined> {
  // One statement gives target and neighbors one database snapshot. The CTE
  // is intentionally message-scoped; no full-chat row set crosses the
  // repository boundary.
  const rows = await db.execute<ConversationMessageLookupRow>(sql`
    WITH ${eligibleSourceCte(chatId, ownerUserId)}, target AS (
      SELECT *
      FROM eligible
      WHERE seq = ${messageSeq}
    )
    SELECT
      target.chat_id AS message_chat_id,
      target.seq::text AS message_seq,
      target.role AS message_role,
      target.parts AS message_parts,
      target.usage AS message_usage,
      target.created_at AS message_created_at,
      (
        SELECT previous.seq::text
        FROM eligible AS previous
        WHERE previous.seq < target.seq
        ORDER BY previous.seq DESC
        LIMIT 1
      ) AS previous_message_seq,
      (
        SELECT next_message.seq::text
        FROM eligible AS next_message
        WHERE next_message.seq > target.seq
        ORDER BY next_message.seq ASC
        LIMIT 1
      ) AS next_message_seq
    FROM target
  `);

  return [...rows][0];
}

function toConversationMessageLookup(
  row: ConversationMessageLookupRow | undefined,
): ConversationMessageLookup | undefined {
  if (
    row === undefined ||
    (row.message_role !== 'user' && row.message_role !== 'assistant') ||
    !Array.isArray(row.message_parts)
  ) {
    return undefined;
  }

  const seq = parseSafePositiveSequence(row.message_seq);
  if (seq === undefined) return undefined;

  const previousMessageSeq = parseSafePositiveSequence(
    row.previous_message_seq,
  );
  const nextMessageSeq = parseSafePositiveSequence(row.next_message_seq);
  const createdAt =
    row.message_created_at instanceof Date
      ? row.message_created_at
      : new Date(row.message_created_at);

  const result: ConversationMessageLookup = {
    chatId: row.message_chat_id,
    seq,
    role: row.message_role,
    parts: row.message_parts,
    usage: row.message_usage,
    createdAt,
  };
  if (previousMessageSeq !== undefined) {
    result.previousMessageSeq = previousMessageSeq;
  }
  if (nextMessageSeq !== undefined) {
    result.nextMessageSeq = nextMessageSeq;
  }
  return result;
}

/**
 * Resolve one immutable conversation source and its nearest eligible
 * neighbors in one statement. The owner predicate is repeated alongside the
 * RLS join, while the current tenant identity guard prevents the public-share
 * policy from turning an owner parameter into authority in runAsPublic.
 */
export async function findConversationMessage(
  db: Db,
  chatId: string,
  ownerUserId: string,
  messageSeq: number,
): Promise<ConversationMessageLookup | undefined> {
  if (!ownerUserId.trim()) {
    throw new Error(
      'MessagesRepository.findConversationMessage requires a non-empty userId',
    );
  }
  if (!Number.isSafeInteger(messageSeq) || messageSeq <= 0) {
    return undefined;
  }

  return toConversationMessageLookup(
    await selectLookupRow(db, chatId, ownerUserId, messageSeq),
  );
}
