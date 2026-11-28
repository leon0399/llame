import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRecencyDigestItem } from './recency-digest-item';
import {
  digestOnlyHostMessagePredicate,
  eligibleMessagePredicate,
  isDigestOnlyHostMessage,
} from './message-eligibility';

const part = createRecencyDigestItem({
  runId: '123e4567-e89b-12d3-a456-426614174000',
  payload: { version: 1, kind: 'baseline', announced: [] },
  body: 'Private historical data',
});

const cases = [
  { name: 'strict host carrier', sender: null, parts: [part], carrier: true },
  {
    name: 'owner-authored row',
    sender: 'owner',
    parts: [part],
    carrier: false,
  },
  {
    name: 'mixed owner turn',
    sender: null,
    parts: [part, { type: 'text', text: 'real turn' }],
    carrier: false,
  },
  {
    name: 'incomplete envelope',
    sender: null,
    parts: [{ type: 'data-context', data: { producer: 'recency-digest' } }],
    carrier: false,
  },
  {
    name: 'extra envelope field',
    sender: null,
    parts: [{ ...part, extra: true }],
    carrier: false,
  },
  {
    name: 'extra data field',
    sender: null,
    parts: [{ ...part, data: { ...part.data, extra: true } }],
    carrier: false,
  },
  {
    name: 'invalid payload shape',
    sender: null,
    parts: [{ ...part, data: { ...part.data, payload: [] } }],
    carrier: false,
  },
  {
    name: 'wrong envelope version type',
    sender: null,
    parts: [{ ...part, data: { ...part.data, v: '1' } }],
    carrier: false,
  },
  {
    name: 'invalid original Run identity',
    sender: null,
    parts: [{ ...part, data: { ...part.data, runId: 'not-a-run' } }],
    carrier: false,
  },
  {
    name: 'missing outer type',
    sender: null,
    parts: [{ data: part.data }],
    carrier: false,
  },
  {
    name: 'ordinary job notice',
    sender: null,
    parts: [{ ...part, data: { ...part.data, producer: 'job-notice' } }],
    carrier: false,
  },
] as const;

describe('digest host carriers on the stored JSON column', () => {
  let client: Sql;

  beforeAll(() => {
    const url = process.env.POSTGRES_URL;

    if (!url)
      throw new Error(
        'Integration database setup did not provide POSTGRES_URL',
      );
    client = postgres(url, { max: 1 });
  });

  afterAll(async () => client?.end());

  it.each(cases)(
    '$name has matching SQL and replay eligibility',
    async ({ sender, parts, carrier }) => {
      const db = drizzle({ client });

      const rows = await db.execute<{
        carrier: boolean;
        eligible: boolean;
      }>(sql`
      select ${digestOnlyHostMessagePredicate('m')} as carrier,
             ${eligibleMessagePredicate('m')} as eligible
      from (values ('user', ${sender}::text, ${JSON.stringify(parts)}::text::json, null::jsonb, null::timestamptz))
        as m(role, sender_user_id, parts, usage, revised_at)
    `);

      expect(rows[0]).toMatchObject({ carrier, eligible: !carrier });
      expect(
        isDigestOnlyHostMessage({ role: 'user', senderUserId: sender, parts }),
      ).toBe(carrier);
    },
  );
});
