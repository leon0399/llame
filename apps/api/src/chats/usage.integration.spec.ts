/**
 * Usage aggregation on a live DB — the numbers are right AND owner-scoped:
 * - sums ONLY the caller's own turns; another user's turns (incl a PUBLIC
 *   chat's) are excluded (the sharing policy is gated on current_user='');
 * - a null-cost turn is counted as unknown, not in the cost sum;
 * - byModel/byDay group correctly; user (non-usage) turns are ignored.
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
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { UsageRepository } from './usage-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

const text = (t: string) => [{ type: 'text', text: t }];

describeIfDb('usage aggregation', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let a: string;
  let b: string;

  // Seed a completed turn (user + assistant with `usage`) in a chat.
  const seedTurn = async (
    owner: string,
    chatId: string,
    usage: Record<string, unknown> | null,
  ): Promise<void> => {
    await tenantDb.runAs(owner, async (tx) => {
      const messages = new MessagesRepository(tx);
      const user = await messages.create({
        chatId,
        role: 'user',
        senderUserId: owner,
        parts: text('q'),
      });
      await messages.create({
        chatId,
        role: 'assistant',
        senderUserId: null,
        parts: text('a'),
        inReplyTo: user.id,
        usage,
      });
    });
  };

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
    for (const id of [a, b]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'U', ${`u-${id}@t.com`})`;
    }

    const aChat = crypto.randomUUID();
    await tenantDb.runAs(a, (tx) =>
      new ChatsRepository(tx).createIfAbsent({ id: aChat, ownerUserId: a }),
    );
    // A: a known-cost turn + an unknown-cost turn (same model).
    await seedTurn(a, aChat, {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: 0.05,
      model: 'gpt-x',
      provider: 'openai',
    });
    await seedTurn(a, aChat, {
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
      costUsd: null,
      model: 'gpt-x',
      provider: 'openai',
    });

    // B: a big-spend turn in a PUBLIC chat — must NOT leak into A's summary.
    const bChat = crypto.randomUUID();
    await tenantDb.runAs(b, (tx) =>
      new ChatsRepository(tx).createIfAbsent({ id: bChat, ownerUserId: b }),
    );
    await tenantDb.runAs(b, (tx) =>
      new ChatsRepository(tx).update(bChat, b, { visibility: 'public' }),
    );
    await seedTurn(b, bChat, {
      inputTokens: 500,
      outputTokens: 500,
      totalTokens: 1000,
      costUsd: 9.99,
      model: 'gpt-x',
      provider: 'openai',
    });
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a}, ${b})`;
      await sql.end();
    }
  });

  it("sums only the caller's own turns (excludes another user's PUBLIC chat)", async () => {
    const summary = await tenantDb.runAs(a, (tx) =>
      new UsageRepository(tx).summary(a, 30),
    );
    // 30 + 5 tokens; only the 0.05 cost is known; the null-cost turn is unknown.
    expect(summary.total.totalTokens).toBe(35);
    expect(summary.total.inputTokens).toBe(13);
    expect(summary.total.costUsd).toBeCloseTo(0.05, 5);
    expect(summary.total.turnsWithKnownCost).toBe(1);
    expect(summary.total.turnsWithUnknownCost).toBe(1);
    // B's 1000 tokens / $9.99 are NOT here.
    expect(summary.total.totalTokens).not.toBe(1035);
  });

  it('groups by model and by day', async () => {
    const summary = await tenantDb.runAs(a, (tx) =>
      new UsageRepository(tx).summary(a, 30),
    );
    expect(summary.byModel).toHaveLength(1);
    expect(summary.byModel[0]).toMatchObject({
      model: 'gpt-x',
      provider: 'openai',
      totalTokens: 35,
    });
    expect(summary.byModel[0].costUsd).toBeCloseTo(0.05, 5);
    expect(summary.byDay.length).toBeGreaterThanOrEqual(1);
    expect(summary.byDay.reduce((s, d) => s + d.totalTokens, 0)).toBe(35);
  });

  it("B's own summary sees B's turn, not A's", async () => {
    const summary = await tenantDb.runAs(b, (tx) =>
      new UsageRepository(tx).summary(b, 30),
    );
    expect(summary.total.totalTokens).toBe(1000);
    expect(summary.total.costUsd).toBeCloseTo(9.99, 5);
  });
});
