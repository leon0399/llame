import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { type Sql } from 'postgres';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatReadRepository } from './chat-read-repository';
import { readChatResource } from '../tools/chat-read';
import { type ToolContext } from '../tools/types';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (!TEST_DB_URL) {
  throw new Error(
    'TEST_DATABASE_URL is required for Chat reader integration tests',
  );
}

describe('Chat reader owner isolation', () => {
  let client: Sql;
  let db: Db;
  let tenantDb: TenantDbService;
  let owner: string;
  let foreign: string;
  let chatId: string;

  async function seed(ownerId: string, title: string | null): Promise<string> {
    const id = crypto.randomUUID();
    await tenantDb.runAs(ownerId, async (tx) => {
      await tx.execute(
        sql`INSERT INTO chats (id, owner_user_id, title) VALUES (${id}::uuid, ${ownerId}, ${title})`,
      );
      await tx.execute(sql`INSERT INTO messages (chat_id, seq, role, sender_user_id, parts) VALUES
        (${id}::uuid, 1, 'user', ${ownerId}, ${sql.param([{ type: 'text', text: 'A🙂\r\nβ' }])}::jsonb),
        (${id}::uuid, 2, 'system', NULL, ${sql.param([{ type: 'text', text: 'not visible' }])}::jsonb),
        (${id}::uuid, 3, 'assistant', NULL, ${sql.param([{ type: 'text', text: 'reply' }])}::jsonb)`);
    });

    return id;
  }

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    client = connect(TEST_DB_URL, {
      ssl: /sslmode=require/.test(TEST_DB_URL) ? 'require' : false,
      max: 3,
    });
    db = drizzle({ client });
    tenantDb = new TenantDbService(db);
    owner = crypto.randomUUID();
    foreign = crypto.randomUUID();

    for (const id of [owner, foreign])
      await client`INSERT INTO users (id, name, email) VALUES (${id}, 'reader', ${`${id}@reader.test`})`;
    chatId = await seed(owner, null);
  });

  afterAll(async () => {
    if (client) {
      for (const id of [owner, foreign])
        await client`DELETE FROM users WHERE id = ${id}`;
      await client.end();
    }
  });

  const context = (userId: string): ToolContext => ({
    userId,
    chatId,
    tenantDb,
    configuredCredentials: [],
  });

  it('reads only eligible source text under the trusted owner and returns closed foreign not-found', async () => {
    const own = await readChatResource(
      context(owner),
      'read',
      `chat://${chatId}/1`,
    );

    expect(own).toMatchObject({
      status: 'success',
      chatId,
      messageSeq: 1,
      role: 'user',
      lineCount: 2,
      nextMessageSeq: 3,
    });
    expect(own).toMatchObject({ content: '1: A🙂\r\n2: β' });
    expect(
      await readChatResource(context(owner), 'read', `chat://${chatId}/1:L2`),
    ).toMatchObject({ status: 'success', content: '2: β', lineCount: 2 });
    expect(JSON.stringify(own)).toContain('A🙂');
    expect(JSON.stringify(own)).not.toContain('not visible');
    expect(
      await readChatResource(context(foreign), 'read', `chat://${chatId}/1`),
    ).toMatchObject({ status: 'error', type: 'not_found' });

    const index = await readChatResource(
      context(owner),
      'read',
      `chat://${chatId}:M1-3`,
    );

    expect(index).toMatchObject({
      status: 'success',
      kind: 'chat-index',
      shownSeqRange: { startSeq: 1, endSeq: 3 },
    });
    expect(JSON.stringify(index)).toContain('reply');
    expect(JSON.stringify(index)).not.toContain('not visible');
  });
  it('fails closed under public identity even when given the real owner id', async () => {
    await tenantDb.runAs(owner, (tx) =>
      tx.execute(
        sql`UPDATE chats SET visibility = 'public' WHERE id = ${chatId}`,
      ),
    );

    const result = await tenantDb.runAsPublic(async (tx) => {
      const repository = new ChatReadRepository(tx);

      return {
        message: await repository.readMessage(chatId, owner, 1),
        index: await repository.listEligibleIndex(chatId, owner, { limit: 50 }),
        rows: await repository.readChatRows(owner, 0, 20),
        previous: await repository.previousEligibleSequences(
          chatId,
          owner,
          4,
          50,
        ),
        owns: await repository.ownsChat(chatId, owner),
        status: await repository.currentRunStatus(chatId, owner),
        maxSeq: await repository.maxCommittedSequence(chatId, owner),
      };
    });

    expect(result.message).toBeUndefined();
    expect(result.index).toEqual([]);
    expect(result.rows).toEqual({ rows: [], total: 0 });
    expect(result.previous).toEqual([]);
    expect(result.owns).toBe(false);
    expect(result.status).toBe('idle');
    expect(result.maxSeq).toBe(0);

    const publicRead = await tenantDb.runAsPublic((tx) =>
      tx.execute(sql`SELECT id FROM chats WHERE id = ${chatId}`),
    );

    expect([...publicRead]).toHaveLength(1);
  });

  it('keeps untrusted row fields from forging additional rows', async () => {
    const rowChat = await seed(owner, null);
    await tenantDb.runAs(owner, (tx) =>
      tx.execute(
        sql`UPDATE chats SET title = ${'A🙂\r\nTitle'}, workspace_root = NULL, workspace_executor_id = NULL WHERE id = ${rowChat}`,
      ),
    );

    const rowContext = { ...context(owner), chatId: rowChat };
    const result = await readChatResource(rowContext, 'read', 'chat://');

    if (result.status !== 'success')
      throw new Error('Expected an owned Chat collection.');

    expect(result.content).toMatch(/^Title: A🙂 +Title$/mu);
    expect(result.content).not.toContain('Title: A🙂\r\nTitle');
    expect(result.content).toContain('Workspace: unbound');
  });

  it('preserves canonical Workspace roots for distinct worktrees', async () => {
    const firstChat = await seed(owner, 'First worktree');
    const secondChat = await seed(owner, 'Second worktree');
    await tenantDb.runAs(owner, async (tx) => {
      await tx.execute(sql`UPDATE chats
        SET workspace_root = 'machine://host-a/work/trees/first',
            workspace_executor_id = 'host-a'
        WHERE id = ${firstChat}::uuid`);
      await tx.execute(sql`UPDATE chats
        SET workspace_root = 'machine://host-a/work/trees/second',
            workspace_executor_id = 'host-a'
        WHERE id = ${secondChat}::uuid`);
    });

    const listing = await tenantDb.runAs(owner, (tx) =>
      new ChatReadRepository(tx).readChatRows(owner, 0, 20),
    );

    expect(
      listing.rows.find((row) => row.chatId === firstChat)?.workspace,
    ).toBe('machine://host-a/work/trees/first');
    expect(
      listing.rows.find((row) => row.chatId === secondChat)?.workspace,
    ).toBe('machine://host-a/work/trees/second');
  });

  async function assertResourceRunStatus(
    chatId: string,
    expected: string,
  ): Promise<void> {
    const chatContext = { ...context(owner), chatId };

    const message = await readChatResource(
      chatContext,
      'read',
      `chat://${chatId}/1`,
    );

    const index = await readChatResource(
      chatContext,
      'read',
      `chat://${chatId}:M1-3`,
    );

    const collection = await readChatResource(chatContext, 'read', 'chat://');

    const listing = await tenantDb.runAs(owner, (tx) =>
      new ChatReadRepository(tx).readChatRows(owner, 0, 20),
    );

    expect(message).toMatchObject({ status: 'success', runStatus: expected });
    expect(index).toMatchObject({ status: 'success', runStatus: expected });

    if (collection.status !== 'success')
      throw new Error('Expected an owned Chat collection.');

    expect(collection.content).toMatch(
      new RegExp(
        `^chat://${chatId}\\n(?:(?!^chat://)[\\s\\S])*?^Run status: ${expected}$`,
        'mu',
      ),
    );
    expect(listing.rows.find((row) => row.chatId === chatId)?.runStatus).toBe(
      expected,
    );
  }

  it('reports only nonterminal status across Chat resource kinds', async () => {
    const cases = [
      { status: 'queued', expected: 'queued' },
      { status: 'running_model', expected: 'running_model' },
      { status: 'awaiting_jobs', expected: 'awaiting_jobs' },
      { status: 'awaiting_quota', expected: 'awaiting_quota' },
      { status: 'completed', expected: 'idle' },
      { status: 'failed', expected: 'idle' },
      { status: 'cancelled', expected: 'idle' },
      { status: 'expired', expected: 'idle' },
    ] as const;

    for (const { status, expected } of cases) {
      const statusChat = await seed(owner, 'Status source');
      await tenantDb.runAs(owner, async (tx) => {
        await tx.execute(sql`INSERT INTO runs (chat_id, user_id, model_id, status, created_at)
          VALUES (${statusChat}::uuid, ${owner}, 'system:test', ${status}::run_status, now() - interval '2 minutes')`);

        if (expected !== 'idle')
          await tx.execute(sql`INSERT INTO runs (chat_id, user_id, model_id, status, created_at)
            VALUES (${statusChat}::uuid, ${owner}, 'system:test', 'completed', now())`);
      });
      await assertResourceRunStatus(statusChat, expected);

      if (expected !== 'idle')
        await tenantDb.runAs(owner, (tx) =>
          tx.execute(sql`UPDATE runs SET status = 'completed'
            WHERE chat_id = ${statusChat}::uuid AND user_id = ${owner}
              AND status = ${status}::run_status`),
        );
    }
  });
  it('bounds index windows and discovers earlier eligible sequences without parts', async () => {
    const bulkChat = await seed(owner, 'Large index');

    const rows = Array.from({ length: 60 }, (_, index) => {
      const seq = index + 4;

      return sql`(${bulkChat}::uuid, ${seq}, 'user', ${owner}, ${sql.param([{ type: 'text', text: `bulk-${seq}` }])}::jsonb)`;
    });

    await tenantDb.runAs(owner, (tx) =>
      tx.execute(sql`INSERT INTO messages (chat_id, seq, role, sender_user_id, parts)
        VALUES ${sql.join(rows, sql`, `)}`),
    );

    const pages = await tenantDb.runAs(owner, async (tx) => {
      const repository = new ChatReadRepository(tx);

      const latest = await repository.listEligibleIndex(bulkChat, owner, {
        beforeSeq: 64,
        limit: 51,
      });

      const earlier = await repository.previousEligibleSequences(
        bulkChat,
        owner,
        latest[0]?.seq ?? 64,
        50,
      );

      return { latest, earlier };
    });

    expect(pages.latest).toHaveLength(51);
    expect(pages.latest[0]?.seq).toBe(13);
    expect(pages.latest.at(-1)?.seq).toBe(63);
    expect(pages.earlier.map(({ seq }) => seq)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 1,
    ]);
  });
  it('orders pins first, excludes archived collection rows, and allows direct archived reads', async () => {
    const pinnedChat = await seed(owner, 'Pinned row');
    const archivedChat = await seed(owner, 'Archived row');
    await tenantDb.runAs(owner, async (tx) => {
      await tx.execute(sql`INSERT INTO pins (user_id, item_type, item_id, position)
        VALUES (${owner}, 'chat', ${pinnedChat}::uuid, 0)`);
      await tx.execute(
        sql`UPDATE chats SET archived_at = now() WHERE id = ${archivedChat}::uuid`,
      );
    });

    const listing = await tenantDb.runAs(owner, (tx) =>
      new ChatReadRepository(tx).readChatRows(owner, 0, 20),
    );

    expect(listing.rows[0]?.chatId).toBe(pinnedChat);
    expect(listing.rows.some((row) => row.chatId === archivedChat)).toBe(false);
    expect(
      listing.rows.some((row) => row.chatId === chatId && row.title === null),
    ).toBe(true);
    await expect(
      tenantDb.runAs(owner, (tx) =>
        new ChatReadRepository(tx).readMessage(archivedChat, owner, 1),
      ),
    ).resolves.toMatchObject({ chatId: archivedChat, seq: 1 });
  });
  it('lists untitled owned Chats without resolving any Machine', async () => {
    const ownerContext = context(owner);

    const result = await readChatResource(ownerContext, 'read', 'chat://');
    expect(result).toMatchObject({ status: 'success', kind: 'directory' });
    expect(JSON.stringify(result)).toContain('Title: (untitled)');
    expect(JSON.stringify(result)).toContain('Opening: A🙂 β');
    expect(JSON.stringify(result)).toContain('Latest: reply');
  });
});
