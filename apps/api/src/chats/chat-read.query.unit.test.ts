import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatReadRepository } from './chat-read-repository';

async function readSqlFixture(stagedName: string, sourcePath: string) {
  const stagedDirectory = process.env.LLAME_STRYKER_SQL_FIXTURE_DIR;

  if (stagedDirectory)
    return readFile(path.resolve(stagedDirectory, stagedName), 'utf8');

  return readFile(path.resolve(process.cwd(), 'src/chats', sourcePath), 'utf8');
}

describe('ChatReadRepository PostgreSQL query', () => {
  let container: StartedPostgreSqlContainer;
  let client: Sql;
  let db: Db;
  let tenantDb: TenantDbService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      'pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f',
    ).start();
    const containerUri = container.getConnectionUri();
    const clusterAdmin = postgres(containerUri, { max: 1 });

    try {
      await clusterAdmin.unsafe(
        `CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
      );
      await clusterAdmin.unsafe(
        `CREATE ROLE app_rls WITH NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE`,
      );
      await clusterAdmin.unsafe(`CREATE DATABASE llame_test OWNER app`);
    } finally {
      await clusterAdmin.end();
    }

    const databaseUri = new URL(containerUri);
    databaseUri.pathname = '/llame_test';
    const superuser = postgres(databaseUri.href, { max: 1 });

    try {
      await superuser.unsafe(
        await readSqlFixture(
          '03-vector-extension.sql',
          '../../../../docker/postgres/initdb/03-vector-extension.sql',
        ),
      );
      await superuser.unsafe(`ALTER SCHEMA public OWNER TO app`);
    } finally {
      await superuser.end();
    }

    const appUrl = new URL(databaseUri.href);
    appUrl.username = 'app';
    appUrl.password = 'app';
    const migrator = postgres(appUrl.href, { max: 1 });

    try {
      await migrate(drizzle({ client: migrator }), {
        migrationsFolder: path.resolve(process.cwd(), 'src/db/migrations'),
      });
    } finally {
      await migrator.end();
    }

    const ownerFixup = postgres(databaseUri.href, { max: 1 });

    try {
      await ownerFixup.unsafe(
        await readSqlFixture(
          'rls-function-owner.sql',
          '../../../../docker/postgres/rls-function-owner.sql',
        ),
      );
    } finally {
      await ownerFixup.end();
    }

    client = postgres(appUrl.href, { max: 4 });
    db = drizzle({ client });
    tenantDb = new TenantDbService(db);
  }, 300_000);

  afterAll(async () => {
    try {
      await client?.end();
    } finally {
      await container?.stop();
    }
  });

  async function seedUser(): Promise<string> {
    const owner = crypto.randomUUID();
    await client`INSERT INTO users (id, name, email)
      VALUES (${owner}, 'Chat read query owner', ${`${owner}@reader-query.test`})`;

    return owner;
  }

  async function seedChat(
    ownerUserId: string,
    title: string | null,
    updatedAt = new Date(),
  ): Promise<string> {
    const chatId = crypto.randomUUID();
    await tenantDb.runAs(ownerUserId, (tx) =>
      tx.execute(sql`INSERT INTO chats (id, owner_user_id, title, updated_at)
        VALUES (${chatId}::uuid, ${ownerUserId}, ${title}, ${updatedAt.toISOString()}::timestamptz)`),
    );

    return chatId;
  }

  async function seedMessage(
    ownerUserId: string,
    chatId: string,
    seq: number,
    message: {
      role: 'user' | 'assistant' | 'system';
      text: string;
      usage?: unknown;
      revised?: boolean;
    },
  ): Promise<void> {
    const { role, text } = message;
    const usage = message.usage ?? null;
    await tenantDb.runAs(ownerUserId, (tx) =>
      tx.execute(sql`INSERT INTO messages (chat_id, seq, role, sender_user_id, parts, usage, revised_at)
        VALUES (
          ${chatId}::uuid,
          ${seq},
          ${role}::message_role,
          ${role === 'user' ? ownerUserId : null},
          ${sql.param([{ type: 'text', text }])}::json,
          ${usage === null ? null : sql.param(usage)}::jsonb,
          ${message.revised ? sql`now()` : null}
        )`),
    );
  }

  it('renders canonical Workspace affinity without interpreting unsupported stored roots as Machines', async () => {
    const owner = await seedUser();

    const cases = [
      { root: null, executor: null, expected: 'unbound' },
      {
        root: 'machine://build/repo',
        executor: 'other',
        expected: 'machine://build/repo',
      },
      { root: '/repo', executor: 'build', expected: 'machine://build/repo' },
      { root: '/repo', executor: null, expected: 'unbound' },
      { root: '//repo', executor: 'build', expected: 'unbound' },
      { root: './repo', executor: 'build', expected: 'unbound' },
      {
        root: 'machine://build/repo:L2',
        executor: 'build',
        expected: 'unbound',
      },
    ];

    const expected: Array<{
      chatId: string;
      workspace: string;
      locator: string;
    }> = [];

    for (const entry of cases) {
      const chatId = await seedChat(owner, 'Workspace source');
      await seedMessage(owner, chatId, 1, {
        role: 'user',
        text: 'visible source',
      });
      await tenantDb.runAs(owner, (tx) =>
        tx.execute(sql`
        UPDATE chats SET workspace_root = ${entry.root}, workspace_executor_id = ${entry.executor}
        WHERE id = ${chatId}::uuid AND owner_user_id = ${owner}
      `),
      );
      expected.push({
        chatId,
        workspace: entry.expected,
        locator: `chat://${chatId}`,
      });
    }

    const page = await tenantDb.runAs(owner, (tx) =>
      new ChatReadRepository(tx).readChatRows(owner, 0, 20),
    );

    for (const entry of expected)
      expect(
        page.rows.find(({ chatId }) => chatId === entry.chatId),
      ).toMatchObject(entry);
  });

  it('counts eligible owned chats and messages while ordering pins before recent activity', async () => {
    const owner = await seedUser();
    const foreign = await seedUser();

    const pinned = await seedChat(
      owner,
      'Pinned',
      new Date('2025-01-01T00:00:00.000Z'),
    );

    const recent = await seedChat(
      owner,
      'Recent',
      new Date('2026-01-01T00:00:00.000Z'),
    );

    const archived = await seedChat(
      owner,
      'Archived',
      new Date('2027-01-01T00:00:00.000Z'),
    );

    const foreignChat = await seedChat(foreign, 'Foreign');

    await seedMessage(owner, pinned, 1, { role: 'user', text: 'opening' });
    await seedMessage(owner, pinned, 2, {
      role: 'assistant',
      text: 'latest completed',
    });
    await seedMessage(owner, pinned, 3, {
      role: 'assistant',
      text: 'still running',
      usage: { status: 'running' },
    });
    await seedMessage(owner, pinned, 4, {
      role: 'assistant',
      text: 'revised',
      revised: true,
    });
    await seedMessage(owner, recent, 1, {
      role: 'user',
      text: 'recent opening',
    });
    await seedMessage(foreign, foreignChat, 1, {
      role: 'user',
      text: 'foreign text',
    });

    await tenantDb.runAs(owner, async (tx) => {
      await tx.execute(sql`INSERT INTO pins (user_id, item_type, item_id, position)
        VALUES (${owner}, 'chat', ${pinned}::uuid, 0)`);
      await tx.execute(
        sql`UPDATE chats SET archived_at = now() WHERE id = ${archived}::uuid`,
      );
    });

    const page = await tenantDb.runAs(owner, (tx) =>
      new ChatReadRepository(tx).readChatRows(owner, 0, 1),
    );

    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      chatId: pinned,
      title: 'Pinned',
      messageCount: 2,
      openingExcerpt: 'opening',
      latestExcerpt: 'latest completed',
      runStatus: 'idle',
    });

    const allRows = await tenantDb.runAs(owner, (tx) =>
      new ChatReadRepository(tx).readChatRows(owner, 0, 20),
    );

    expect(allRows.rows.map(({ chatId }) => chatId)).toEqual([pinned, recent]);
    expect(allRows.rows.some(({ chatId }) => chatId === archived)).toBe(false);
    expect(allRows.rows.some(({ chatId }) => chatId === foreignChat)).toBe(
      false,
    );
    expect(
      allRows.rows.find(({ chatId }) => chatId === recent)?.openingExcerpt,
    ).toBe('recent opening');
  });

  it('returns bounded index windows and eligible predecessor sequences across gaps', async () => {
    const owner = await seedUser();
    const chatId = await seedChat(owner, 'Index gaps');
    await seedMessage(owner, chatId, 1, { role: 'user', text: 'first' });
    await seedMessage(owner, chatId, 2, {
      role: 'system',
      text: 'ineligible role',
    });
    await seedMessage(owner, chatId, 4, { role: 'user', text: 'four' });
    await seedMessage(owner, chatId, 7, {
      role: 'assistant',
      text: 'unfinished',
      usage: { status: 'running' },
    });
    await seedMessage(owner, chatId, 9, { role: 'assistant', text: 'nine' });
    await seedMessage(owner, chatId, 10, {
      role: 'user',
      text: 'after cursor',
    });

    const result = await tenantDb.runAs(owner, async (tx) => {
      const repository = new ChatReadRepository(tx);

      return {
        window: await repository.listEligibleIndex(chatId, owner, {
          start: 4,
          end: 9,
          limit: 10,
        }),
        before: await repository.listEligibleIndex(chatId, owner, {
          beforeSeq: 10,
          limit: 2,
        }),
        first: await repository.listEligibleIndex(chatId, owner, {
          start: 4,
          end: 9,
          limit: 1,
        }),
        latest: await repository.listEligibleIndex(chatId, owner, {
          beforeSeq: 10,
          limit: 1,
        }),
        previous: await repository.previousEligibleSequences(
          chatId,
          owner,
          10,
          2,
        ),
      };
    });

    expect(result.window.map(({ seq }) => seq)).toEqual([4, 9]);
    expect(result.before.map(({ seq }) => seq)).toEqual([4, 9]);
    expect(result.previous).toEqual([{ seq: 9 }, { seq: 4 }]);
    expect(result.first.map(({ seq }) => seq)).toEqual([4]);
    expect(result.latest.map(({ seq }) => seq)).toEqual([9]);
  });

  it('reads an exact eligible message with its nearest eligible neighbours', async () => {
    const owner = await seedUser();
    const chatId = await seedChat(owner, 'Message neighbours');
    await seedMessage(owner, chatId, 1, { role: 'user', text: 'previous' });
    await seedMessage(owner, chatId, 2, {
      role: 'system',
      text: 'not eligible',
    });
    await seedMessage(owner, chatId, 4, { role: 'assistant', text: 'target' });
    await seedMessage(owner, chatId, 5, {
      role: 'assistant',
      text: 'unfinished',
      usage: { status: 'running' },
    });
    await seedMessage(owner, chatId, 8, { role: 'user', text: 'next' });

    const message = await tenantDb.runAs(owner, (tx) =>
      new ChatReadRepository(tx).readMessage(chatId, owner, 4),
    );

    expect(message).toMatchObject({
      chatId,
      seq: 4,
      role: 'assistant',
      parts: [{ type: 'text', text: 'target' }],
      previousMessageSeq: 1,
      nextMessageSeq: 8,
    });
  });

  it('returns only the latest nonterminal run status', async () => {
    const owner = await seedUser();
    const chatId = await seedChat(owner, 'Run state');

    await tenantDb.runAs(owner, async (tx) => {
      await tx.execute(sql`INSERT INTO runs (chat_id, user_id, model_id, selector, status, created_at)
        VALUES (${chatId}::uuid, ${owner}, 'system:test', 'system:test', 'running_model', now() - interval '2 minutes')`);
      await tx.execute(sql`INSERT INTO runs (chat_id, user_id, model_id, selector, status, created_at)
        VALUES (${chatId}::uuid, ${owner}, 'system:test', 'system:test', 'completed', now())`);
    });

    await expect(
      tenantDb.runAs(owner, (tx) =>
        new ChatReadRepository(tx).currentRunStatus(chatId, owner),
      ),
    ).resolves.toBe('running_model');

    for (const status of [
      'queued',
      'awaiting_jobs',
      'awaiting_quota',
    ] as const) {
      await tenantDb.runAs(owner, (tx) =>
        tx.execute(sql`UPDATE runs SET status = ${status}::run_status
          WHERE chat_id = ${chatId}::uuid AND status <> 'completed'`),
      );
      await expect(
        tenantDb.runAs(owner, (tx) =>
          new ChatReadRepository(tx).currentRunStatus(chatId, owner),
        ),
      ).resolves.toBe(status);
    }

    await tenantDb.runAs(owner, (tx) =>
      tx.execute(sql`UPDATE runs SET status = 'failed'
        WHERE chat_id = ${chatId}::uuid AND status <> 'completed'`),
    );
    await expect(
      tenantDb.runAs(owner, (tx) =>
        new ChatReadRepository(tx).currentRunStatus(chatId, owner),
      ),
    ).resolves.toBe('idle');
  });

  it('keeps owner scoping, empty-identity failure, and archived direct reads', async () => {
    const owner = await seedUser();
    const foreign = await seedUser();
    const ownedChat = await seedChat(owner, 'Owned');
    const foreignChat = await seedChat(foreign, 'Foreign');
    const archivedChat = await seedChat(owner, 'Archived');
    await seedMessage(owner, ownedChat, 1, { role: 'user', text: 'owned' });
    await seedMessage(owner, ownedChat, 3, {
      role: 'system',
      text: 'committed but not eligible',
    });
    await seedMessage(foreign, foreignChat, 1, {
      role: 'user',
      text: 'foreign',
    });
    await seedMessage(owner, archivedChat, 1, {
      role: 'user',
      text: 'archived',
    });
    await tenantDb.runAs(owner, (tx) =>
      tx.execute(
        sql`UPDATE chats SET archived_at = now() WHERE id = ${archivedChat}::uuid`,
      ),
    );

    const ownRead = await tenantDb.runAs(owner, async (tx) => {
      const repository = new ChatReadRepository(tx);

      return {
        owns: await repository.ownsChat(ownedChat, owner),
        maxSeq: await repository.maxCommittedSequence(ownedChat, owner),
        count: await repository.countOwnedChats(owner),
      };
    });

    expect(ownRead).toEqual({ owns: true, maxSeq: 3, count: 1 });

    const foreignRead = await tenantDb.runAs(owner, async (tx) => {
      const repository = new ChatReadRepository(tx);

      return {
        message: await repository.readMessage(foreignChat, foreign, 1),
        index: await repository.listEligibleIndex(foreignChat, foreign, {
          limit: 20,
        }),
        previous: await repository.previousEligibleSequences(
          foreignChat,
          foreign,
          2,
          20,
        ),
        owns: await repository.ownsChat(foreignChat, foreign),
        maxSeq: await repository.maxCommittedSequence(foreignChat, foreign),
      };
    });

    expect(foreignRead).toEqual({
      message: undefined,
      index: [],
      previous: [],
      owns: false,
      maxSeq: 0,
    });

    const publicRead = await tenantDb.runAsPublic(async (tx) => {
      const repository = new ChatReadRepository(tx);

      return {
        message: await repository.readMessage(ownedChat, owner, 1),
        index: await repository.listEligibleIndex(ownedChat, owner, {
          limit: 20,
        }),
        rows: await repository.readChatRows(owner, 0, 20),
        previous: await repository.previousEligibleSequences(
          ownedChat,
          owner,
          2,
          20,
        ),
        count: await repository.countOwnedChats(owner),
        owns: await repository.ownsChat(ownedChat, owner),
        status: await repository.currentRunStatus(ownedChat, owner),
        maxSeq: await repository.maxCommittedSequence(ownedChat, owner),
      };
    });

    expect(publicRead).toEqual({
      message: undefined,
      index: [],
      rows: { rows: [], total: 0 },
      previous: [],
      count: 0,
      owns: false,
      status: 'idle',
      maxSeq: 0,
    });

    const archived = await tenantDb.runAs(owner, async (tx) => {
      const repository = new ChatReadRepository(tx);

      return {
        message: await repository.readMessage(archivedChat, owner, 1),
        rows: await repository.readChatRows(owner, 0, 20),
      };
    });

    expect(archived.message).toMatchObject({ chatId: archivedChat, seq: 1 });
    expect(
      archived.rows.rows.some(({ chatId }) => chatId === archivedChat),
    ).toBe(false);
  });
});
