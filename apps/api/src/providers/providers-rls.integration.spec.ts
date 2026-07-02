/**
 * Provider vault RLS + resolution integration tests (#18) — same harness
 * contract as the other *.integration suites: TEST_DATABASE_URL,
 * non-superuser owner role, FORCE.
 *
 * Covered:
 * - RLS ENABLED + FORCED on provider_accounts / credentials
 * - create account + encrypted credential; ciphertext never contains the key
 * - resolution decrypts, reports byok source, stamps last_used_at
 * - disabled account and vault-off instance fail closed (null / 400)
 * - cross-tenant: accounts and credentials invisible; foreign credential
 *   insert onto another user's account denied
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { SecretString } from './credential-crypto';
import { ProvidersService } from './providers.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

const MASTER_KEYS = `1:${Buffer.alloc(32, 7).toString('base64')}`;

describeIfDb('Provider vault integration — BYOK under FORCE', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let providers: ProvidersService;
  let userAId: string;
  let userBId: string;

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
    // max: 5 (was 2). This suite mixes two pooled-connection patterns on the
    // same client — the `asUser` helper's raw `sql.begin()` and the service's
    // drizzle `db.transaction()` (via TenantDbService.runAs). At max: 2 those
    // can exhaust the pool and deadlock on connection acquisition (a
    // deterministic 5s-timeout hang under some driver/timing conditions);
    // modest headroom removes the contention. Test-only — production uses the
    // max: 1 runAs pattern and never mixes sql.begin with db.transaction.
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    providers = new ProvidersService(
      tenantDb,
      new ConfigService({ CREDENTIAL_MASTER_KEYS: MASTER_KEYS }),
    );

    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    for (const id of [userAId, userBId]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'Vault', ${`vault-${id}@test.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
  });

  it('RLS is ENABLED + FORCED on provider_accounts and credentials', async () => {
    const rows = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class WHERE relname IN ('provider_accounts', 'credentials')
      ORDER BY relname`;
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true);
      expect(r.relforcerowsecurity).toBe(true);
    }
  });

  let accountId: string;

  it('creates an account with an encrypted credential (no plaintext at rest)', async () => {
    const account = await providers.createUserAccount({
      userId: userAId,
      providerType: 'openai_compatible',
      displayName: 'My Router',
      apiKey: new SecretString('sk-vault-test-1234'),
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'openai/gpt-oss-20b:free',
    });
    accountId = account.id;

    const stored = await asUser(
      userAId,
      (tx) =>
        tx`SELECT encrypted_payload, key_version FROM credentials WHERE provider_account_id = ${accountId}`,
    );
    expect(stored.length).toBe(1);
    expect(stored[0].key_version).toBe(1);
    expect(stored[0].encrypted_payload).not.toContain('sk-vault-test-1234');
  });

  it('resolves the credential: decrypted key, byok source, last_used stamped', async () => {
    const resolved = await providers.resolveUserCredential(userAId);
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe('byok');
    expect(resolved!.apiKey.reveal()).toBe('sk-vault-test-1234');
    expect(resolved!.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(resolved!.model).toBe('openai/gpt-oss-20b:free');
    // The wrapper never leaks through serialization.
    expect(JSON.stringify(resolved)).not.toContain('sk-vault-test-1234');

    const [cred] = await asUser(
      userAId,
      (tx) =>
        tx`SELECT last_used_at FROM credentials WHERE provider_account_id = ${accountId}`,
    );
    expect(cred.last_used_at).not.toBeNull();
  });

  it('cross-tenant: B sees neither the account nor the credential', async () => {
    const accounts = await asUser(
      userBId,
      (tx) => tx`SELECT id FROM provider_accounts`,
    );
    expect(accounts.length).toBe(0);
    const creds = await asUser(userBId, (tx) => tx`SELECT id FROM credentials`);
    expect(creds.length).toBe(0);
    expect(await providers.resolveUserCredential(userBId)).toBeNull();
  });

  it("cross-tenant: B cannot attach a credential to A's account", async () => {
    await expect(
      asUser(
        userBId,
        (tx) =>
          tx`INSERT INTO credentials (provider_account_id, secret_type, encrypted_payload, key_version)
             VALUES (${accountId}, 'api_key', 'v1.x.y.z', 1)`,
      ),
    ).rejects.toThrow(/row-level security|violates foreign key/i);
  });

  it('a disabled account fails closed (resolution returns null)', async () => {
    await asUser(
      userAId,
      (tx) =>
        tx`UPDATE provider_accounts SET enabled = false WHERE id = ${accountId}`,
    );
    expect(await providers.resolveUserCredential(userAId)).toBeNull();
    await asUser(
      userAId,
      (tx) =>
        tx`UPDATE provider_accounts SET enabled = true WHERE id = ${accountId}`,
    );
  });

  it('vault-off instance: create rejects clearly, resolution is null', async () => {
    const vaultless = new ProvidersService(tenantDb, new ConfigService({}));
    await expect(
      vaultless.createUserAccount({
        userId: userAId,
        providerType: 'openai_compatible',
        displayName: 'Nope',
        apiKey: new SecretString('sk-x'),
      }),
    ).rejects.toThrow(/CREDENTIAL_MASTER_KEYS/);
    expect(await vaultless.resolveUserCredential(userAId)).toBeNull();
  });

  it('delete removes the account and cascades its credentials', async () => {
    await providers.removeUserAccount(userAId, accountId);
    const creds = await asUser(userAId, (tx) => tx`SELECT id FROM credentials`);
    expect(creds.length).toBe(0);
    expect(await providers.resolveUserCredential(userAId)).toBeNull();
  });
});
