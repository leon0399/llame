/**
 * machines_status over real Postgres: the RLS split (identity-less writes,
 * identity-only reads) and `GET /api/v1/machines` serving configured Machines
 * without disclosing their route.
 *
 * The role topology is the integration suite's (vitest.integration.global-setup.mts):
 * a NON-superuser, non-BYPASSRLS role that OWNS the table, which is what makes
 * the FORCE statements load-bearing — without them this suite would pass for the
 * wrong reason.
 *
 * Requires POSTGRES_URL to point at a migrated database; without it the suite is
 * skipped so offline `pnpm test` stays usable.
 */

import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { CoreInfraModule } from '../core-infra.module';
import * as schema from '../db/schema';
import { machinesStatus } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS, type LlameConfig } from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';

import { MachinesController } from './machines.controller';
import { MachinesModule } from './machines.module';
import { pgErrorCode } from '../db/pg-error';

import { MachinesStatusRepository } from './machines-status.repository';
import type { MachineContact } from './machines-status';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;
type SqlClient = ReturnType<typeof postgres>;

/** The route details that must never reach a response. */
const DESTINATION = 'box';
const KNOWN_HOSTS_FILE = '/etc/llame/machine_known_hosts';
const IDENTITY_FILE = '/etc/llame/machine_ed25519';

function machineConfig(): LlameConfig {
  return {
    ...BUILT_IN_DEFAULTS,
    machines: {
      ssh: { knownHostsFile: KNOWN_HOSTS_FILE, identityFile: IDENTITY_FILE },
      hosts: { devl: { destination: DESTINATION } },
    },
  };
}

function contact(overrides: Partial<MachineContact> = {}): MachineContact {
  return {
    name: 'devl',
    at: new Date('2026-10-18T12:00:00.000Z'),
    hubProtocolVersion: 1,
    daemonProtocolVersion: 1,
    daemonVersion: '0.0.1',
    roots: ['/srv/app'],
    ...overrides,
  };
}

d('machines_status RLS and GET /api/v1/machines', () => {
  let sql: SqlClient;
  let tenantDb: TenantDbService;
  let repository: MachinesStatusRepository;
  let controller: MachinesController;
  let closeModule: (() => Promise<void>) | undefined;
  let userId = '';

  beforeAll(async () => {
    sql = postgres(process.env.POSTGRES_URL!, { max: 6 });
    const db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    repository = new MachinesStatusRepository(db, tenantDb);

    const moduleRef = await Test.createTestingModule({
      imports: [CoreInfraModule, MachinesModule],
    })
      .overrideProvider(InstanceConfigService)
      .useValue({ config: machineConfig(), productUserAgent: 'llame/test' })
      .compile();
    closeModule = () => moduleRef.close();
    controller = moduleRef.get(MachinesController);

    userId = crypto.randomUUID();
    await sql`
      INSERT INTO users (id, name, email)
      VALUES (${userId}, 'Machines', ${`machines-${userId}@test.com`})
    `;
  });

  afterAll(async () => {
    if (closeModule !== undefined) await closeModule();
    if (sql) {
      await sql`DELETE FROM machines_status`;
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  beforeEach(async () => {
    // Through the repository: a plain identity-less DELETE is refused (the
    // system marker is what admits the writer), so the cleanup uses the same
    // system path the writers do.
    await repository.pruneExcept([]);
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
      WHERE relname = 'machines_status'
    `;
    expect(table.relrowsecurity).toBe(true);
    expect(table.relforcerowsecurity).toBe(true);
    expect(table.owner).toBe(role.current_user);

    const policies = await sql`
      SELECT polname, polcmd FROM pg_policy
      WHERE polrelid = 'machines_status'::regclass
      ORDER BY polname
    `;
    expect(policies.length).toBe(2);
    expect(policies[0]).toMatchObject({ polname: 'machines_status_authenticated_select' });
    expect(policies[1]).toMatchObject({ polname: 'machines_status_system_write' });
  });

  it('writes status from the identity-less system context', async () => {
    await repository.recordContact(contact());
    const rows = await repository.listForUser(userId, ['devl']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'devl',
      daemonVersion: '0.0.1',
      daemonProtocolVersion: 1,
      hubProtocolVersion: 1,
      roots: ['/srv/app'],
      lastFailureReason: null,
    });
    expect(rows[0]?.firstContactAt?.toISOString()).toBe('2026-10-18T12:00:00.000Z');
    expect(rows[0]?.lastContactAt?.toISOString()).toBe('2026-10-18T12:00:00.000Z');
  });

  it('keeps the last contact through a later failure, and records a failure-only Machine', async () => {
    await repository.recordContact(contact());
    await repository.recordContact(
      contact({
        at: new Date('2026-10-18T12:02:00.000Z'),
        failure: 'host_key_mismatch',
        daemonProtocolVersion: undefined,
        daemonVersion: undefined,
        roots: undefined,
      }),
    );
    await repository.recordContact(
      contact({ name: 'gpu', at: new Date('2026-10-18T12:03:00.000Z'), failure: 'auth_failed' }),
    );
    const rows = await repository.listForUser(userId, ['devl', 'gpu']);
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get('devl')).toMatchObject({
      lastFailureReason: 'host_key_mismatch',
      daemonVersion: '0.0.1',
    });
    expect(byName.get('devl')?.lastContactAt?.toISOString()).toBe(
      '2026-10-18T12:00:00.000Z',
    );
    // A Machine only ever failed: no contact, so nothing was "seen".
    expect(byName.get('gpu')?.lastContactAt).toBeNull();
    expect(byName.get('gpu')?.firstContactAt).toBeNull();
    expect(byName.get('gpu')?.lastFailureReason).toBe('auth_failed');
  });

  it('refuses a read without an identity, even for the table owner', async () => {
    await repository.recordContact(contact());
    const [count] = await sql`SELECT count(*)::int AS count FROM machines_status`;
    expect(count.count).toBe(0);
    // A plain identity-less WRITE is refused too: only the marked system
    // transaction (the repository) may write.
    await expect(
      sql`INSERT INTO machines_status (name, hub_protocol_version, last_contact_at)
          VALUES ('unmarked', 1, now())`,
    ).rejects.toThrow(/row-level security|policy/iu);
  });

  it('refuses a write from an authenticated user context', async () => {
    const insert = async (tx: Db): Promise<void> => {
      await tx.insert(machinesStatus).values({
        name: 'forged',
        hubProtocolVersion: 1,
        lastContactAt: new Date(),
      });
    };
    const refused = await tenantDb.runAs(userId, insert).catch((error: unknown) => error);
    // Drizzle wraps the driver error, so the SQLSTATE is the stable evidence.
    expect(pgErrorCode(refused)).toBe('42501');
    // Nothing was written by the refused attempt.
    expect(await repository.pruneExcept([])).toBe(0);
  });

  it('prunes the status of Machines no longer configured', async () => {
    await repository.recordContact(contact());
    await repository.recordContact(contact({ name: 'gpu' }));
    expect(await repository.pruneExcept(['devl'])).toBe(1);
    const rows = await repository.listForUser(userId, ['devl', 'gpu']);
    expect(rows.map((row) => row.name)).toEqual(['devl']);
    // With nothing configured, every row goes.
    expect(await repository.pruneExcept([])).toBe(1);
  });

  it('serves the Machines list with status and without the SSH route', async () => {
    await repository.recordContact(contact({ at: new Date() }));
    const body = await controller.list(userId);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      name: 'devl',
      status: 'online',
      failureReason: null,
      hubProtocolVersion: 1,
      daemonProtocolVersion: 1,
      daemonVersion: '0.0.1',
      roots: ['/srv/app'],
    });
    expect(body[0]?.lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u);
    const serialized = JSON.stringify(body);
    for (const secret of [DESTINATION, KNOWN_HOSTS_FILE, IDENTITY_FILE, '/etc/llame'])
      expect(serialized).not.toContain(secret);
  });

  it('reports an offline Machine with its reason and no last-seen time', async () => {
    await repository.recordContact(
      contact({ at: new Date(), failure: 'unreachable', daemonProtocolVersion: undefined }),
    );
    const body = await controller.list(userId);
    expect(body[0]).toMatchObject({
      name: 'devl',
      status: 'offline',
      lastSeenAt: null,
      failureReason: 'unreachable',
    });
  });
});
