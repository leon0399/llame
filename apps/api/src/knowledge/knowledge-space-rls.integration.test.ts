/** Real-Postgres RLS and owner-scoped multi-space repository coverage. */

import { eq, sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../db/schema';
import { knowledgeSpaces } from '../db/schema/knowledge-spaces';
import { TenantDbService } from '../db/tenant-db.service';
import { KnowledgeSpaceRepository } from './knowledge-space.repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const d = TEST_DB_URL ? describe : describe.skip;
type SqlClient = ReturnType<typeof postgres>;

d('Knowledge Space RLS and tenant repository', () => {
  let sql: SqlClient;
  let tenantDb: TenantDbService;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
      max: 6,
    });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    await sql`
      INSERT INTO users (id, name, email)
      VALUES
        (${userAId}, 'Knowledge A', ${`knowledge-a-${userAId}@test.com`}),
        (${userBId}, 'Knowledge B', ${`knowledge-b-${userBId}@test.com`})
    `;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
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
      SELECT c.relrowsecurity, c.relforcerowsecurity,
             pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c
      WHERE c.relname = 'knowledge_spaces'
    `;
    expect(table.relrowsecurity).toBe(true);
    expect(table.relforcerowsecurity).toBe(true);
    expect(table.owner).toBe(role.current_user);
  });

  it('allows same-owner duplicate names and concurrent independent IDs', async () => {
    const results = await Promise.all([
      tenantDb.runAs(userAId, (tx) =>
        new KnowledgeSpaceRepository(tx).create({
          knowledgeSpaceId: crypto.randomUUID(),
          ownerUserId: userAId,
          name: 'Personal',
        }),
      ),
      tenantDb.runAs(userAId, (tx) =>
        new KnowledgeSpaceRepository(tx).create({
          knowledgeSpaceId: crypto.randomUUID(),
          ownerUserId: userAId,
          name: 'Personal',
        }),
      ),
    ]);

    expect(results[0].knowledgeSpaceId).not.toBe(results[1].knowledgeSpaceId);
    expect(results[0].name).toBe('Personal');
    expect(results[1].name).toBe('Personal');
    const page = await tenantDb.runAs(userAId, (tx) =>
      new KnowledgeSpaceRepository(tx).listForOwnerPage(userAId, 1),
    );
    expect(page).toHaveLength(2);
  });

  it('traverses equal creation timestamps by the stable-ID tie-breaker', async () => {
    const createdAt = new Date('2026-08-23T12:00:00.123Z');
    const firstId = '00000000-0000-4000-8000-000000000001';
    const secondId = '00000000-0000-4000-8000-000000000002';
    await tenantDb.runAs(userBId, (tx) =>
      tx.insert(knowledgeSpaces).values([
        {
          knowledgeSpaceId: secondId,
          ownerUserId: userBId,
          name: 'Second',
          createdAt,
          updatedAt: createdAt,
        },
        {
          knowledgeSpaceId: firstId,
          ownerUserId: userBId,
          name: 'First',
          createdAt,
          updatedAt: createdAt,
        },
      ]),
    );

    const firstPage = await tenantDb.runAs(userBId, (tx) =>
      new KnowledgeSpaceRepository(tx).listForOwnerPage(userBId, 1),
    );
    expect(firstPage.map((row) => row.knowledgeSpaceId)).toEqual([
      firstId,
      secondId,
    ]);

    const secondPage = await tenantDb.runAs(userBId, (tx) =>
      new KnowledgeSpaceRepository(tx).listForOwnerPage(userBId, 1, {
        createdAt,
        id: firstId,
      }),
    );
    expect(secondPage.map((row) => row.knowledgeSpaceId)).toEqual([secondId]);
  });

  it('makes missing and other-owner IDs indistinguishable through owner predicates', async () => {
    const created = await tenantDb.runAs(userAId, (tx) =>
      new KnowledgeSpaceRepository(tx).create({
        knowledgeSpaceId: crypto.randomUUID(),
        ownerUserId: userAId,
        name: 'Private',
      }),
    );

    await expect(
      tenantDb.runAs(userBId, (tx) =>
        new KnowledgeSpaceRepository(tx).findByIdForOwner(
          created.knowledgeSpaceId,
          userBId,
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      tenantDb.runAs(userBId, (tx) =>
        new KnowledgeSpaceRepository(tx).updateName(
          created.knowledgeSpaceId,
          userBId,
          'Hijacked',
        ),
      ),
    ).resolves.toBeUndefined();

    const crossOwnerUpdate = await tenantDb.runAs(userBId, (tx) =>
      tx
        .update(knowledgeSpaces)
        .set({ name: 'Hijacked' })
        .where(eq(knowledgeSpaces.knowledgeSpaceId, created.knowledgeSpaceId))
        .returning(),
    );
    expect(crossOwnerUpdate).toHaveLength(0);
  });

  it('keeps a binding share lock through the compatibility lookup', async () => {
    let releaseLock!: () => void;
    let reportLocked!: () => void;
    let bindingSpaceId = '';
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });

    const binding = tenantDb.runAs(userAId, async (tx) => {
      const row = await new KnowledgeSpaceRepository(tx).findForOwnerForBinding(
        userAId,
      );
      expect(row).toBeDefined();
      if (row === undefined) {
        throw new Error('Expected an existing Knowledge Space');
      }
      bindingSpaceId = row.knowledgeSpaceId;
      reportLocked();
      await holdLock;
      return row;
    });
    await locked;

    const updateWhileLocked = tenantDb.runAs(userAId, async (tx) => {
      await tx.execute(drizzleSql`SET LOCAL lock_timeout = '100ms'`);
      return tx
        .update(knowledgeSpaces)
        .set({ name: 'Blocked' })
        .where(eq(knowledgeSpaces.knowledgeSpaceId, bindingSpaceId))
        .returning();
    });
    try {
      await expect(updateWhileLocked).rejects.toMatchObject({
        cause: { code: '55P03' },
      });
    } finally {
      releaseLock();
      await binding;
    }
  });

  it('fails closed with no identity even for the table owner', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_user_id', '', true)`;
        await tx`
          INSERT INTO knowledge_spaces (knowledge_space_id, owner_user_id, name)
          VALUES (${crypto.randomUUID()}, ${userAId}, 'forged')
        `;
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });
});
