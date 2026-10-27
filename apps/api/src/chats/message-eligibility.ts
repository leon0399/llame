import { sql, type SQL } from 'drizzle-orm';

/** Drizzle sql`` with postgres.js doesn't serialize Date objects; cast via ISO string. */
export function timestamptzParam(d: Date): SQL {
  return sql`${d.toISOString()}::timestamptz`;
}

/**
 * The SQL predicate that identifies "eligible" conversation messages: user
 * rows and assistant rows whose completion status is absent or `completed`,
 * and which no Regenerate has revised. The TS twin is
 * `isImmutableEvidenceMessage` in `conversation-evidence.ts` (via
 * `isCompletedAssistantTurn`); the two must stay semantically identical.
 *
 * @param alias — the table alias for `messages` in the surrounding query
 *                (e.g. `"m"` in `FROM messages AS m`)
 */
export function eligibleMessagePredicate(alias: string): SQL {
  const role = sql`${sql.identifier(alias)}.role`;
  const usage = sql`${sql.identifier(alias)}.usage`;
  const revisedAt = sql`${sql.identifier(alias)}.revised_at`;
  return sql`(
    ${role} = 'user'
    OR (
      ${role} = 'assistant'
      AND ${revisedAt} IS NULL
      AND (
        ${usage} IS NULL
        OR jsonb_typeof(${usage}) <> 'object'
        OR NOT (${usage} ? 'status')
        OR ${usage} ->> 'status' = 'completed'
      )
    )
  )`;
}
