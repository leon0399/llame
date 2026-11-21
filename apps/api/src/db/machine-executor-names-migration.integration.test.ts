/**
 * Exercises the hand-authored Machine executor-id migration against an isolated
 * schema that reproduces the columns, the two unique keys, and the FORCE-RLS
 * wrapping the real tables carry. Applying only this migration's statements
 * proves the rewrites and both guards, and that the FORCE lift restores.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import postgres, { type Sql } from 'postgres';

import { formatMachineLocator } from '../machines/machine-locator';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (!TEST_DB_URL) {
  throw new Error(
    'machine-executor-names-migration.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

type SqlClient = Sql;

/**
 * Every table this migration rewrites; the sandbox forces RLS on each one, so
 * an unwrapped guard or update would silently match zero rows.
 */
const REWRITTEN_TABLES = [
  'chats',
  'checkouts',
  'project_repository_defaults',
  'projects',
  'chat_creation_records',
] as const;

const migrationsDirectory = path.join(__dirname, 'migrations');

const migrationDirectory = readdirSync(migrationsDirectory, {
  withFileTypes: true,
}).find(
  (entry) =>
    entry.isDirectory() && entry.name.endsWith('_machine_executor_names'),
);

if (!migrationDirectory) {
  throw new Error('machine_executor_names migration directory not found');
}

const migrationStatements = readFileSync(
  path.join(migrationsDirectory, migrationDirectory.name, 'migration.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);

const schemaName = `machine_executor_names_${randomUUID().replaceAll('-', '')}`;

type ChatSeed = {
  readonly id?: string;
  readonly executorId: string | null;
  readonly root: string | null;
  readonly told?: string | null;
};

type ChatRow = {
  id: string;
  workspace_executor_id: string | null;
  workspace_root: string | null;
  workspace_told: string | null;
};

describe('machine executor-name migration', () => {
  let sql: SqlClient;

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;
    sql = postgres(TEST_DB_URL, {
      ssl,
      max: 1,
      connection: { options: `-c search_path=${schemaName},public` },
    });

    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.unsafe(`
      CREATE TABLE "${schemaName}"."chats" (
        id uuid PRIMARY KEY,
        owner_user_id text NOT NULL,
        workspace_root text,
        workspace_executor_id text,
        workspace_told text
      );
      CREATE TABLE "${schemaName}"."checkouts" (
        id uuid PRIMARY KEY,
        owner_user_id text NOT NULL,
        executor_id text NOT NULL,
        path text NOT NULL,
        worktree_base text
      );
      CREATE TABLE "${schemaName}"."project_repository_defaults" (
        id uuid PRIMARY KEY,
        owner_user_id text NOT NULL,
        project_repository_id uuid NOT NULL,
        executor_id text NOT NULL
      );
      CREATE TABLE "${schemaName}"."projects" (
        id uuid PRIMARY KEY,
        owner_user_id text NOT NULL,
        default_executor_id text
      );
      CREATE TABLE "${schemaName}"."chat_creation_records" (
        id uuid PRIMARY KEY,
        owner_user_id text NOT NULL,
        chat_id uuid NOT NULL,
        attempts jsonb NOT NULL DEFAULT '[]'::jsonb
      );
      CREATE TABLE "${schemaName}"."chat_jobs" (
        id uuid PRIMARY KEY,
        executor text NOT NULL
      );
      CREATE UNIQUE INDEX "checkouts_owner_executor_path_uidx"
        ON "${schemaName}"."checkouts" (owner_user_id, executor_id, path);
      CREATE UNIQUE INDEX "project_repository_defaults_owner_link_executor_uidx"
        ON "${schemaName}"."project_repository_defaults"
          (owner_user_id, project_repository_id, executor_id);
    `);

    for (const table of REWRITTEN_TABLES) {
      await sql.unsafe(`
        ALTER TABLE "${schemaName}"."${table}" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE "${schemaName}"."${table}" FORCE ROW LEVEL SECURITY;
      `);
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await sql.end();
    }
  });

  beforeEach(async () => {
    // Fixtures are seeded the way the migration runs — as the owning role
    // without a tenant identity — so FORCE stays off until a test arms it.
    await setForce(false);

    for (const table of [...REWRITTEN_TABLES, 'chat_jobs']) {
      await sql.unsafe(`TRUNCATE "${schemaName}"."${table}"`);
    }
  });

  it('rewrites executor ids and absolute roots into Machine names and canonical locators', async () => {
    const encodedRoots = [
      '/home/me/a b#c',
      '/home/me/percent%25name',
      '/home/me/question?mark',
      String.raw`/home/me/back\slash`,
      '/home/me/control\u0001char',
      '/home/me/new\nline',
      `/home/me/delete${String.fromCharCode(127)}char`,
      '/home/me/last:segment',
      '/home/me/mid:segment/file',
      '/home/me/plain',
    ] as const;

    const fixtureChats = new Map<string, string>();

    for (const root of encodedRoots) {
      const id = await insertChat({
        executorId: 'host',
        root,
        told: null,
      });

      fixtureChats.set(id, root);
    }

    const prefixedRoot = await insertChat({
      executorId: 'machine:nas',
      root: '/srv',
      told: null,
    });

    const alreadyCanonical = await insertChat({
      executorId: 'machine:nas',
      root: 'machine://nas/srv',
      told: null,
    });

    const toldChat = await insertChat({
      executorId: 'host',
      root: '/home/me/a b#c',
      told: '/home/me/a b#c',
    });

    const detachedToldChat = await insertChat({
      executorId: null,
      root: null,
      told: '/old/root',
    });

    const untoldChat = await insertChat({
      executorId: 'host',
      root: '/home/me/plain',
      told: null,
    });

    const checkoutId = randomUUID();
    await sql`
      INSERT INTO ${sql(schemaName)}.checkouts
        (id, owner_user_id, executor_id, path, worktree_base)
      VALUES (
        ${checkoutId}::uuid,
        'owner-1',
        'machine:nas',
        '/srv',
        '/srv/wt'
      )
    `;

    const projectId = randomUUID();
    await sql`
      INSERT INTO ${sql(schemaName)}.projects
        (id, owner_user_id, default_executor_id)
      VALUES (${projectId}::uuid, 'owner-1', 'machine:nas')
    `;

    const hostRecordId = randomUUID();
    await sql`
      INSERT INTO ${sql(schemaName)}.chat_creation_records
        (id, owner_user_id, chat_id, attempts)
      VALUES (
        ${hostRecordId}::uuid,
        'owner-1',
        ${untoldChat}::uuid,
        ${sql.json([
          {
            createdAt: '2026-11-01T00:00:00.000Z',
            decisions: [],
            worktreeDirectory: '/home/me/wt',
          },
          { createdAt: '2026-11-02T00:00:00.000Z', decisions: [] },
        ])}
      )
    `;

    const detachedRecordId = randomUUID();
    await sql`
      INSERT INTO ${sql(schemaName)}.chat_creation_records
        (id, owner_user_id, chat_id, attempts)
      VALUES (
        ${detachedRecordId}::uuid,
        'owner-1',
        ${detachedToldChat}::uuid,
        ${sql.json([
          {
            createdAt: '2026-11-01T00:00:00.000Z',
            decisions: [],
            worktreeDirectory: '/kept/as-written',
          },
        ])}
      )
    `;

    const jobId = randomUUID();
    await sql`
      INSERT INTO ${sql(schemaName)}.chat_jobs (id, executor)
      VALUES (${jobId}::uuid, 'bash')
    `;

    await setForce(true);
    await applyMigration(sql);

    const chats = await readChats();

    for (const [id, root] of fixtureChats) {
      const chat = chats.find((candidate) => candidate.id === id);

      expect(chat?.workspace_executor_id).toBe('host');
      expect(chat?.workspace_root).toBe(formatMachineLocator('host', root));

      if (root === '/home/me/a b#c')
        expect(chat?.workspace_root).toBe('machine://host/home/me/a b%23c');
    }

    expect(
      chats.find((chat) => chat.id === prefixedRoot)?.workspace_executor_id,
    ).toBe('nas');
    expect(chats.find((chat) => chat.id === prefixedRoot)?.workspace_root).toBe(
      'machine://nas/srv',
    );

    expect(
      chats.find((chat) => chat.id === alreadyCanonical)?.workspace_executor_id,
    ).toBe('nas');
    expect(
      chats.find((chat) => chat.id === alreadyCanonical)?.workspace_root,
    ).toBe('machine://nas/srv');

    expect(chats.find((chat) => chat.id === toldChat)?.workspace_told).toBe(
      `host\nmachine://host/home/me/a b%23c`,
    );
    expect(chats.find((chat) => chat.id === detachedToldChat)).toMatchObject({
      workspace_executor_id: null,
      workspace_root: null,
      workspace_told: null,
    });
    expect(chats.find((chat) => chat.id === untoldChat)?.workspace_told).toBe(
      null,
    );

    const checkout = await readWithoutForce(
      () =>
        sql<
          Array<{ executor_id: string; path: string; worktree_base: string }>
        >`
        SELECT executor_id, path, worktree_base
        FROM ${sql(schemaName)}.checkouts
        WHERE id = ${checkoutId}::uuid
      `,
    );

    expect(checkout).toEqual([
      {
        executor_id: 'nas',
        path: 'machine://nas/srv',
        worktree_base: 'machine://nas/srv/wt',
      },
    ]);

    const project = await readWithoutForce(
      () =>
        sql<Array<{ default_executor_id: string }>>`
        SELECT default_executor_id
        FROM ${sql(schemaName)}.projects
        WHERE id = ${projectId}::uuid
      `,
    );

    expect(project).toEqual([{ default_executor_id: 'nas' }]);

    const records = await readWithoutForce(
      () =>
        sql<Array<{ id: string; attempts: unknown }>>`
        SELECT id, attempts FROM ${sql(schemaName)}.chat_creation_records
      `,
    );

    expect(
      records.find((record) => record.id === hostRecordId)?.attempts,
    ).toEqual([
      {
        createdAt: '2026-11-01T00:00:00.000Z',
        decisions: [],
        worktreeDirectory: 'machine://host/home/me/wt',
      },
      { createdAt: '2026-11-02T00:00:00.000Z', decisions: [] },
    ]);
    expect(
      records.find((record) => record.id === detachedRecordId)?.attempts,
    ).toEqual([
      {
        createdAt: '2026-11-01T00:00:00.000Z',
        decisions: [],
        worktreeDirectory: '/kept/as-written',
      },
    ]);

    const jobs = await sql<Array<{ executor: string }>>`
      SELECT executor FROM ${sql(schemaName)}.chat_jobs WHERE id = ${jobId}::uuid
    `;

    expect(jobs).toEqual([{ executor: 'bash' }]);

    expect(await forcedTables()).toEqual([...REWRITTEN_TABLES].sort());
  });

  it('refuses a stored id that is not a Machine name and changes nothing', async () => {
    const chatId = await insertChat({
      executorId: 'Host_A',
      root: '/home/me/a',
      told: '/home/me/a',
    });

    await setForce(true);
    await expect(applyMigration(sql)).rejects.toThrow(
      /chats\.workspace_executor_id holds Host_A, which is not a Machine name/u,
    );

    const chats = await readChats();
    expect(chats.find((chat) => chat.id === chatId)).toMatchObject({
      workspace_executor_id: 'Host_A',
      workspace_root: '/home/me/a',
      workspace_told: '/home/me/a',
    });
    expect(await forcedTables()).toEqual([...REWRITTEN_TABLES].sort());
  });

  it('refuses checkout rows whose rewritten tuples collide, naming the key', async () => {
    await sql`
      INSERT INTO ${sql(schemaName)}.checkouts
        (id, owner_user_id, executor_id, path)
      VALUES
        (${randomUUID()}::uuid, 'owner-1', 'machine:nas', '/srv'),
        (${randomUUID()}::uuid, 'owner-1', 'nas', 'machine://nas/srv')
    `;

    await setForce(true);
    await expect(applyMigration(sql)).rejects.toThrow(
      /rows would collide on checkouts_owner_executor_path_uidx \(owner-1, nas, machine:\/\/nas\/srv\)/u,
    );

    const checkouts = await readWithoutForce(
      () =>
        sql<Array<{ executor_id: string; path: string }>>`
        SELECT executor_id, path FROM ${sql(schemaName)}.checkouts
        ORDER BY executor_id, path
      `,
    );

    expect(checkouts).toEqual([
      { executor_id: 'machine:nas', path: '/srv' },
      { executor_id: 'nas', path: 'machine://nas/srv' },
    ]);
  });

  it('refuses default rows whose rewritten tuples collide, naming the key', async () => {
    const projectRepositoryId = randomUUID();

    await sql`
      INSERT INTO ${sql(schemaName)}.project_repository_defaults
        (id, owner_user_id, project_repository_id, executor_id)
      VALUES
        (${randomUUID()}::uuid, 'owner-1', ${projectRepositoryId}::uuid, 'machine:nas'),
        (${randomUUID()}::uuid, 'owner-1', ${projectRepositoryId}::uuid, 'nas')
    `;

    await setForce(true);
    await expect(applyMigration(sql)).rejects.toThrow(
      /rows would collide on project_repository_defaults_owner_link_executor_uidx/u,
    );

    const defaults = await readWithoutForce(
      () =>
        sql<Array<{ executor_id: string }>>`
        SELECT executor_id
        FROM ${sql(schemaName)}.project_repository_defaults
        ORDER BY executor_id
      `,
    );

    expect(defaults).toEqual([
      { executor_id: 'machine:nas' },
      { executor_id: 'nas' },
    ]);
  });

  async function insertChat(seed: ChatSeed): Promise<string> {
    const id = seed.id ?? randomUUID();

    await sql`
      INSERT INTO ${sql(schemaName)}.chats
        (id, owner_user_id, workspace_executor_id, workspace_root, workspace_told)
      VALUES (
        ${id}::uuid,
        'owner-1',
        ${seed.executorId},
        ${seed.root},
        ${seed.told ?? null}
      )
    `;

    return id;
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

  async function readChats(): Promise<Array<ChatRow>> {
    return readWithoutForce(
      () => sql<Array<ChatRow>>`
        SELECT id::text, workspace_executor_id, workspace_root, workspace_told
        FROM ${sql(schemaName)}.chats
        ORDER BY workspace_root NULLS FIRST
      `,
    );
  }

  async function setForce(force: boolean): Promise<void> {
    for (const table of REWRITTEN_TABLES) {
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
        AND c.relname = ANY(${[...REWRITTEN_TABLES]})
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
