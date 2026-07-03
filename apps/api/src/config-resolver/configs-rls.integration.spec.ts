/**
 * Configs RLS integration tests (#46) — same harness contract as the other
 * *.integration suites: TEST_DATABASE_URL, non-superuser owner role, FORCE.
 *
 * Covered:
 * - RLS ENABLED + FORCED on configs
 * - user scope: own rows only, cross-tenant write denied
 * - chat scope: chat owner only
 * - org_unit scope: members read, only owner/admin write, strangers nothing
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';
import type { ConfigService } from '@nestjs/config';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { IdentityService } from '../identity/identity.service';
import { ConfigsRepository } from './configs-repository';
import { ConfigResolverService } from './config-resolver.service';
import { snapshotModelAllowlist } from './effective-config';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

describeIfDb('Configs RLS integration — scope isolation under FORCE', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let identity: IdentityService;
  let ownerId: string;
  let memberId: string;
  let strangerId: string;
  let orgId: string;

  const asUser = (userId: string, fn: (tx: SqlClient) => Promise<any>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    identity = new IdentityService(tenantDb);

    ownerId = crypto.randomUUID();
    memberId = crypto.randomUUID();
    strangerId = crypto.randomUUID();
    for (const id of [ownerId, memberId, strangerId]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'Cfg', ${`cfg-${id}@test.com`})`;
    }
    const org = await identity.createRootOrg({
      userId: ownerId,
      name: 'CfgOrg',
    });
    orgId = org.id;
    await identity.grantMembership({
      callerId: ownerId,
      userId: memberId,
      orgUnitId: orgId,
      role: 'member',
    });
  });

  afterAll(async () => {
    if (sql) {
      await asUser(ownerId, async (tx) => {
        await tx`DELETE FROM configs WHERE scope_type = 'org_unit' AND scope_id = ${orgId}`;
        await tx`DELETE FROM org_units WHERE id = ${orgId}`;
      });
      await sql`DELETE FROM users WHERE id IN (${ownerId}, ${memberId}, ${strangerId})`;
      await sql.end();
    }
  });

  it('RLS is ENABLED + FORCED on configs', async () => {
    const [row] = await sql`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'configs'`;
    expect(row.relrowsecurity).toBe(true);
    expect(row.relforcerowsecurity).toBe(true);
  });

  it('resolveForUser exposes the caller OWN model allowlist, RLS-scoped (#85)', async () => {
    const resolver = new ConfigResolverService(
      { get: () => undefined } as unknown as ConfigService,
      tenantDb,
    );
    // Fresh, dedicated users so the seeded allowlist can't pollute the
    // clean-user assertions elsewhere in this suite.
    const withAllow = crypto.randomUUID();
    const without = crypto.randomUUID();
    for (const id of [withAllow, without]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'AL', ${`al-${id}@test.com`})`;
    }
    try {
      await tenantDb.runAs(withAllow, (tx) =>
        new ConfigsRepository(tx).upsert({
          scopeType: 'user',
          scopeId: withAllow,
          config: { models: { allowlist: ['gpt-4o'] } },
        }),
      );

      const own = await resolver.resolveForUser(withAllow);
      expect(snapshotModelAllowlist(own)).toEqual(['gpt-4o']);

      // A different user (no models config row) never sees that allowlist —
      // the user-scope row is RLS-scoped to its owner.
      const other = await resolver.resolveForUser(without);
      expect(snapshotModelAllowlist(other)).toBeUndefined();
    } finally {
      await sql`DELETE FROM users WHERE id IN (${withAllow}, ${without})`;
    }
  });

  it('user scope: own rows only; cross-tenant read and write denied', async () => {
    await tenantDb.runAs(ownerId, (tx) =>
      new ConfigsRepository(tx).upsert({
        scopeType: 'user',
        scopeId: ownerId,
        config: { run: { maxOutputTokens: 5 } },
      }),
    );

    const mine = await asUser(
      ownerId,
      (tx) => tx`SELECT scope_id FROM configs WHERE scope_type = 'user'`,
    );
    expect(mine.length).toBe(1);

    const theirs = await asUser(
      strangerId,
      (tx) => tx`SELECT scope_id FROM configs WHERE scope_type = 'user'`,
    );
    expect(theirs.length).toBe(0);

    await expect(
      asUser(
        strangerId,
        (tx) =>
          tx`INSERT INTO configs (scope_type, scope_id, config) VALUES ('user', ${ownerId}, '{"run":{"maxOutputTokens":1}}')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('chat scope: owner only', async () => {
    const chatId = crypto.randomUUID();
    await asUser(
      ownerId,
      (tx) =>
        tx`INSERT INTO chats (id, owner_user_id, title) VALUES (${chatId}, ${ownerId}, 'Cfg chat')`,
    );
    await tenantDb.runAs(ownerId, (tx) =>
      new ConfigsRepository(tx).upsert({
        scopeType: 'chat',
        scopeId: chatId,
        config: { compaction: { tokenThreshold: 400 } },
      }),
    );

    const visible = await asUser(
      strangerId,
      (tx) =>
        tx`SELECT id FROM configs WHERE scope_type = 'chat' AND scope_id = ${chatId}`,
    );
    expect(visible.length).toBe(0);

    await expect(
      asUser(
        strangerId,
        (tx) =>
          tx`INSERT INTO configs (scope_type, scope_id, config) VALUES ('chat', ${chatId}, '{}')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('org_unit scope: members read, only owner/admin write', async () => {
    await tenantDb.runAs(ownerId, (tx) =>
      new ConfigsRepository(tx).upsert({
        scopeType: 'org_unit',
        scopeId: orgId,
        config: { run: { maxOutputTokens: 900 } },
      }),
    );

    const memberRead = await asUser(
      memberId,
      (tx) =>
        tx`SELECT config FROM configs WHERE scope_type = 'org_unit' AND scope_id = ${orgId}`,
    );
    expect(memberRead.length).toBe(1);

    const strangerRead = await asUser(
      strangerId,
      (tx) =>
        tx`SELECT config FROM configs WHERE scope_type = 'org_unit' AND scope_id = ${orgId}`,
    );
    expect(strangerRead.length).toBe(0);

    // A plain member's UPDATE targets zero rows (write policy USING) — the
    // value must remain the owner's.
    await asUser(
      memberId,
      (tx) =>
        tx`UPDATE configs SET config = '{"run":{"maxOutputTokens":1}}' WHERE scope_type = 'org_unit' AND scope_id = ${orgId}`,
    );
    const after = await asUser(
      ownerId,
      (tx) =>
        tx`SELECT config FROM configs WHERE scope_type = 'org_unit' AND scope_id = ${orgId}`,
    );
    expect(after[0].config).toEqual({ run: { maxOutputTokens: 900 } });
  });

  it('setInstructions writes ONLY the instructions key (structural isolation)', async () => {
    // A pre-existing unrelated key in the user's own scope.
    await tenantDb.runAs(memberId, (tx) =>
      new ConfigsRepository(tx).upsert({
        scopeType: 'user',
        scopeId: memberId,
        config: { run: { maxOutputTokens: 42 } },
      }),
    );
    // setInstructions merges — it must NOT clobber `run`, and must NOT be able
    // to write anything but `instructions`.
    await tenantDb.runAs(memberId, (tx) =>
      new ConfigsRepository(tx).setInstructions({
        scopeType: 'user',
        scopeId: memberId,
        instructions: 'Be concise.',
      }),
    );
    const [row] = await asUser(
      memberId,
      (tx) =>
        tx`SELECT config FROM configs WHERE scope_type = 'user' AND scope_id = ${memberId}`,
    );
    expect(row.config).toEqual({
      run: { maxOutputTokens: 42 },
      instructions: 'Be concise.',
    });

    // Round-trip via the repo read the controller uses.
    const back = await tenantDb.runAs(memberId, (tx) =>
      new ConfigsRepository(tx).findByScopes([
        { scopeType: 'user', scopeId: memberId },
      ]),
    );
    expect(back[0]?.config).toMatchObject({ instructions: 'Be concise.' });
  });

  it('setInstructions cannot write another user’s scope (RLS)', async () => {
    // Establish a known instructions value on the owner's own scope.
    await tenantDb.runAs(ownerId, (tx) =>
      new ConfigsRepository(tx).setInstructions({
        scopeType: 'user',
        scopeId: ownerId,
        instructions: 'owner-set',
      }),
    );
    // A stranger attempting to write the owner's scope is denied (RLS WITH
    // CHECK; drizzle wraps the pg error, so match the code in the cause chain).
    let err: any;
    try {
      await tenantDb.runAs(strangerId, (tx) =>
        new ConfigsRepository(tx).setInstructions({
          scopeType: 'user',
          scopeId: ownerId, // not the caller
          instructions: 'pwned',
        }),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    let cur = err;
    let rls = false;
    while (cur) {
      if (
        cur.code === '42501' ||
        /row-level security/i.test(String(cur.message ?? ''))
      ) {
        rls = true;
        break;
      }
      cur = cur.cause;
    }
    expect(rls).toBe(true);
    // The isolation guarantee: the owner's value is untouched.
    const [row] = await asUser(
      ownerId,
      (tx) =>
        tx`SELECT config FROM configs WHERE scope_type = 'user' AND scope_id = ${ownerId}`,
    );
    expect(row.config.instructions).toBe('owner-set');
  });

  it('version increments on every upsert (provenance raw material)', async () => {
    const v1 = await tenantDb.runAs(ownerId, (tx) =>
      new ConfigsRepository(tx).upsert({
        scopeType: 'org_unit',
        scopeId: orgId,
        config: { run: { maxOutputTokens: 800 } },
      }),
    );
    const v2 = await tenantDb.runAs(ownerId, (tx) =>
      new ConfigsRepository(tx).upsert({
        scopeType: 'org_unit',
        scopeId: orgId,
        config: { run: { maxOutputTokens: 700 } },
      }),
    );
    expect(v2.version).toBe(v1.version + 1);
  });
});
