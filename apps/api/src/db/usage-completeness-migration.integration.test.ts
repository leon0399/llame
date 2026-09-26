/**
 * Exercises the hand-authored usage marker against isolated FORCE-RLS tables,
 * applying only this migration's statements.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import postgres, { type JSONValue, type Sql } from 'postgres';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
if (!TEST_DB_URL) {
  throw new Error(
    'usage-completeness-migration.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

type SqlClient = Sql;

type HistoricalRow = {
  id: string;
  parts: JSONValue;
  usage: Record<string, JSONValue> | null;
  expectedComplete: boolean | null;
};

type MarkedRow = {
  id: string;
  complete: string | null;
  preserved: boolean;
  hasBilling: boolean;
  usageIsNull: boolean;
};

const migrationStatements = readFileSync(
  path.join(
    __dirname,
    'migrations',
    '20260924192905_mark_usage_completeness.sql',
  ),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);
const schemaName = `usage_completeness_${crypto.randomUUID().replaceAll('-', '')}`;

describe('historical usage completeness migration', () => {
  let sql: SqlClient;

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;
    sql = postgres(TEST_DB_URL, {
      ssl,
      max: 1,
      connection: { options: `-c search_path=${schemaName},public` },
    });

    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    const currentSchema = await sql`SELECT current_schema() AS name`;
    expect(currentSchema).toEqual([{ name: schemaName }]);
    await sql.unsafe(`
      CREATE TABLE "${schemaName}"."messages" (
        id uuid PRIMARY KEY,
        role text NOT NULL,
        parts jsonb NOT NULL,
        usage jsonb
      );
      CREATE TABLE "${schemaName}"."system_prompt_receipts" (
        run_id uuid NOT NULL,
        attempt_id uuid NOT NULL
      );
      CREATE TABLE "${schemaName}"."usage_baselines" (
        message_id uuid PRIMARY KEY,
        usage jsonb
      );
      ALTER TABLE "${schemaName}"."messages" ENABLE ROW LEVEL SECURITY;
      CREATE POLICY messages_migration_test_deny
        ON "${schemaName}"."messages" USING (false) WITH CHECK (false);
      ALTER TABLE "${schemaName}"."system_prompt_receipts" ENABLE ROW LEVEL SECURITY;
      CREATE POLICY receipts_migration_test_deny
        ON "${schemaName}"."system_prompt_receipts" USING (false) WITH CHECK (false);
    `);
  });

  afterAll(async () => {
    if (sql) {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await sql.end();
    }
  });

  it('marks historical usage without changing its existing JSONB values and is safe to rerun', async () => {
    const reclaimedRunId = crypto.randomUUID();
    const rows = [
      {
        id: crypto.randomUUID(),
        parts: [
          { type: 'text', text: 'tool request' },
          { type: 'tool-search', input: { query: 'history' } },
        ],
        usage: {
          runId: crypto.randomUUID(),
          status: 'completed',
          inputTokens: 120,
          outputTokens: 12,
          totalTokens: 132,
          costUsd: 0.00024,
          nested: { untouched: [true, null, 'value'] },
        },
        expectedComplete: false,
      },
      {
        id: crypto.randomUUID(),
        parts: [{ type: 'text', text: 'single request' }],
        usage: {
          runId: crypto.randomUUID(),
          status: 'completed',
          inputTokens: 80,
          outputTokens: 14,
          totalTokens: 94,
          costUsd: 0.00017,
        },
        expectedComplete: true,
      },
      {
        id: crypto.randomUUID(),
        parts: { type: 'tool-search' },
        usage: {
          runId: crypto.randomUUID(),
          status: 'completed',
          inputTokens: 51,
          outputTokens: 7,
          totalTokens: 58,
        },
        expectedComplete: true,
      },
      {
        id: crypto.randomUUID(),
        parts: [{ type: 'text', text: 'failed request' }],
        usage: {
          runId: crypto.randomUUID(),
          status: 'error',
          inputTokens: 80,
          outputTokens: 0,
          totalTokens: 80,
        },
        expectedComplete: false,
      },
      {
        id: crypto.randomUUID(),
        parts: [{ type: 'text', text: 'reclaimed request' }],
        usage: {
          runId: reclaimedRunId,
          status: 'completed',
          inputTokens: 90,
          outputTokens: 10,
          totalTokens: 100,
        },
        expectedComplete: false,
      },
      {
        id: crypto.randomUUID(),
        parts: [{ type: 'text', text: 'malformed unmatched run id' }],
        usage: {
          runId: 'not-a-uuid-with-no-receipt',
          status: 'completed',
          inputTokens: 40,
          outputTokens: 6,
          totalTokens: 46,
        },
        expectedComplete: true,
      },
      {
        id: crypto.randomUUID(),
        parts: [{ type: 'tool-existing', input: {} }],
        usage: {
          runId: crypto.randomUUID(),
          status: 'completed',
          complete: true,
          inputTokens: 30,
          outputTokens: 4,
          totalTokens: 34,
        },
        expectedComplete: true,
      },
      {
        id: crypto.randomUUID(),
        parts: [{ type: 'text', text: 'no usage' }],
        usage: null,
        expectedComplete: null,
      },
    ] satisfies Array<HistoricalRow>;

    const testSchema = sql(schemaName);

    for (const row of rows) {
      await sql`
        INSERT INTO ${testSchema}.messages (id, role, parts, usage)
        VALUES (
          ${row.id}::uuid,
          'assistant',
          ${sql.json(row.parts)},
          ${row.usage === null ? null : sql.json(row.usage)}
        )
      `;
      await sql`
        INSERT INTO ${testSchema}.usage_baselines (message_id, usage)
        VALUES (
          ${row.id}::uuid,
          ${row.usage === null ? null : sql.json(row.usage)}
        )
      `;
    }

    const firstAttemptId = crypto.randomUUID();
    const secondAttemptId = crypto.randomUUID();
    await sql`
      INSERT INTO ${testSchema}.system_prompt_receipts (run_id, attempt_id)
      VALUES
        (${reclaimedRunId}::uuid, ${firstAttemptId}::uuid),
        (${reclaimedRunId}::uuid, ${secondAttemptId}::uuid)
    `;
    await sql.unsafe(`
      ALTER TABLE "${schemaName}"."messages" FORCE ROW LEVEL SECURITY;
      ALTER TABLE "${schemaName}"."system_prompt_receipts" FORCE ROW LEVEL SECURITY;
    `);

    await applyUsageCompletenessMigration(sql);

    const rlsState = await sql`
      SELECT c.relname, c.relforcerowsecurity
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schemaName}
        AND c.relname IN ('messages', 'system_prompt_receipts')
      ORDER BY c.relname
    `;
    expect(rlsState).toEqual([
      { relname: 'messages', relforcerowsecurity: true },
      { relname: 'system_prompt_receipts', relforcerowsecurity: true },
    ]);

    const firstApplication = await readMarkedRows(sql);
    expect(firstApplication).toHaveLength(rows.length);
    for (const row of rows) {
      const result = firstApplication.find(
        (candidate) => candidate.id === row.id,
      );
      expect(result).toBeDefined();
      expect(result?.preserved).toBe(true);
      expect(result?.hasBilling).toBe(false);
      if (row.expectedComplete === null) {
        expect(result?.usageIsNull).toBe(true);
        expect(result?.complete).toBeNull();
      } else {
        expect(result?.usageIsNull).toBe(false);
        expect(result?.complete).toBe(String(row.expectedComplete));
      }
    }

    await applyUsageCompletenessMigration(sql);

    const secondRlsState = await sql`
      SELECT c.relname, c.relforcerowsecurity
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schemaName}
        AND c.relname IN ('messages', 'system_prompt_receipts')
      ORDER BY c.relname
    `;
    expect(secondRlsState).toEqual(rlsState);
    const secondApplication = await readMarkedRows(sql);
    expect(secondApplication).toEqual(firstApplication);
  });
});
async function applyUsageCompletenessMigration(sql: SqlClient): Promise<void> {
  await sql.begin(async (tx) => {
    for (const statement of migrationStatements) {
      await tx.unsafe(statement);
    }
  });
}

async function readMarkedRows(sql: SqlClient): Promise<Array<MarkedRow>> {
  const schema = sql(schemaName);
  await sql.unsafe(`
    ALTER TABLE "${schemaName}"."messages" NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE "${schemaName}"."system_prompt_receipts" NO FORCE ROW LEVEL SECURITY;
  `);
  const rows = await sql<Array<MarkedRow>>`
    SELECT
      message.id::text AS id,
      message.usage->>'complete' AS complete,
      (
        CASE WHEN jsonb_typeof(message.usage) = 'object'
          THEN message.usage - 'complete'
          ELSE message.usage
        END
      ) IS NOT DISTINCT FROM (
        CASE WHEN jsonb_typeof(baseline.usage) = 'object'
          THEN baseline.usage - 'complete'
          ELSE baseline.usage
        END
      ) AS preserved,
      message.usage IS NULL AS "usageIsNull",
      COALESCE(message.usage ? 'billing', false) AS "hasBilling"
    FROM ${schema}.messages AS message
    INNER JOIN ${schema}.usage_baselines AS baseline
      ON baseline.message_id = message.id
    ORDER BY message.id
  `;
  await sql.unsafe(`
    ALTER TABLE "${schemaName}"."messages" FORCE ROW LEVEL SECURITY;
    ALTER TABLE "${schemaName}"."system_prompt_receipts" FORCE ROW LEVEL SECURITY;
  `);
  return rows;
}
