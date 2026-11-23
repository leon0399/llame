/**
 * Exercises the hand-authored model-selection migration (model-roles) against
 * an isolated schema that reproduces the columns each of its three data steps
 * reads, with FORCE RLS armed on every table the way the real ones carry it.
 * Applying only this migration's statements proves the backfills, the tie
 * order, the NULL cases, the settings rewrite, and that the FORCE lift
 * restores.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import postgres, { type Sql } from 'postgres';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (!TEST_DB_URL) {
  throw new Error(
    'model-selection-migration.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

type SqlClient = Sql;

/** Every table this migration's data steps read or write. */
const TOUCHED_TABLES = [
  'chat_deliveries',
  'chat_jobs',
  'chats',
  'runs',
] as const;

const migrationsDirectory = path.join(__dirname, 'migrations');

const migrationDirectory = readdirSync(migrationsDirectory, {
  withFileTypes: true,
}).find(
  (entry) => entry.isDirectory() && entry.name.endsWith('_model_selection'),
);

if (!migrationDirectory) {
  throw new Error('model_selection migration directory not found');
}

const migrationStatements = readFileSync(
  path.join(migrationsDirectory, migrationDirectory.name, 'migration.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);

const schemaName = `model_selection_${randomUUID().replaceAll('-', '')}`;

/** A stored selection, as the migration writes it. */
type SelectionRow = {
  revision: number;
  selector: string;
  effort: string | null;
};

type RunRow = {
  selector: string;
  model_id: string;
  effort: string | null;
  selected_effort: string | null;
};

type SettingsRow = { id: string; settings: StoredSettings };

/** A pre- or post-rename settings object, as a fixture stores it. */
type StoredSettings = {
  modelId?: string;
  selector?: string;
  effort?: string;
  permissionMode: string;
};

describe('model-selection migration', () => {
  let sql: SqlClient;

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;
    sql = postgres(TEST_DB_URL, {
      ssl,
      max: 1,
      connection: { options: `-c search_path=${schemaName},public` },
    });

    await createPreMigrationSchema();
  });

  afterAll(async () => {
    if (sql) {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await sql.end();
    }
  });

  beforeEach(async () => {
    // Each test starts from the pre-migration shape: an applied migration adds
    // the four columns for good, and a later test's fixtures must not see them.
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await createPreMigrationSchema();

    // Fixtures are seeded the way the migration runs — as the owning role
    // without a tenant identity — so FORCE stays off until a test arms it.
    await setForce(false);
  });

  async function createPreMigrationSchema(): Promise<void> {
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    // Deliberately pre-migration shapes: none of the four added columns exist,
    // so the migration's own ALTERs have to create them.
    await sql.unsafe(`
      CREATE TABLE "${schemaName}"."chats" (
        id uuid PRIMARY KEY,
        owner_user_id text NOT NULL
      );
      CREATE TABLE "${schemaName}"."runs" (
        id uuid PRIMARY KEY,
        chat_id uuid NOT NULL,
        kind text NOT NULL DEFAULT 'turn',
        model_id text NOT NULL,
        effort text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schemaName}"."chat_deliveries" (
        id uuid PRIMARY KEY,
        settings jsonb NOT NULL
      );
      CREATE TABLE "${schemaName}"."chat_jobs" (
        id uuid PRIMARY KEY,
        settings jsonb NOT NULL
      );
    `);

    for (const table of TOUCHED_TABLES) {
      await sql.unsafe(`
        ALTER TABLE "${schemaName}"."${table}" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE "${schemaName}"."${table}" FORCE ROW LEVEL SECURITY;
      `);
    }
  }

  it('seeds each Chat from its latest turn Run and rewrites the stored settings', async () => {
    const latestChat = await insertChat();

    await insertRun({
      chatId: latestChat,
      modelId: 'older-model',
      effort: 'low',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await insertRun({
      chatId: latestChat,
      modelId: 'latest-model',
      effort: 'high',
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    // Newer than both, but a compaction is not a send, so it decides nothing.
    await insertRun({
      chatId: latestChat,
      kind: 'compaction',
      modelId: 'compaction-model',
      createdAt: '2026-03-01T00:00:00.000Z',
    });

    const compactionOnlyChat = await insertChat();
    await insertRun({
      chatId: compactionOnlyChat,
      kind: 'compaction',
      modelId: 'compaction-model',
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    const neverSentChat = await insertChat();

    // The same instant twice: the id breaks the tie, greater id wins.
    const tiedChat = await insertChat();
    await insertRun({
      chatId: tiedChat,
      id: '00000000-0000-4000-8000-000000000001',
      modelId: 'tie-early',
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    await insertRun({
      chatId: tiedChat,
      id: '00000000-0000-4000-8000-000000000002',
      modelId: 'tie-late',
      effort: 'medium',
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    const deliveryId = randomUUID();
    await insertSettingsRow('chat_deliveries', deliveryId, {
      modelId: 'legacy-model',
      effort: 'high',
      permissionMode: 'queue',
    });

    const jobId = randomUUID();
    await insertSettingsRow('chat_jobs', jobId, {
      modelId: 'legacy-model',
      permissionMode: 'default',
    });

    // Already post-migration: the key guard must leave it alone.
    const untouchedDeliveryId = randomUUID();
    await insertSettingsRow('chat_deliveries', untouchedDeliveryId, {
      selector: '@fast',
      permissionMode: 'default',
    });

    await setForce(true);
    await applyMigration(sql);

    const selections = await readWithoutForce(
      () =>
        sql<Array<{ id: string; model_selection: SelectionRow | null }>>`
          SELECT id::text, model_selection
          FROM ${sql(schemaName)}.chats
        `,
    );

    const selectionOf = (chatId: string) =>
      selections.find((row) => row.id === chatId)?.model_selection;

    expect(selectionOf(latestChat)).toEqual({
      revision: 1,
      selector: 'latest-model',
      effort: 'high',
    });
    expect(selectionOf(tiedChat)).toEqual({
      revision: 1,
      selector: 'tie-late',
      effort: 'medium',
    });
    expect(selectionOf(compactionOnlyChat)).toBeNull();
    expect(selectionOf(neverSentChat)).toBeNull();

    const deliveries = await readWithoutForce(
      () =>
        sql<Array<SettingsRow>>`
          SELECT id::text, settings
          FROM ${sql(schemaName)}.chat_deliveries
        `,
    );

    expect(deliveries.find((row) => row.id === deliveryId)?.settings).toEqual({
      selector: 'legacy-model',
      effort: 'high',
      permissionMode: 'queue',
    });
    expect(
      deliveries.find((row) => row.id === untouchedDeliveryId)?.settings,
    ).toEqual({
      selector: '@fast',
      permissionMode: 'default',
    });

    const jobs = await readWithoutForce(
      () =>
        sql<Array<SettingsRow>>`
          SELECT id::text, settings
          FROM ${sql(schemaName)}.chat_jobs
        `,
    );

    expect(jobs.find((row) => row.id === jobId)?.settings).toEqual({
      selector: 'legacy-model',
      permissionMode: 'default',
    });

    // Every existing Run was admitted under exactly the model it calls, so the
    // backfilled selector matches `model_id` and the stored effort the sent one.
    const runRows = await readWithoutForce(
      () =>
        sql<Array<RunRow>>`
          SELECT selector, model_id, effort, selected_effort
          FROM ${sql(schemaName)}.runs
        `,
    );

    for (const run of runRows) {
      expect(run.selector).toBe(run.model_id);
      expect(run.selected_effort).toBe(run.effort);
    }

    expect(await forcedTables()).toEqual([...TOUCHED_TABLES].sort());
  });

  it('keeps a selection written after the column existed when it runs again', async () => {
    const chatId = await insertChat();
    await insertRun({
      chatId,
      modelId: 'first-model',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await setForce(true);
    await applyMigration(sql);
    await setForce(false);

    await sql`
      UPDATE ${sql(schemaName)}.chats
      SET model_selection = ${sql.json({
        revision: 4,
        selector: '@deep',
        effort: 'high',
      })}
      WHERE id = ${chatId}::uuid
    `;

    // Written after the column existed: it names its own selector, which the
    // replay's `WHERE selector IS NULL` must leave alone.
    const replayedRunId = await insertRun({
      chatId,
      modelId: 'second-model',
      selector: '@deep',
      selectedEffort: 'high',
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    await setForce(true);
    await applyMigration(sql);

    const [row] = await readWithoutForce(
      () =>
        sql<Array<{ model_selection: SelectionRow }>>`
          SELECT model_selection
          FROM ${sql(schemaName)}.chats
          WHERE id = ${chatId}::uuid
        `,
    );

    expect(row?.model_selection).toEqual({
      revision: 4,
      selector: '@deep',
      effort: 'high',
    });

    const [replayedRun] = await readWithoutForce(
      () =>
        sql<Array<RunRow>>`
          SELECT selector, model_id, effort, selected_effort
          FROM ${sql(schemaName)}.runs
          WHERE id = ${replayedRunId}::uuid
        `,
    );

    expect(replayedRun).toEqual({
      selector: '@deep',
      model_id: 'second-model',
      effort: null,
      selected_effort: 'high',
    });
    expect(await forcedTables()).toEqual([...TOUCHED_TABLES].sort());
  });

  async function insertChat(): Promise<string> {
    const id = randomUUID();

    await sql`
      INSERT INTO ${sql(schemaName)}.chats (id, owner_user_id)
      VALUES (${id}::uuid, 'owner-1')
    `;

    return id;
  }

  /**
   * A Run fixture. `selector` and `selectedEffort` are for rows written after
   * the migration added them; a pre-migration row must omit both, because the
   * columns do not exist yet.
   */
  async function insertRun(fields: {
    chatId: string;
    id?: string;
    kind?: 'turn' | 'compaction';
    modelId: string;
    effort?: string | null;
    selector?: string;
    selectedEffort?: string | null;
    createdAt: string;
  }): Promise<string> {
    const id = fields.id ?? randomUUID();

    if (fields.selector === undefined) {
      await sql`
        INSERT INTO ${sql(schemaName)}.runs
          (id, chat_id, kind, model_id, effort, created_at)
        VALUES (
          ${id}::uuid,
          ${fields.chatId}::uuid,
          ${fields.kind ?? 'turn'},
          ${fields.modelId},
          ${fields.effort ?? null},
          ${fields.createdAt}::timestamptz
        )
      `;

      return id;
    }

    await sql`
      INSERT INTO ${sql(schemaName)}.runs
        (id, chat_id, kind, model_id, effort, selector, selected_effort, created_at)
      VALUES (
        ${id}::uuid,
        ${fields.chatId}::uuid,
        ${fields.kind ?? 'turn'},
        ${fields.modelId},
        ${fields.effort ?? null},
        ${fields.selector},
        ${fields.selectedEffort ?? null},
        ${fields.createdAt}::timestamptz
      )
    `;

    return id;
  }

  async function insertSettingsRow(
    table: 'chat_deliveries' | 'chat_jobs',
    id: string,
    settings: StoredSettings,
  ): Promise<void> {
    await sql`
      INSERT INTO ${sql(schemaName)}.${sql(table)} (id, settings)
      VALUES (${id}::uuid, ${sql.json(settings)})
    `;
  }

  /**
   * The migration must run as the table owner without a tenant identity, so
   * every read here lifts FORCE the same way and restores it after.
   */
  async function readWithoutForce<T>(run: () => Promise<T>): Promise<T> {
    await setForce(false);

    try {
      return await run();
    } finally {
      await setForce(true);
    }
  }

  async function setForce(force: boolean): Promise<void> {
    for (const table of TOUCHED_TABLES) {
      await sql.unsafe(
        `ALTER TABLE "${schemaName}"."${table}" ${force ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY`,
      );
    }
  }

  async function forcedTables(): Promise<Array<string>> {
    const rows = await sql<Array<{ relname: string }>>`
      SELECT c.relname
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schemaName}
        AND c.relname = ANY(${[...TOUCHED_TABLES]})
        AND c.relforcerowsecurity
      ORDER BY c.relname
    `;

    return rows.map((row) => row.relname);
  }
});

async function applyMigration(connection: SqlClient): Promise<void> {
  await connection.begin(async (tx) => {
    for (const statement of migrationStatements) await tx.unsafe(statement);
  });
}
