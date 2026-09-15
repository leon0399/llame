/**
 * System-prompt receipt RLS integration tests — requires a real PostgreSQL
 * connection. Same harness contract as the sibling *-rls suites: set
 * TEST_DATABASE_URL to run, and the connecting role MUST be non-superuser and
 * ideally the table owner (a green run as the owner proves FORCE works).
 * Without TEST_DATABASE_URL every test here is skipped.
 *
 * Covered:
 * - RLS ENABLED *and* FORCED on system_prompt_receipts, with only the owner
 *   SELECT/INSERT policies
 * - a stored receipt is invisible to another owner and to an identity-absent
 *   scope
 * - another owner cannot forge a receipt row owned by someone else (INSERT
 *   WITH CHECK, 42501)
 * - a receipt can only bind a run of its own owner (composite FK, 23503)
 */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { RunsRepository } from './runs-repository';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';

// Keep this file a module so its top-level TEST_DB_URL/describeIfDb/SqlClient
// stay module-scoped, not globals that collide with the sibling *-rls suites.
export {};

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = Sql;

const receiptInput = (ownerUserId: string, runId: string) => ({
  ownerUserId,
  runId,
  attemptId: crypto.randomUUID(),
  source: 'model_override' as const,
  systemPrompt: 'Receipt prompt text',
  promptHash: 'receipt-prompt-hash',
});

describeIfDb(
  'System prompt receipt RLS — owner-scoped reads and writes under FORCE',
  () => {
    let sql: SqlClient;
    let db: Db;
    let tenantDb: TenantDbService;
    let ownerA: string;
    let ownerB: string;

    beforeAll(async () => {
      // Static import cannot work here: the driver must stay unloaded for
      // projects that only collect this file (sibling RLS suites share the
      // shape), while the type-only import of its client type is erased.
      const postgres = await import('postgres');
      const connect = postgres.default ?? postgres;
      const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
      sql = connect(TEST_DB_URL!, { ssl, max: 2 });
      db = drizzle(sql, { schema });
      tenantDb = new TenantDbService(db);

      ownerA = crypto.randomUUID();
      ownerB = crypto.randomUUID();
      for (const [id, name] of [
        [ownerA, 'Receipt Owner A'],
        [ownerB, 'Receipt Owner B'],
      ] as const) {
        await sql`INSERT INTO users (id, name, email) VALUES (${id}, ${name}, ${`receipt-${name.replaceAll(/\s/g, '-').toLowerCase()}-${id}@test.com`})`;
      }
    });

    afterAll(async () => {
      if (sql) {
        await sql`DELETE FROM users WHERE id IN (${ownerA}, ${ownerB})`;
        await sql.end();
      }
    });

    /** One owner's chat + user message + run, seeded under that owner's scope. */
    async function seedOwnedRun(owner: string) {
      return tenantDb.runAs(owner, async (tx) => {
        const chat = await new ChatsRepository(tx).create({
          ownerUserId: owner,
          title: 'Receipt RLS',
        });
        const message = await new MessagesRepository(tx).create({
          chatId: chat.id,
          role: 'user',
          senderUserId: owner,
          parts: [{ type: 'text', text: 'receipt rls' }],
        });
        return new RunsRepository(tx).create({
          chatId: chat.id,
          messageId: message.id,
          userId: owner,
          modelId: 'system:test',
        });
      });
    }

    it('runs under a meaningful role with receipt RLS enabled and forced, and only SELECT/INSERT policies', async () => {
      const [role] =
        await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);

      const [table] = await sql`
        SELECT relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname = 'system_prompt_receipts'`;
      expect(table.relrowsecurity).toBe(true);
      expect(table.relforcerowsecurity).toBe(true);

      const policies = await sql`
        SELECT policyname, cmd
        FROM pg_policies
        WHERE tablename = 'system_prompt_receipts'
        ORDER BY policyname`;
      expect(policies).toEqual([
        { policyname: 'system_prompt_receipts_owner_insert', cmd: 'INSERT' },
        { policyname: 'system_prompt_receipts_owner_select', cmd: 'SELECT' },
      ]);
    });

    it('hides a stored receipt from every other owner and from an identity-absent scope', async () => {
      const run = await seedOwnedRun(ownerA);
      const stored = await tenantDb.runAs(ownerA, (tx) =>
        new SystemPromptReceiptsRepository(tx).create(
          receiptInput(ownerA, run.id),
        ),
      );

      await tenantDb.runAs(ownerB, async (tx) => {
        const rows = await tx
          .select()
          .from(schema.systemPromptReceipts)
          .where(eq(schema.systemPromptReceipts.id, stored.id));
        expect(rows).toEqual([]);
        await expect(
          new SystemPromptReceiptsRepository(tx).findByOwnedRun(run.id, ownerB),
        ).resolves.toEqual([]);
      });

      // No identity in scope: the policy compares against a missing setting and
      // matches nothing, so the row stays invisible even to a raw read.
      const absentIdentity = await sql`
        SELECT id FROM system_prompt_receipts WHERE id = ${stored.id}`;
      expect(absentIdentity).toEqual([]);
    });

    it('refuses a receipt another owner forged for that owner', async () => {
      const run = await seedOwnedRun(ownerA);

      await expect(
        tenantDb.runAs(ownerB, (tx) =>
          new SystemPromptReceiptsRepository(tx).create(
            receiptInput(ownerA, run.id),
          ),
        ),
      ).rejects.toMatchObject({
        cause: { code: '42501' },
      });

      await tenantDb.runAs(ownerA, async (tx) => {
        await expect(
          new SystemPromptReceiptsRepository(tx).findByOwnedRun(run.id, ownerA),
        ).resolves.toEqual([]);
      });
    });

    it('binds a receipt to a run of the same owner and rejects a foreign run', async () => {
      const ownRun = await seedOwnedRun(ownerA);
      const foreignRun = await seedOwnedRun(ownerB);

      await tenantDb.runAs(ownerA, async (tx) => {
        await expect(
          new SystemPromptReceiptsRepository(tx).create(
            receiptInput(ownerA, ownRun.id),
          ),
        ).resolves.toMatchObject({ runId: ownRun.id, ownerUserId: ownerA });
      });

      await expect(
        tenantDb.runAs(ownerA, (tx) =>
          new SystemPromptReceiptsRepository(tx).create(
            receiptInput(ownerA, foreignRun.id),
          ),
        ),
      ).rejects.toMatchObject({
        cause: { code: '23503' },
      });
    });
  },
);
