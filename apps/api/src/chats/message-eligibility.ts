import { sql, type SQL } from 'drizzle-orm';

/**
 * The SQL predicate that identifies "eligible" conversation messages: user
 * rows and assistant rows whose completion status is absent or `completed`.
 * The TS twin is `isImmutableEvidenceMessage` in `conversation-evidence.ts`
 * (via `isCompletedAssistantTurn`); the two must stay semantically identical.
 *
 * @param alias — the table alias for `messages` in the surrounding query
 *                (e.g. `"m"` in `FROM messages AS m`)
 */
export function eligibleMessagePredicate(alias: string): SQL {
  const role = sql`${sql.identifier(alias)}.role`;
  const usage = sql`${sql.identifier(alias)}.usage`;
  return sql`(
    ${role} = 'user'
    OR (
      ${role} = 'assistant'
      AND (
        ${usage} IS NULL
        OR jsonb_typeof(${usage}) <> 'object'
        OR NOT (${usage} ? 'status')
        OR ${usage} ->> 'status' = 'completed'
      )
    )
  )`;
}
