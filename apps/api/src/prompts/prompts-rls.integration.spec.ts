/**
 * Prompt library RLS integration test — owner-scoped CRUD under FORCE RLS:
 * - a user CRUDs their own prompts; a cross-tenant read/update/delete is denied;
 * - UNIQUE(user_id, name) rejects a per-user duplicate but ALLOWS the same name
 *   across users; the name-slug + content CHECKs hold.
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  PROMPT_MAX_PER_USER,
  PromptsRepository,
  isPromptNameConflict,
} from './prompts-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

describeIfDb('prompt library RLS + constraints', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let a: string;
  let b: string;
  let c: string;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    a = crypto.randomUUID();
    b = crypto.randomUUID();
    c = crypto.randomUUID();
    for (const id of [a, b, c]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'P', ${`p-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a}, ${b}, ${c})`;
      await sql.end();
    }
  });

  it('owner CRUD round-trips (create, list, update, delete)', async () => {
    const created = await tenantDb.runAs(a, (tx) =>
      new PromptsRepository(tx).create(a, 'summarize', 'Summarize: '),
    );
    expect(created.name).toBe('summarize');

    const listed = await tenantDb.runAs(a, (tx) =>
      new PromptsRepository(tx).list(a),
    );
    expect(listed.map((p) => p.name)).toContain('summarize');

    const updated = await tenantDb.runAs(a, (tx) =>
      new PromptsRepository(tx).update(created.id, a, {
        content: 'Summarize concisely: ',
      }),
    );
    expect(updated?.content).toBe('Summarize concisely: ');

    expect(
      await tenantDb.runAs(a, (tx) =>
        new PromptsRepository(tx).delete(created.id, a),
      ),
    ).toBe(true);
  });

  it('a duplicate name for the SAME user is rejected; the SAME name for a DIFFERENT user is allowed', async () => {
    await tenantDb.runAs(a, (tx) =>
      new PromptsRepository(tx).create(a, 'dup', 'A body'),
    );
    // Same user, same name → unique violation.
    let conflict: unknown;
    try {
      await tenantDb.runAs(a, (tx) =>
        new PromptsRepository(tx).create(a, 'dup', 'A body 2'),
      );
    } catch (error) {
      conflict = error;
    }
    expect(isPromptNameConflict(conflict)).toBe(true);
    // Different user, same name → fine (namespaced per user).
    const bPrompt = await tenantDb.runAs(b, (tx) =>
      new PromptsRepository(tx).create(b, 'dup', 'B body'),
    );
    expect(bPrompt.name).toBe('dup');
  });

  it('a name differing only by case for the SAME user is also rejected (the composer menu matches case-insensitively)', async () => {
    await tenantDb.runAs(a, (tx) =>
      new PromptsRepository(tx).create(a, 'Standup', 'A body'),
    );
    let conflict: unknown;
    try {
      await tenantDb.runAs(a, (tx) =>
        new PromptsRepository(tx).create(a, 'standup', 'A body 2'),
      );
    } catch (error) {
      conflict = error;
    }
    expect(isPromptNameConflict(conflict)).toBe(true);
  });

  it('a cross-tenant read / update / delete is denied (RLS)', async () => {
    const mine = await tenantDb.runAs(a, (tx) =>
      new PromptsRepository(tx).create(a, 'private', 'my body'),
    );
    // B lists → does not see A's prompt.
    const bList = await tenantDb.runAs(b, (tx) =>
      new PromptsRepository(tx).list(b),
    );
    expect(bList.some((p) => p.id === mine.id)).toBe(false);
    // B update / delete → no-op (RLS scopes to owner).
    expect(
      await tenantDb.runAs(b, (tx) =>
        new PromptsRepository(tx).update(mine.id, b, { content: 'hacked' }),
      ),
    ).toBeUndefined();
    expect(
      await tenantDb.runAs(b, (tx) =>
        new PromptsRepository(tx).delete(mine.id, b),
      ),
    ).toBe(false);
    // A's prompt survives unchanged.
    const survivor = await tenantDb.runAs(a, (tx) =>
      new PromptsRepository(tx).list(a),
    );
    expect(survivor.find((p) => p.id === mine.id)?.content).toBe('my body');
  });

  it('the name-slug CHECK rejects whitespace/slashes (so /name matching is exact)', async () => {
    await expect(
      tenantDb.runAs(a, (tx) =>
        new PromptsRepository(tx).create(a, 'bad name', 'body'),
      ),
    ).rejects.toThrow();
  });

  it('the content CHECK rejects an oversized body', async () => {
    await expect(
      tenantDb.runAs(a, (tx) =>
        new PromptsRepository(tx).create(a, 'toobig', 'x'.repeat(8001)),
      ),
    ).rejects.toThrow();
  });

  it('the per-user cap holds under concurrent creates (lockUserForCreate serializes the check + insert)', async () => {
    // Fill user c to one below the cap, then fire several concurrent creates —
    // without the advisory lock, each request's countByUser() could read the
    // same pre-insert count and let more than one through, overshooting the cap.
    for (let i = 0; i < PROMPT_MAX_PER_USER - 1; i++) {
      await tenantDb.runAs(c, (tx) =>
        new PromptsRepository(tx).create(c, `filler-${i}`, 'body'),
      );
    }
    const attempt = (name: string) =>
      tenantDb.runAs(c, async (tx) => {
        const repo = new PromptsRepository(tx);
        await repo.lockUserForCreate(c);
        if ((await repo.countByUser(c)) >= PROMPT_MAX_PER_USER) {
          throw new Error('cap reached');
        }
        return repo.create(c, name, 'body');
      });
    const results = await Promise.allSettled([
      attempt('race-1'),
      attempt('race-2'),
      attempt('race-3'),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    expect(succeeded).toBe(1);
    const finalCount = await tenantDb.runAs(c, (tx) =>
      new PromptsRepository(tx).countByUser(c),
    );
    expect(finalCount).toBe(PROMPT_MAX_PER_USER);
  });
});
