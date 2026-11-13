import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sql, TransactionSql } from 'postgres';

/**
 * RC5 matches v0 rows to converted migration folders after truncating
 * `created_at` to whole seconds. That is ambiguous for idx 36/37, and a hash
 * match is not stable because historical migration comments were edited.
 * Keep the original journal's exact millisecond identity as the authority.
 * The folder names are the one-to-one names in the supplied v1 conversion.
 */
const LEGACY_MIGRATIONS = `
1751224723402|20250629191843_exotic_sleepwalker
1751226944554|20250629195544_minor_red_ghost
1751233460223|20250629214420_nervous_blink
1752640526507|20250716043526_modern_red_hulk
1752700000000|20250716210640_v01_chat_message_schema
1782735542694|20260629121902_bouncy_zarek
1782763011177|20260629195651_famous_adam_warlock
1782773757483|20260629225557_wise_paladin
1782776766411|20260629234606_smiling_rattler
1782949969476|20260701235249_cool_lenny_balinger
1783009440418|20260702162400_awesome_darkhawk
1783078013940|20260703112653_uneven_deathstrike
1783109328024|20260703200848_nappy_mole_man
1783109928024|20260703201848_reply_integrity_trigger
1783255441287|20260705124401_glamorous_speed_demon
1783290823804|20260705223343_curvy_molly_hayes
1783327535304|20260706084535_big_supernaut
1783337452496|20260706113052_clammy_clea
1783352181144|20260706153621_sticky_maverick
1783461593945|20260707215953_wealthy_violations
1783613237724|20260709160717_open_chameleon
1783784477273|20260711154117_aberrant_next_avengers
1783800869200|20260711201429_drop-project-org-unit-type
1783815906676|20260712002506_unique_carmella_unuscione
1783835529417|20260712055209_search_projection
1783900957382|20260713000237_rename_search_documents
1783953156806|20260713143236_drop_runs_heartbeat
1783986151725|20260713234231_stormy_wiccan
1784025316453|20260714103516_awesome_doctor_strange
1784382140622|20260718134220_flashy_infant_terrible
1785788118959|20260803201518_good_pixie
1786204865598|20260808160105_wild_longshot
1786376777038|20260810154617_perfect_wrecker
1786437612626|20260811084012_thankful_gwen_stacy
1786564546083|20260812195546_romantic_lake
1786568025805|20260812205345_nervous_apocalypse
1786610861660|20260813084741_unique_fallen_one
1786610861661|20260813084742_context_item_cutover
1787276312267|20260821013832_dry_shooting_star
1787441414285|20260822233014_curved_gwen_stacy
1787449712485|20260823014832_friendly_swarm
1787456234193|20260823033714_stormy_gorgon
1787474394168|20260823083954_embedding_report_function
1787514652090|20260823195052_yummy_sinister_six
1787601058259|20260824195058_organic_deathbird
1787658713444|20260825115153_naive_the_executioner
1787748989286|20260826125629_gifted_tigra
1787842440063|20260827145400_lowly_spirit
1787846049137|20260827155409_projection_coverage
1787847160558|20260827161240_projection_expected_document_count
1787847171981|20260827161251_projection_readiness_v2
1787848661189|20260827163741_projection_owner_repair_rls
1787849171724|20260827164611_projection_state_owner_repair_rls
1787920646176|20260828123726_flowery_nitro
1788195292823|20260831165452_timestamptz_auth_columns
1789317629442|20260913164029_past_agent_brand
1789325864145|20260913185744_misty_sunset_bain
1789326158428|20260913190238_groovy_overlord
1789326296675|20260913190456_ambitious_toro
1789377107588|20260914091147_great_iron_patriot
1790278145019|20260924192905_mark_usage_completeness
1790475692997|20260927022132_chubby_nightcrawler
1790545058899|20260927213738_short_wallflower
1791312334557|20261006184534_special_warbound
1791597006243|20261010015006_fixed_captain_flint
1791681871741|20261011012431_melodic_maggott
1791810430975|20261012130710_odd_ego
1791888400287|20261013104640_mixed_molten_man
1791888427173|20261013104707_org_unit_move_authority
1791890263589|20261013111743_round_patch
1792155371157|20261016125611_live_change_notify
1792188894225|20261016221454_certain_dreadnoughts
1792196141726|20261017001541_majestic_starhawk
1792351847914|20261018193047_outstanding_xorn
1792353078153|20261018195118_lyrical_luckman
1792424619000|20261019154339_machine_status_notify
1792819718103|20261024052838_familiar_fabian_cortez
1792861519718|20261024170519_sudden_micromacro
1792877668566|20261024213428_furry_shard
1793072820495|20261027034700_modern_magdalene
1793081156714|20261027060556_colossal_hellcat
1793641351360|20261102174231_large_paper_doll
1793643464055|20261102181744_organic_epoch
1793668173371|20261103010933_sloppy_barracuda
1793722215933|20261103161015_nasty_warstar
1794168836593|20261108201356_tiny_enchantress
1794168844624|20261108201404_chat_deliveries_notify
`.trim();

const legacyMigrationByMillis = new Map<number, string>(
  LEGACY_MIGRATIONS.split('\n').map((line) => {
    const separator = line.indexOf('|');

    return [
      Number(line.slice(0, separator)),
      line.slice(separator + 1),
    ] as const;
  }),
);

const legacyMillisByName = new Map<string, number>(
  [...legacyMigrationByMillis].map(([millis, name]) => [name, millis] as const),
);

const legacyIndexByMillis = new Map<number, number>(
  [...legacyMigrationByMillis.keys()].map(
    (millis, index) => [millis, index] as const,
  ),
);

export const KNOWN_LEGACY_MIGRATION_NAMES: ReadonlyArray<string> =
  Object.freeze([...legacyMigrationByMillis.values()]);

export async function convertLegacyLedgerRows(
  rows: ReadonlyArray<LegacyMigrationRow>,
  localMigrationNames: ReadonlySet<string>,
  addV1Columns: () => Promise<void>,
  assignNames: (
    rows: ReadonlyArray<{ id: number; name: string }>,
  ) => Promise<void>,
): Promise<void> {
  const conversion = planLegacyLedgerConversion(rows, localMigrationNames);
  await addV1Columns();
  await assignNames(conversion);
}

export type LegacyMigrationRow = {
  id: number;
  hash: string;
  created_at: string | number | null;
};

export type NamedMigrationRow = {
  id: number;
  hash: string;
  created_at: string | number | null;
  name: string | null;
  applied_at: string | null;
};

function assertCompleteLocalHistory(localNames: ReadonlySet<string>): void {
  for (const name of legacyMigrationByMillis.values()) {
    if (!localNames.has(name)) {
      throw new Error(
        `Cannot safely upgrade the Drizzle migration ledger: converted migration "${name}" is missing locally. Restore the complete converted migration history before retrying.`,
      );
    }
  }
}

function planOrderedLegacyRows(
  rows: ReadonlyArray<LegacyMigrationRow>,
  localNames: ReadonlySet<string>,
): ReadonlyArray<{ id: number; name: string }> {
  const ordered = [...rows].sort((a, b) => a.id - b.id);
  const seenIds = new Set<number>();
  const seenNames = new Set<string>();
  const result: Array<{ id: number; name: string }> = [];
  let previousIndex = -1;

  for (const row of ordered) {
    const millis = Number(row.created_at);
    const name = legacyMigrationByMillis.get(millis);

    if (!Number.isSafeInteger(row.id) || seenIds.has(row.id)) {
      throw new Error(
        'Cannot safely upgrade the Drizzle migration ledger: legacy row IDs are invalid or duplicated. No ledger changes were made.',
      );
    }

    if (name === undefined || !localNames.has(name)) {
      throw new Error(
        `Cannot safely upgrade the Drizzle migration ledger: legacy row ${row.id} has created_at=${String(row.created_at)}, which does not identify one exact historical migration. No ledger changes were made. Check out the complete matching migration history and retry; do not delete or re-stamp this row.`,
      );
    }

    const index = legacyIndexByMillis.get(millis);

    if (
      seenNames.has(name) ||
      index === undefined ||
      index !== previousIndex + 1
    ) {
      throw new Error(
        `Cannot safely upgrade the Drizzle migration ledger: legacy row ${row.id} duplicates or skips historical migration "${name}". No ledger changes were made. Review the database history before retrying.`,
      );
    }

    seenIds.add(row.id);
    seenNames.add(name);
    previousIndex = index;
    result.push({ id: row.id, name });
  }

  return result;
}

export function planLegacyLedgerConversion(
  rows: ReadonlyArray<LegacyMigrationRow>,
  localMigrationNames: ReadonlySet<string>,
): ReadonlyArray<{ id: number; name: string }> {
  assertCompleteLocalHistory(localMigrationNames);

  return planOrderedLegacyRows(rows, localMigrationNames);
}

export function assertNamedLedgerIsSafe(
  rows: ReadonlyArray<NamedMigrationRow>,
  localMigrationNames: ReadonlySet<string>,
): void {
  const seen = new Set<string>();

  for (const row of rows) {
    if (
      row.name === null ||
      !localMigrationNames.has(row.name) ||
      seen.has(row.name)
    ) {
      throw new Error(
        `Cannot safely run Drizzle migrations: the v1 migration ledger contains a missing, unknown, or duplicate migration name at row ${row.id} (name=${String(row.name)}). No migrations were run. Restore a consistent ledger/history before retrying; do not delete or rename rows automatically.`,
      );
    }

    if (row.applied_at === null) {
      const expectedMillis = legacyMillisByName.get(row.name);

      if (
        expectedMillis === undefined ||
        Number(row.created_at) !== expectedMillis
      ) {
        throw new Error(
          `Cannot safely run Drizzle migrations: v1 row ${row.id} is marked as converted (applied_at is null) but its exact legacy timestamp does not identify its name. No migrations were run; inspect the conversion before retrying.`,
        );
      }
    }

    seen.add(row.name);
  }
}

async function readLocalMigrationNames(
  migrationsFolder: string,
): Promise<Set<string>> {
  const entries = await readdir(migrationsFolder, { withFileTypes: true });

  const names = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        await access(join(migrationsFolder, entry.name, 'migration.sql'));

        return entry.name;
      }),
  );

  return new Set(names);
}

async function convertV0Ledger(
  tx: Sql,
  localNames: ReadonlySet<string>,
): Promise<void> {
  const legacyRows = await tx.unsafe<Array<LegacyMigrationRow>>(
    'select id, hash, created_at from drizzle.__drizzle_migrations order by id asc',
  );

  await convertLegacyLedgerRows(
    legacyRows,
    localNames,
    async () => {
      await tx.unsafe(
        'alter table drizzle.__drizzle_migrations add column name text, add column applied_at timestamp with time zone default now()',
      );
    },
    async (conversion) => {
      for (const { id, name } of conversion) {
        await tx.unsafe(
          'update drizzle.__drizzle_migrations set name = $1, applied_at = null where id = $2',
          [name, id],
        );
      }
    },
  );
}

async function validateV1Ledger(
  tx: Sql,
  localNames: ReadonlySet<string>,
): Promise<void> {
  const rows = await tx.unsafe<Array<NamedMigrationRow>>(
    'select id, hash, created_at, name, applied_at from drizzle.__drizzle_migrations order by id asc',
  );

  assertNamedLedgerIsSafe(rows, localNames);
}

async function enforceNameNotNull(tx: Sql): Promise<void> {
  await tx.unsafe(
    'alter table drizzle.__drizzle_migrations alter column name set not null',
  );
}

async function prepareExistingLedger(
  tx: Sql,
  localNames: ReadonlySet<string>,
): Promise<void> {
  const columnRows = await tx.unsafe<Array<{ column_name: string }>>(
    `select column_name from information_schema.columns
     where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`,
  );

  const columns = new Set(columnRows.map((row) => row.column_name));
  const hasName = columns.has('name');
  const hasAppliedAt = columns.has('applied_at');

  if (hasName !== hasAppliedAt) {
    throw new Error(
      'Cannot safely run Drizzle migrations: the migration ledger has only one of the v1 columns (name, applied_at). No migration was run. Inspect and repair the ledger manually before retrying.',
    );
  }

  if (hasName) {
    await validateV1Ledger(tx, localNames);
  } else {
    await convertV0Ledger(tx, localNames);
  }

  await enforceNameNotNull(tx);
}

export async function enforceMigrationLedgerNameConstraint(
  connection: Sql,
): Promise<void> {
  await enforceNameNotNull(connection);
}

/**
 * Upgrade a legacy ledger before RC5 sees it. RC5 matches historical timestamps
 * at second precision. This conversion reads and validates the complete plan
 * before making transactional DDL/DML changes. The caller holds the transaction
 * advisory lock through migration execution.
 */
export async function prepareMigrationLedger(
  connection: Sql,
  migrationsFolder: string,
): Promise<void> {
  const localNames = await readLocalMigrationNames(migrationsFolder);

  // Establish and lock the ledger before inspecting it: a v0 runner does not
  // take our advisory lock and could otherwise create it after the check.
  await connection.unsafe('create schema if not exists drizzle');
  await connection.unsafe(`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint,
      name text not null,
      applied_at timestamp with time zone default now()
    )
  `);
  await connection.unsafe(
    'lock table drizzle.__drizzle_migrations in access exclusive mode',
  );
  await prepareExistingLedger(connection, localNames);
}

export async function withMigrationAdvisoryLock(
  connection: Sql,
  run: (tx: TransactionSql) => Promise<void>,
): Promise<void> {
  const lockKey = 0x4c_4c_41_4d;
  const lockSubkey = 1;

  return connection.begin(async (tx) => {
    await tx.unsafe('select pg_advisory_xact_lock($1, $2)', [
      lockKey,
      lockSubkey,
    ]);

    return run(tx);
  });
}
