import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  enforceMigrationLedgerNameConstraint,
  KNOWN_LEGACY_MIGRATION_NAMES,
  prepareMigrationLedger,
  withMigrationAdvisoryLock,
} from './migration-ledger-upgrade';

const NEW_MIGRATION = '20270101000000_test_change';
const FIRST_TWO_TIMESTAMPS = [1_751_224_723_402, 1_751_226_944_554];

// Exact original journal timestamps, including the one-millisecond collision.
const LEGACY_TIMESTAMPS: ReadonlyArray<number> = [
  1_751_224_723_402, 1_751_226_944_554, 1_751_233_460_223, 1_752_640_526_507,
  1_752_700_000_000, 1_782_735_542_694, 1_782_763_011_177, 1_782_773_757_483,
  1_782_776_766_411, 1_782_949_969_476, 1_783_009_440_418, 1_783_078_013_940,
  1_783_109_328_024, 1_783_109_928_024, 1_783_255_441_287, 1_783_290_823_804,
  1_783_327_535_304, 1_783_337_452_496, 1_783_352_181_144, 1_783_461_593_945,
  1_783_613_237_724, 1_783_784_477_273, 1_783_800_869_200, 1_783_815_906_676,
  1_783_835_529_417, 1_783_900_957_382, 1_783_953_156_806, 1_783_986_151_725,
  1_784_025_316_453, 1_784_382_140_622, 1_785_788_118_959, 1_786_204_865_598,
  1_786_376_777_038, 1_786_437_612_626, 1_786_564_546_083, 1_786_568_025_805,
  1_786_610_861_660, 1_786_610_861_661, 1_787_276_312_267, 1_787_441_414_285,
  1_787_449_712_485, 1_787_456_234_193, 1_787_474_394_168, 1_787_514_652_090,
  1_787_601_058_259, 1_787_658_713_444, 1_787_748_989_286, 1_787_842_440_063,
  1_787_846_049_137, 1_787_847_160_558, 1_787_847_171_981, 1_787_848_661_189,
  1_787_849_171_724, 1_787_920_646_176, 1_788_195_292_823, 1_789_317_629_442,
  1_789_325_864_145, 1_789_326_158_428, 1_789_326_296_675, 1_789_377_107_588,
  1_790_278_145_019, 1_790_475_692_997, 1_790_545_058_899, 1_791_312_334_557,
  1_791_597_006_243, 1_791_681_871_741, 1_791_810_430_975, 1_791_888_400_287,
  1_791_888_427_173, 1_791_890_263_589, 1_792_155_371_157, 1_792_188_894_225,
  1_792_196_141_726, 1_792_351_847_914, 1_792_353_078_153, 1_792_424_619_000,
  1_792_819_718_103, 1_792_861_519_718, 1_792_877_668_566, 1_793_072_820_495,
  1_793_081_156_714, 1_793_641_351_360, 1_793_643_464_055, 1_793_668_173_371,
  1_793_722_215_933, 1_794_168_836_593, 1_794_168_844_624, 1_794_413_594_567,
  1_794_447_271_881, 1_794_456_788_453, 1_794_482_496_462, 1_794_495_757_604,
  1_794_495_836_901,
];

let container: StartedPostgreSqlContainer;
let admin: Sql;
let connection: Sql;
let databaseName: string;
let databaseUrl: string;
let migrationFolder: string;
let runMigrate: () => Promise<void>;

async function createLegacyLedger(timestamps: ReadonlyArray<number>) {
  await connection
    .unsafe(`
    create schema drizzle;
    create table drizzle.__drizzle_migrations (
      id serial primary key, hash text not null, created_at bigint
    )
  `)
    .simple();

  for (const [index, timestamp] of timestamps.entries()) {
    await connection`
      insert into drizzle.__drizzle_migrations (id, hash, created_at)
      values (${index + 10}, 'legacy-hash', ${timestamp})
    `;
  }
}

async function createNamedLedger() {
  await connection
    .unsafe(`
    create schema drizzle;
    create table drizzle.__drizzle_migrations (
      id serial primary key, hash text not null, created_at bigint,
      name text, applied_at timestamptz default now()
    )
  `)
    .simple();
}

function prepare() {
  return withMigrationAdvisoryLock(connection, (tx) =>
    prepareMigrationLedger(tx, migrationFolder),
  );
}

async function columns() {
  return connection<Array<{ column_name: string; is_nullable: string }>>`
    select column_name, is_nullable from information_schema.columns
    where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
    order by ordinal_position
  `;
}

describe('migration ledger PostgreSQL safety boundaries', () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      'pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f',
    )
      .withUsername('app')
      .withDatabase('postgres')
      .start();
    admin = postgres(container.getConnectionUri(), {
      max: 1,
      onnotice: () => undefined,
    });
    await admin`create role app_rls bypassrls`;
  });

  beforeEach(async () => {
    databaseName = `ledger_${crypto.randomUUID().replaceAll('-', '_')}`;
    await admin`create database ${admin(databaseName)}`;
    const url = new URL(container.getConnectionUri());
    url.pathname = `/${databaseName}`;
    databaseUrl = url.href;
    connection = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    vi.stubEnv('POSTGRES_URL', databaseUrl);
    // Load the CLI module only after its process-wide database locator is isolated.
    ({ runMigrate } = await import('./migrate.js'));
    migrationFolder = mkdtempSync(path.join(tmpdir(), 'llame-ledger-'));

    for (const name of [...KNOWN_LEGACY_MIGRATION_NAMES, NEW_MIGRATION]) {
      const directory = path.join(migrationFolder, name);
      mkdirSync(directory);
      writeFileSync(path.join(directory, 'migration.sql'), 'SELECT 1;');
    }

    writeFileSync(
      path.join(migrationFolder, 'notes.txt'),
      'Not a migration directory.',
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await connection.end();
    await admin`drop database ${admin(databaseName)} with (force)`;
    rmSync(migrationFolder, { recursive: true });
  });

  afterAll(async () => {
    await admin?.end();
    await container?.stop();
  });

  it('creates a fresh named ledger and rejects an old runner nameless insert', async () => {
    await prepare();
    expect(await columns()).toContainEqual({
      column_name: 'name',
      is_nullable: 'NO',
    });
    expect(await columns()).toContainEqual({
      column_name: 'applied_at',
      is_nullable: 'YES',
    });
    await expect(connection`
      insert into drizzle.__drizzle_migrations (hash, created_at) values ('old-runner', 1)
    `).rejects.toMatchObject({ code: '23502' });
  });

  it('converts the complete original ledger without merging the same-second entries', async () => {
    await createLegacyLedger(LEGACY_TIMESTAMPS);
    await prepare();

    const rows = await connection`
      select id, hash, created_at, name, applied_at from drizzle.__drizzle_migrations order by id
    `;

    expect(rows[36]).toEqual({
      id: 46,
      hash: 'legacy-hash',
      created_at: '1786610861660',
      name: '20260813084741_unique_fallen_one',
      applied_at: null,
    });
    expect(rows[37]).toEqual({
      id: 47,
      hash: 'legacy-hash',
      created_at: '1786610861661',
      name: '20260813084742_context_item_cutover',
      applied_at: null,
    });
    expect(rows.at(-1)).toEqual({
      id: 102,
      hash: 'legacy-hash',
      created_at: '1794495836901',
      name: '20261112150356_huge_hardball',
      applied_at: null,
    });
    expect(await columns()).toContainEqual({
      column_name: 'name',
      is_nullable: 'NO',
    });
  });

  it('leaves an unidentifiable legacy ledger unchanged', async () => {
    await createLegacyLedger([1_751_224_723_402, 1_751_226_944_555]);
    await expect(prepare()).rejects.toBeInstanceOf(Error);
    expect(await columns()).toEqual([
      { column_name: 'id', is_nullable: 'NO' },
      { column_name: 'hash', is_nullable: 'NO' },
      { column_name: 'created_at', is_nullable: 'YES' },
    ]);

    const rows =
      await connection`select id, hash, created_at from drizzle.__drizzle_migrations order by id`;

    expect(rows).toEqual([
      { id: 10, hash: 'legacy-hash', created_at: '1751224723402' },
      { id: 11, hash: 'legacy-hash', created_at: '1751226944555' },
    ]);
  });

  it('rolls back converted names and DDL with the caller transaction', async () => {
    await createLegacyLedger(FIRST_TWO_TIMESTAMPS);
    const failure = new Error('abort after conversion');
    await expect(
      withMigrationAdvisoryLock(connection, async (tx) => {
        await prepareMigrationLedger(tx, migrationFolder);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect((await columns()).map((column) => column.column_name)).toEqual([
      'id',
      'hash',
      'created_at',
    ]);
  });

  it('retains both converted and newly-applied named rows', async () => {
    await createNamedLedger();
    await connection`
      insert into drizzle.__drizzle_migrations (hash, created_at, name, applied_at)
      values ('converted', 1751224723402, '20250629191843_exotic_sleepwalker', null),
             ('new', 1234567, ${NEW_MIGRATION}, now())
    `;
    await prepare();

    const rows =
      await connection`select hash, name, applied_at is null as converted from drizzle.__drizzle_migrations order by id`;

    expect(rows).toEqual([
      {
        hash: 'converted',
        name: '20250629191843_exotic_sleepwalker',
        converted: true,
      },
      { hash: 'new', name: NEW_MIGRATION, converted: false },
    ]);
  });

  it.each(['unknown_migration', '20250629191843_exotic_sleepwalker'])(
    'rejects an inconsistent named row %s without modifying it',
    async (name) => {
      await createNamedLedger();
      await connection`
      insert into drizzle.__drizzle_migrations (hash, created_at, name, applied_at)
      values ('wrong', 1751226944554, ${name}, null)
    `;
      await expect(prepare()).rejects.toBeInstanceOf(Error);

      const rows =
        await connection`select hash, created_at, name, applied_at from drizzle.__drizzle_migrations`;

      expect(rows).toEqual([
        { hash: 'wrong', created_at: '1751226944554', name, applied_at: null },
      ]);
    },
  );

  it.each(['name text', 'applied_at timestamptz'])(
    'rejects a half-converted ledger with only %s',
    async (column) => {
      await createLegacyLedger(FIRST_TWO_TIMESTAMPS);
      await connection.unsafe(
        `alter table drizzle.__drizzle_migrations add column ${column}`,
      );
      const before = await columns();
      await expect(prepare()).rejects.toBeInstanceOf(Error);
      expect(await columns()).toEqual(before);
    },
  );

  it('rejects an unreadable local migration before creating a ledger', async () => {
    mkdirSync(path.join(migrationFolder, 'incomplete_migration'));
    await expect(prepare()).rejects.toMatchObject({ code: 'ENOENT' });

    const [row] =
      await connection`select to_regclass('drizzle.__drizzle_migrations') as ledger`;

    expect(row?.ledger).toBeNull();
  });

  it('enforces names after a caller temporarily relaxes the constraint', async () => {
    await prepare();
    await connection`alter table drizzle.__drizzle_migrations alter column name drop not null`;
    await enforceMigrationLedgerNameConstraint(connection);
    await expect(connection`
      insert into drizzle.__drizzle_migrations (hash, created_at) values ('old-runner', 1)
    `).rejects.toMatchObject({ code: '23502' });
  });

  it('holds the published advisory key and releases it with rollback', async () => {
    const competitor = postgres(databaseUrl, { max: 1 });
    const failure = new Error('rollback migration transaction');

    try {
      await expect(
        withMigrationAdvisoryLock(connection, async (tx) => {
          await tx`create table migration_transaction_probe (id integer)`;

          const [lock] =
            await competitor`select pg_try_advisory_xact_lock(1280065869, 1) as acquired`;

          expect(lock?.acquired).toBe(false);
          throw failure;
        }),
      ).rejects.toBe(failure);

      const [after] =
        await competitor`select pg_try_advisory_xact_lock(1280065869, 1) as acquired, to_regclass('migration_transaction_probe') as probe`;

      expect(after).toEqual({ acquired: true, probe: null });
    } finally {
      await competitor.end();
    }
  });

  it('locks the ledger before reading and rejecting unsafe history', async () => {
    await createLegacyLedger([1_751_224_723_403]);
    const reader = postgres(databaseUrl, { max: 1 });
    let settled = false;
    let migration: Promise<unknown> | undefined;

    try {
      await reader.begin(async (tx) => {
        await tx`lock table drizzle.__drizzle_migrations in access share mode`;
        migration = prepare().then(
          () => {
            settled = true;

            return undefined;
          },
          (error: unknown) => {
            settled = true;

            return error;
          },
        );
        await vi.waitFor(async () => {
          const [lock] = await tx`
            select exists(select 1 from pg_locks
              where relation = 'drizzle.__drizzle_migrations'::regclass
              and mode = 'AccessExclusiveLock' and not granted) as waiting
          `;

          expect(lock?.waiting).toBe(true);
          expect(settled).toBe(false);
        });
      });
      expect(await migration).toBeInstanceOf(Error);
    } finally {
      await reader.end();
      await migration;
    }
  });

  it('runs the entrypoint on a fresh database, preserves repeat identity, and closes its connection', async () => {
    await connection`create extension vector`;
    await runMigrate();

    const before =
      await connection`select name from drizzle.__drizzle_migrations order by id`;

    expect(before).toContainEqual({
      name: '20260813084742_context_item_cutover',
    });
    expect(before).toContainEqual({ name: '20261112150356_huge_hardball' });

    const [tables] =
      await connection`select to_regclass('public.runs') as runs, to_regclass('public.chat_jobs') as jobs`;

    expect(tables).toEqual({ runs: 'runs', jobs: 'chat_jobs' });
    await runMigrate();
    expect(
      await connection`select name from drizzle.__drizzle_migrations order by id`,
    ).toEqual(before);

    const [connections] =
      await connection`select count(*)::integer as count from pg_stat_activity where datname = current_database()`;

    expect(connections?.count).toBe(1);
  });

  it('rejects a missing locator without migrating through libpq defaults', async () => {
    await connection`create extension vector`;
    vi.stubEnv('POSTGRES_URL', '');
    vi.stubEnv('PGHOST', container.getHost());
    vi.stubEnv('PGPORT', String(container.getPort()));
    vi.stubEnv('PGUSER', container.getUsername());
    vi.stubEnv('PGPASSWORD', container.getPassword());
    vi.stubEnv('PGDATABASE', databaseName);
    await expect(runMigrate()).rejects.toBeInstanceOf(Error);

    const [row] =
      await connection`select to_regclass('drizzle.__drizzle_migrations') as ledger`;

    expect(row?.ledger).toBeNull();
  });
});
