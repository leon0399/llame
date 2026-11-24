import { sql, type SQL } from 'drizzle-orm';
import { isContextItemPart } from './context-item';

function digestContextPartPredicate(part: SQL): SQL {
  const data = sql`(${part}->'data')`;

  return sql`CASE
    WHEN jsonb_typeof(${part}) = 'object'
      AND jsonb_typeof(${data}) = 'object'
    THEN
      ${part}->>'type' = 'data-context'
      AND ${part} ?& ARRAY['type', 'data']::text[]
      AND ${part} - ARRAY['type', 'data']::text[] = '{}'::jsonb
      AND ${data} ?& ARRAY['payload', 'producer', 'runId', 'v']::text[]
      AND ${data} - ARRAY['form', 'payload', 'producer', 'runId', 'text', 'v']::text[] = '{}'::jsonb
      AND ${data}->'v' = '1'::jsonb
      AND ${data}->>'producer' = 'recency-digest'
      AND jsonb_typeof(${data}->'runId') = 'string'
      AND ${data}->>'runId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND jsonb_typeof(${data}->'payload') = 'object'
      AND (NOT (${data} ? 'form') OR jsonb_typeof(${data}->'form') = 'string')
      AND (NOT (${data} ? 'text') OR jsonb_typeof(${data}->'text') = 'string')
    ELSE false
  END`;
}

/**
 * A digest snapshot is authored as a host user row, but is not conversation
 * evidence or a turn. Keep the SQL form identical to the strict TS predicate.
 */
export function digestOnlyHostMessagePredicate(alias: string): SQL {
  const role = sql`${sql.identifier(alias)}.role`;
  const senderUserId = sql`${sql.identifier(alias)}.sender_user_id`;
  const parts = sql`(${sql.identifier(alias)}.parts)::jsonb`;

  return sql`(
    ${role} = 'user'
    AND ${senderUserId} IS NULL
    AND CASE
      WHEN jsonb_typeof(${parts}) = 'array' THEN
        jsonb_array_length(${parts}) = 1
        AND ${digestContextPartPredicate(sql`(${parts}->0)`)}
      ELSE false
    END
  )`;
}

export function isDigestOnlyHostMessage(message: {
  role: string;
  senderUserId?: string | null;
  parts?: ReadonlyArray<unknown>;
}): boolean {
  const [part] = message.parts ?? [];

  return (
    message.role === 'user' &&
    message.senderUserId === null &&
    message.parts?.length === 1 &&
    isContextItemPart(part) &&
    part.data.producer === 'recency-digest'
  );
}

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
    (
      ${role} = 'user'
      AND NOT ${digestOnlyHostMessagePredicate(alias)}
    )
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
