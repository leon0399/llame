import { sql, type SQL } from 'drizzle-orm';

import { type Db } from '../db/tenant-db.service';
import { eligibleMessagePredicate } from './message-eligibility';

export type TimelineByOwnerOptions = {
  after?: Date;
  before?: Date;
  limit: number;
};

export type TimelineRegionRow = {
  chatId: string;
  title: string | null;
  firstActivityAt: Date;
  lastActivityAt: Date;
  messageCount: number;
  firstSeq: number;
  lastSeq: number;
};

type TimelineRawRow = {
  chat_id: string;
  title: string | null;
  first_activity_at: Date | string;
  last_activity_at: Date | string;
  message_count: string;
  first_seq: string;
  last_seq: string;
};

function tstz(d: Date): SQL {
  return sql`${d.toISOString()}::timestamptz`;
}

function buildMessageRangeFilter(options: {
  after?: Date;
  before?: Date;
}): SQL {
  const clauses: Array<SQL> = [];
  if (options.after) {
    clauses.push(sql`m.created_at >= ${tstz(options.after)}`);
  }
  if (options.before) {
    clauses.push(sql`m.created_at < ${tstz(options.before)}`);
  }
  return clauses.length > 0 ? sql`AND ${sql.join(clauses, sql` AND `)}` : sql``;
}

function toTimelineRegionRow(r: TimelineRawRow): TimelineRegionRow {
  return {
    chatId: r.chat_id,
    title: r.title,
    firstActivityAt:
      r.first_activity_at instanceof Date
        ? r.first_activity_at
        : new Date(r.first_activity_at),
    lastActivityAt:
      r.last_activity_at instanceof Date
        ? r.last_activity_at
        : new Date(r.last_activity_at),
    messageCount: Number(r.message_count),
    firstSeq: Number(r.first_seq),
    lastSeq: Number(r.last_seq),
  };
}

export async function timelineByOwner(
  db: Db,
  ownerUserId: string,
  options: TimelineByOwnerOptions,
): Promise<Array<TimelineRegionRow>> {
  if (!ownerUserId.trim()) {
    throw new Error('timelineByOwner requires a non-empty userId');
  }
  await db.execute(sql`SET LOCAL statement_timeout = 3000`);
  const rangeFilter = buildMessageRangeFilter(options);

  const rows = await db.execute<TimelineRawRow>(sql`
    SELECT
      c.id AS chat_id, c.title,
      MIN(m.created_at) AS first_activity_at,
      MAX(m.created_at) AS last_activity_at,
      COUNT(*)::text AS message_count,
      MIN(m.seq)::text AS first_seq,
      MAX(m.seq)::text AS last_seq
    FROM messages m
    INNER JOIN chats c ON c.id = m.chat_id
    WHERE c.owner_user_id = ${ownerUserId}
      AND current_setting('app.current_user_id', true) = ${ownerUserId}
      AND ${eligibleMessagePredicate('m')}
      ${rangeFilter}
    GROUP BY c.id, c.title
    ORDER BY MAX(m.created_at) DESC, c.id
    LIMIT ${options.limit + 1}
  `);
  return [...rows].map(toTimelineRegionRow);
}
