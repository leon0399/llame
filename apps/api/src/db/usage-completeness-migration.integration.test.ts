/**
 * Exercises the historical usage marker through Drizzle's migrator against an
 * isolated schema seeded at the migration immediately before this one.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type JSONValue, type Sql } from 'postgres';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
if (!TEST_DB_URL) {
  throw new Error(
    'usage-completeness-migration.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

type SqlClient = Sql;
type MigrationEntry = { tag: string; when: number };
type MigrationJournal = { entries: Array<MigrationEntry> };

type HistoricalRow = {
  id: string;
  parts: Array<JSONValue>;
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

const MIGRATION_TAG = '20260924192905_mark_usage_completeness';
const MIGRATIONS_FOLDER = path.resolve(__dirname, 'migrations');
const schemaName = `usage_completeness_${crypto.randomUUID().replaceAll('-', '')}`;

function isMigrationEntry(value: unknown): value is MigrationEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tag' in value &&
    typeof value.tag === 'string' &&
    'when' in value &&
    typeof value.when === 'number'
  );
}

function isMigrationJournal(value: unknown): value is MigrationJournal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'entries' in value &&
    Array.isArray(value.entries) &&
    value.entries.every(isMigrationEntry)
  );
}
function migrationStamps() {
  const parsedJournal: unknown = JSON.parse(
    readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  );
  if (!isMigrationJournal(parsedJournal)) {
    throw new Error('Migration journal has an invalid shape');
  }
  const index = parsedJournal.entries.findIndex(
    (entry) => entry.tag === MIGRATION_TAG,
  );
  const current = parsedJournal.entries[index];
  const previous = parsedJournal.entries[index - 1];
  if (!current || !previous) {
    throw new Error(
      `Migration journal is missing ${MIGRATION_TAG} or its predecessor`,
    );
  }
  return { previous: previous.when, current: current.when };
}

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
      CREATE TABLE "${schemaName}"."__drizzle_migrations" (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
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
    const stamps = migrationStamps();
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

    const migrationsSchema = sql(schemaName);
    await sql`
      INSERT INTO ${migrationsSchema}.__drizzle_migrations (hash, created_at)
      VALUES ('pre-existing-migration-ledger', ${stamps.previous})
    `;

    for (const row of rows) {
      await sql`
        INSERT INTO ${migrationsSchema}.messages (id, role, parts, usage)
        VALUES (
          ${row.id}::uuid,
          'assistant',
          ${sql.json(row.parts)},
          ${row.usage === null ? null : sql.json(row.usage)}
        )
      `;
      await sql`
        INSERT INTO ${migrationsSchema}.usage_baselines (message_id, usage)
        VALUES (
          ${row.id}::uuid,
          ${row.usage === null ? null : sql.json(row.usage)}
        )
      `;
    }

    const firstAttemptId = crypto.randomUUID();
    const secondAttemptId = crypto.randomUUID();
    await sql`
      INSERT INTO ${migrationsSchema}.system_prompt_receipts (run_id, attempt_id)
      VALUES
        (${reclaimedRunId}::uuid, ${firstAttemptId}::uuid),
        (${reclaimedRunId}::uuid, ${secondAttemptId}::uuid)
    `;
    await sql.unsafe(`
      ALTER TABLE "${schemaName}"."messages" FORCE ROW LEVEL SECURITY;
      ALTER TABLE "${schemaName}"."system_prompt_receipts" FORCE ROW LEVEL SECURITY;
    `);

    const migrationConfig = {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: schemaName,
      migrationsTable: '__drizzle_migrations',
    };
    await migrate(drizzle(sql), migrationConfig);
    const latestLedgerRow = await sql`
      SELECT created_at::text AS created_at
      FROM ${migrationsSchema}.__drizzle_migrations
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(latestLedgerRow).toEqual([{ created_at: String(stamps.current) }]);

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

    // Rewind only the isolated ledger to the preceding migration, simulating
    // an already-applied SQL file whose ledger stamp needs to be retried.
    await sql`
      DELETE FROM ${migrationsSchema}.__drizzle_migrations
      WHERE created_at = ${stamps.current}
    `;
    await migrate(drizzle(sql), migrationConfig);

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
