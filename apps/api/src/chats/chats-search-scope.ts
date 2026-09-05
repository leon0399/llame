import { sql, type SQL } from 'drizzle-orm';

import { eligibleMessagePredicate } from './message-eligibility';

export type TimeRange = {
  after?: Date;
  before?: Date;
  constraint: 'required' | 'preferred';
};

export type SearchByOwnerOptions = {
  limit: number;
  vector?: { queryVector: ReadonlyArray<number>; modelKey: string };
  timeRange?: TimeRange;
};

function tstz(d: Date): SQL {
  return sql`${d.toISOString()}::timestamptz`;
}

function withRequiredDocumentRange(ownerScope: SQL, range: TimeRange): SQL {
  const clauses: Array<SQL> = [ownerScope];
  if (range.before)
    clauses.push(sql`d.first_message_at < ${tstz(range.before)}`);
  if (range.after) clauses.push(sql`d.last_message_at >= ${tstz(range.after)}`);
  return sql`(${sql.join(clauses, sql` AND `)})`;
}

function withRequiredParentRange(
  ownerScope: SQL,
  ownerUserId: string,
  range: TimeRange,
): SQL {
  const rangeClauses: Array<SQL> = [];
  if (range.after)
    rangeClauses.push(sql`em.created_at >= ${tstz(range.after)}`);
  if (range.before)
    rangeClauses.push(sql`em.created_at < ${tstz(range.before)}`);
  if (rangeClauses.length === 0) return ownerScope;

  const existsPredicate = sql`EXISTS (
    SELECT 1 FROM messages em
    WHERE em.chat_id = c.id
      AND current_setting('app.current_user_id', true) = ${ownerUserId}
      AND ${eligibleMessagePredicate('em')}
      AND ${sql.join(rangeClauses, sql` AND `)}
  )`;
  return sql`(${ownerScope} AND ${existsPredicate})`;
}

function rangeOverlapPredicate(range: TimeRange): SQL {
  const clauses: Array<SQL> = [];
  if (range.before)
    clauses.push(sql`d.first_message_at < ${tstz(range.before)}`);
  if (range.after) clauses.push(sql`d.last_message_at >= ${tstz(range.after)}`);
  return clauses.length > 0
    ? sql`(${sql.join(clauses, sql` AND `)})`
    : sql`true`;
}

export function resolveSearchScopes(
  ownerUserId: string,
  timeRange?: TimeRange,
) {
  const ownerDoc = sql`d.owner_user_id = ${ownerUserId}`;
  const ownerParent = sql`c.owner_user_id = ${ownerUserId}`;
  const isRequired = timeRange?.constraint === 'required';
  return {
    scope: {
      document: isRequired
        ? withRequiredDocumentRange(ownerDoc, timeRange)
        : ownerDoc,
      parent: isRequired
        ? withRequiredParentRange(ownerParent, ownerUserId, timeRange)
        : ownerParent,
    },
    rangePreference:
      timeRange?.constraint === 'preferred'
        ? { predicate: rangeOverlapPredicate(timeRange), weight: 0.25 }
        : undefined,
  };
}
