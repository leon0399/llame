/**
 * machine_bindings over real Postgres: the installation's name-to-instance-id
 * binding is ENABLED and FORCED for the table-owning non-bypass role, only the
 * marked system context can read or write it, the status prune leaves it
 * alone, and `forget` hands the name back to a fresh bind.
 *
 * The role topology is the integration suite's
 * (vitest.integration.global-setup.mts): a NON-superuser, non-BYPASSRLS role
 * that OWNS the table, which is what makes the FORCE statement load-bearing —
 * without it this suite would pass for the wrong reason.
 *
 * Requires POSTGRES_URL to point at a migrated database; without it the suite
 * is skipped so offline `pnpm test` stays green.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { TenantDbService } from '../db/tenant-db.service';
import { pgErrorCode } from '../db/pg-error';

import { MachineBindingsRepository } from './machine-bindings.repository';
import { MachinesStatusRepository } from './machines-status.repository';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

type SqlClient = Sql;

/** The name every test in this suite uses; the binding is keyed by it. */
const NAME = 'integration-bind';
const FIRST_ID = '00000000-0000-4000-8000-0000000000a1';
const SECOND_ID = '00000000-0000-4000-8000-0000000000a2';

d('machine_bindings RLS and the bind lifecycle', () => {
  let sql: SqlClient;
  let bindings: MachineBindingsRepository;
  let status: MachinesStatusRepository;

  beforeAll(() => {
    sql = postgres(process.env.POSTGRES_URL!, { max: 4 });
    const db = drizzle({ client: sql });

    bindings = new MachineBindingsRepository(db);
    status = new MachinesStatusRepository(db, new TenantDbService(db));
  });

  afterAll(async () => {
    // Through the repositories: a plain identity-less statement is filtered to
    // nothing by the system policy.
    if (bindings !== undefined) await bindings.forget(NAME);

    if (status !== undefined) await status.pruneExcept([]);

    if (sql) await sql.end();
  });

  beforeEach(async () => {
    await bindings.forget(NAME);
    await status.pruneExcept([]);
  });

  it('is ENABLED and FORCED for the table-owning non-bypass role', async () => {
    const [role] = await sql`
      SELECT current_user, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;

    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const [table] = await sql`
      SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner
      FROM pg_class
      WHERE relname = 'machine_bindings'
    `;

    expect(table.relrowsecurity).toBe(true);
    expect(table.relforcerowsecurity).toBe(true);
    expect(table.owner).toBe(role.current_user);

    const policies = await sql`
      SELECT polname, polcmd FROM pg_policy
      WHERE polrelid = 'machine_bindings'::regclass
      ORDER BY polname
    `;

    // One policy only: the system writer. An authenticated user can neither
    // read an instance id nor change a binding.
    expect(policies).toEqual([
      // `*` is `FOR ALL`, the one predicate on using and with check.
      { polname: 'machine_bindings_system_write', polcmd: '*' },
    ]);
  });

  it('binds once, then matches the same id and refuses another', async () => {
    await expect(bindings.bindOrCompare(NAME, FIRST_ID)).resolves.toBe('bound');
    await expect(bindings.bindOrCompare(NAME, FIRST_ID)).resolves.toBe('match');
    await expect(bindings.bindOrCompare(NAME, SECOND_ID)).resolves.toBe(
      'mismatch',
    );
  });

  it('keeps the binding when the status of the Machine is pruned', async () => {
    await bindings.bindOrCompare(NAME, FIRST_ID);
    await status.recordContact({
      name: NAME,
      at: new Date('2026-11-21T10:00:00.000Z'),
      hubProtocolVersion: 2,
      daemonProtocolVersion: 2,
      daemonVersion: '0.1.0',
      roots: ['/srv/app'],
    });

    // Pruning every status row is what a removed-and-re-added name does; the
    // binding must survive it (spec "A removed and re-added name keeps its
    // binding").
    expect(await status.pruneExcept([])).toBe(1);
    await expect(bindings.bindOrCompare(NAME, FIRST_ID)).resolves.toBe('match');
  });

  it('forgets the id it held and binds afresh on the next handshake', async () => {
    await bindings.bindOrCompare(NAME, FIRST_ID);
    await expect(bindings.forget(NAME)).resolves.toBe(FIRST_ID);
    // A second forget finds nothing to remove.
    await expect(bindings.forget(NAME)).resolves.toBeUndefined();
    await expect(bindings.bindOrCompare(NAME, SECOND_ID)).resolves.toBe(
      'bound',
    );
  });

  it('hides the row from an unmarked read and refuses an unmarked write', async () => {
    await bindings.bindOrCompare(NAME, FIRST_ID);

    const [visible] =
      await sql`SELECT count(*)::int AS count FROM machine_bindings`;

    expect(visible.count).toBe(0);

    // A plain identity-less DELETE is filtered to nothing, so the binding is
    // still there afterwards.
    await sql`DELETE FROM machine_bindings WHERE name = ${NAME}`;
    await expect(bindings.bindOrCompare(NAME, FIRST_ID)).resolves.toBe('match');

    const refused = await sql`
      INSERT INTO machine_bindings (name, instance_id)
      VALUES ('unmarked-bind', ${SECOND_ID})
    `.catch((error: unknown) => error);

    // Drizzle/postgres.js wrap the driver error differently per path, so the
    // SQLSTATE is the stable evidence.
    expect(pgErrorCode(refused)).toBe('42501');
  });
});
