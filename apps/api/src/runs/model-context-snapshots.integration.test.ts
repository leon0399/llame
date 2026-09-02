/**
 * Live Postgres proof for immutable effective-context tenancy. Requires the
 * same non-superuser, table-owning TEST_DATABASE_URL used by the RLS suite.
 */

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import {
  hashToolAvailabilityManifest,
  TOOL_AVAILABILITY_UNOBSERVED,
  TOOL_AVAILABILITY_UNOBSERVED_HASH,
} from '../tools/turn-tool-catalog';
import { RunsRepository } from './runs-repository';
import {
  ModelContextSnapshotConflictError,
  ModelContextSnapshotsRepository,
} from './model-context-snapshots.repository';
import { seedModelContextSnapshot } from './model-context-snapshot.test-fixture';
import { type EffectiveContextSnapshotInput } from './effective-context-resolver';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
// `postgres` is required lazily so the unit project never loads the driver at
// runtime, but a type-only import of its client type is erased and carries no
// runtime cost.
type SqlClient = Sql;

describeIfDb(
  'model context snapshots — FORCE RLS and immutable bindings',
  () => {
    let sql: SqlClient;
    let db: Db;
    let tenantDb: TenantDbService;
    let userA: string;
    let userB: string;

    beforeAll(async () => {
      const postgres = await import('postgres');
      const connect = postgres.default ?? postgres;
      const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
      sql = connect(TEST_DB_URL!, { ssl, max: 5 });
      db = drizzle(sql, { schema });
      tenantDb = new TenantDbService(db);
      userA = crypto.randomUUID();
      userB = crypto.randomUUID();
      await sql`INSERT INTO users (id, name, email) VALUES (${userA}, 'Snapshot A', ${`snapshot-a-${userA}@test.com`})`;
      await sql`INSERT INTO users (id, name, email) VALUES (${userB}, 'Snapshot B', ${`snapshot-b-${userB}@test.com`})`;
    });

    afterAll(async () => {
      if (sql) {
        await sql`DELETE FROM users WHERE id IN (${userA}, ${userB})`;
        await sql.end();
      }
    });

    it('runs under a meaningful role with snapshot RLS enabled and forced and only SELECT/INSERT policies', async () => {
      const [role] =
        await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);

      const [table] = await sql`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'model_context_snapshots'`;
      expect(table.relrowsecurity).toBe(true);
      expect(table.relforcerowsecurity).toBe(true);

      const policies = await sql`
      SELECT policyname, cmd
      FROM pg_policies
      WHERE tablename = 'model_context_snapshots'
      ORDER BY policyname`;
      expect(policies).toEqual([
        {
          policyname: 'model_context_snapshots_owner_insert',
          cmd: 'INSERT',
        },
        {
          policyname: 'model_context_snapshots_owner_select',
          cmd: 'SELECT',
        },
      ]);
    });

    it('reuses identical content only inside one owner and hides it cross-tenant', async () => {
      const a = await tenantDb.runAs(userA, async (tx) => {
        const first = await seedModelContextSnapshot(tx, userA, 'shared');
        const second = await seedModelContextSnapshot(tx, userA, 'shared');
        expect(second.id).toBe(first.id);
        return first;
      });
      const b = await tenantDb.runAs(userB, (tx) =>
        seedModelContextSnapshot(tx, userB, 'shared'),
      );
      expect(b.id).not.toBe(a.id);

      await tenantDb.runAs(userB, async (tx) => {
        const rows = await tx
          .select()
          .from(schema.modelContextSnapshots)
          .where(eq(schema.modelContextSnapshots.id, a.id));
        expect(rows).toEqual([]);
      });
    });

    it.each([
      ['prompt hash', { promptHash: 'stored-prompt-hash' }],
      ['tool hash', { toolHash: 'stored-tool-hash' }],
      ['system prompt', { systemPrompt: 'Stored prompt text' }],
      [
        'availability manifest',
        {
          toolAvailabilityManifest: {
            version: 1 as const,
            entries: [
              {
                id: 'stored-tool',
                state: 'available' as const,
                declarationHash: 'stored-declaration-hash',
              },
            ],
          },
        },
      ],
      [
        'tool declarations',
        {
          toolDeclarations: [
            {
              id: 'stored-tool',
              description: 'Stored declaration',
              inputSchema: { type: 'object' },
            },
          ],
        },
      ],
    ])(
      'rejects a unique-key collision whose stored %s differs',
      async (field, difference) => {
        const input: EffectiveContextSnapshotInput = {
          availabilityHash: 'collision-availability-hash',
          contentHash: `collision-${field}`,
          promptHash: 'requested-prompt-hash',
          toolHash: 'requested-tool-hash',
          source: 'model_override',
          systemPrompt: 'Requested prompt text',
          toolAvailabilityManifest: { version: 1, entries: [] },
          toolDeclarations: [],
        };

        await tenantDb.runAs(userA, async (tx) => {
          await tx
            .insert(schema.modelContextSnapshots)
            .values({ ownerUserId: userA, ...input, ...difference });

          await expect(
            new ModelContextSnapshotsRepository(tx).createOrReuse(userA, input),
          ).rejects.toBeInstanceOf(ModelContextSnapshotConflictError);
        });
      },
    );

    it('keeps an explicit historical v0 snapshot distinct from a newly authored v1 snapshot', async () => {
      const contentHash = 'same-content-across-availability-epochs';
      const historical = await tenantDb.runAs(userA, async (tx) => {
        const [snapshot] = await tx
          .insert(schema.modelContextSnapshots)
          .values({
            ownerUserId: userA,
            contentHash,
            availabilityHash: TOOL_AVAILABILITY_UNOBSERVED_HASH,
            promptHash: 'same-prompt-hash',
            toolHash: 'same-tool-hash',
            source: 'project_default',
            systemPrompt: 'same prompt',
            toolAvailabilityManifest: TOOL_AVAILABILITY_UNOBSERVED,
            toolDeclarations: [],
          })
          .returning();
        return snapshot;
      });

      const v1Manifest = { version: 1 as const, entries: [] as const };
      const v1Input = {
        contentHash,
        availabilityHash: hashToolAvailabilityManifest(v1Manifest),
        promptHash: 'same-prompt-hash',
        toolHash: 'same-tool-hash',
        source: 'project_default' as const,
        systemPrompt: 'same prompt',
        toolAvailabilityManifest: v1Manifest,
        toolDeclarations: [],
      };
      const authored = await tenantDb.runAs(userA, (tx) =>
        new ModelContextSnapshotsRepository(tx).createOrReuse(userA, v1Input),
      );
      const reused = await tenantDb.runAs(userA, (tx) =>
        new ModelContextSnapshotsRepository(tx).createOrReuse(userA, v1Input),
      );

      expect(authored.id).not.toBe(historical.id);
      expect(reused.id).toBe(authored.id);
      const rows = await tenantDb.runAs(userA, (tx) =>
        tx
          .select()
          .from(schema.modelContextSnapshots)
          .where(
            and(
              eq(schema.modelContextSnapshots.ownerUserId, userA),
              eq(schema.modelContextSnapshots.contentHash, contentHash),
              eq(schema.modelContextSnapshots.source, 'project_default'),
            ),
          ),
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.availabilityHash)).toEqual(
        expect.arrayContaining([
          TOOL_AVAILABILITY_UNOBSERVED_HASH,
          v1Input.availabilityHash,
        ]),
      );
    });

    it('denies forged inserts and owner updates/deletes, leaving contents unchanged', async () => {
      const snapshot = await tenantDb.runAs(userA, (tx) =>
        seedModelContextSnapshot(tx, userA, 'immutable'),
      );

      await expect(
        tenantDb.runAs(userB, (tx) =>
          tx.insert(schema.modelContextSnapshots).values({
            ownerUserId: userA,
            availabilityHash:
              '8c150f84f99edb30ec7fb866968b27db1bfc2d26e1be8a7e94ee61e565adf11e',
            contentHash: 'forged-content',
            promptHash: 'forged-prompt',
            toolHash: 'forged-tools',
            source: 'project_default',
            systemPrompt: 'forged prompt',
            toolAvailabilityManifest: {
              version: 0,
              state: 'unobserved',
            },
            toolDeclarations: [],
          }),
        ),
      ).rejects.toBeDefined();

      await tenantDb.runAs(userA, async (tx) => {
        const updated = await tx
          .update(schema.modelContextSnapshots)
          .set({ systemPrompt: 'mutated' })
          .where(eq(schema.modelContextSnapshots.id, snapshot.id))
          .returning();
        const deleted = await tx
          .delete(schema.modelContextSnapshots)
          .where(eq(schema.modelContextSnapshots.id, snapshot.id))
          .returning();
        expect(updated).toEqual([]);
        expect(deleted).toEqual([]);

        const [unchanged] = await tx
          .select()
          .from(schema.modelContextSnapshots)
          .where(eq(schema.modelContextSnapshots.id, snapshot.id));
        expect(unchanged.systemPrompt).toBe(snapshot.systemPrompt);
      });
    });

    it('binds an owned run and rejects a cross-owner snapshot reference', async () => {
      const aSnapshot = await tenantDb.runAs(userA, (tx) =>
        seedModelContextSnapshot(tx, userA, 'binding'),
      );

      const seedOwnerRun = async (owner: string, snapshotId: string) =>
        tenantDb.runAs(owner, async (tx) => {
          const chat = await new ChatsRepository(tx).create({
            ownerUserId: owner,
            title: 'Snapshot binding',
          });
          const message = await new MessagesRepository(tx).create({
            chatId: chat.id,
            role: 'user',
            senderUserId: owner,
            parts: [{ type: 'text', text: 'bind' }],
          });
          return new RunsRepository(tx).create({
            chatId: chat.id,
            messageId: message.id,
            userId: owner,
            modelId: 'system:test',
            modelContextSnapshotId: snapshotId,
          });
        });

      const run = await seedOwnerRun(userA, aSnapshot.id);
      expect(run.modelContextSnapshotId).toBe(aSnapshot.id);
      await expect(seedOwnerRun(userB, aSnapshot.id)).rejects.toBeDefined();

      await tenantDb.runAs(userA, async (tx) => {
        await expect(
          new ModelContextSnapshotsRepository(tx).findByOwnedRun(run.id, userA),
        ).resolves.toEqual(aSnapshot);
      });
      await tenantDb.runAs(userB, async (tx) => {
        await expect(
          new ModelContextSnapshotsRepository(tx).findByOwnedRun(run.id, userB),
        ).resolves.toBeUndefined();
      });
    });
  },
);
