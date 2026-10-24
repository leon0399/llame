/**
 * `WorkspaceBindingRepository.bindAtCreation` against real PostgreSQL with
 * FORCE RLS (openspec `chat-start-location`, "The bind step refuses a chat that
 * holds a message or a Run", "The creation worktree commits with its lease and
 * binding", and `workspace-entry` "The Workspace binding is Chat-scoped and
 * persists across Runs").
 *
 * What only the database can prove is here: the Chat row lock, the two
 * existence reads that refuse a send, the lease join that recognizes a Chat's
 * own creation root, the generation increment, and that a refused bind leaves
 * the stored root and generation alone.
 *
 * TEST_DATABASE_URL-gated; skipped otherwise.
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { type Chat, type Checkout } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { RunsRepository } from '../runs/runs-repository';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { WorkspaceBindingRepository } from './workspace-binding.repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb('bindAtCreation — PostgreSQL', () => {
  let sql: Sql;
  let db: Db;
  let tenantDb: TenantDbService;
  const owner = crypto.randomUUID();
  const otherOwner = crypto.randomUUID();
  const chatIds: Array<string> = [];

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      max: 2,
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
    });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    await sql`INSERT INTO users (id, name, email) VALUES
      (${owner}, 'Creation bind', ${`${owner}@test.com`}),
      (${otherOwner}, 'Other owner', ${`${otherOwner}@test.com`})`;
  });

  afterEach(async () => {
    for (const id of chatIds.splice(0)) {
      await tenantDb.runAs(owner, (tx) =>
        new ChatsRepository(tx).deleteById(id, owner),
      );
    }
  });

  afterAll(async () => {
    await sql.end();
  });

  async function seedChat(): Promise<Chat> {
    const id = crypto.randomUUID();
    chatIds.push(id);
    const chat = await tenantDb.runAs(owner, (tx) =>
      new ChatsRepository(tx).createIfAbsent({ id, ownerUserId: owner }),
    );
    if (chat === undefined) throw new Error('The chat was not created');
    return chat;
  }

  const bind = (
    chatId: string,
    root: string,
    executorId = 'creation-host',
    userId = owner,
  ) =>
    tenantDb.runAs(userId, (tx) =>
      new WorkspaceBindingRepository(tx).bindAtCreation({
        chatId,
        ownerUserId: userId,
        executorId,
        root,
      }),
    );

  async function readWorkspace(chatId: string) {
    const [row] = await tenantDb.runAs(owner, (tx) =>
      tx
        .select({
          workspaceRoot: schema.chats.workspaceRoot,
          workspaceExecutorId: schema.chats.workspaceExecutorId,
          workspaceGeneration: schema.chats.workspaceGeneration,
          workspaceToldAvailable: schema.chats.workspaceToldAvailable,
        })
        .from(schema.chats)
        .where(
          and(eq(schema.chats.id, chatId), eq(schema.chats.ownerUserId, owner)),
        )
        .limit(1),
    );
    if (row === undefined) throw new Error('The chat was not found');
    return row;
  }

  it('binds an unbound Chat without a Run and increments the generation', async () => {
    const chat = await seedChat();

    await expect(bind(chat.id, '/srv/llame')).resolves.toEqual({
      status: 'bound',
      generation: 1,
    });
    expect(await readWorkspace(chat.id)).toEqual({
      workspaceRoot: '/srv/llame',
      workspaceExecutorId: 'creation-host',
      workspaceGeneration: 1,
      workspaceToldAvailable: null,
    });

    const runs = await tenantDb.runAs(owner, (tx) =>
      tx
        .select({ id: schema.runs.id })
        .from(schema.runs)
        .where(
          and(eq(schema.runs.chatId, chat.id), eq(schema.runs.userId, owner)),
        ),
    );
    expect(runs).toEqual([]);
  });

  it('refuses a second bind of a root no creation lease of this Chat names', async () => {
    const chat = await seedChat();
    await bind(chat.id, '/srv/llame');

    // Only an unbound Chat, or one bound to its own creation root, accepts a
    // bind; a checkout binding has no lease, so a resend reuses it instead.
    await expect(bind(chat.id, '/srv/llame')).resolves.toEqual({
      status: 'conflict',
    });
    expect(await readWorkspace(chat.id)).toMatchObject({
      workspaceRoot: '/srv/llame',
      workspaceGeneration: 1,
    });
  });

  it('refuses a Chat that holds a message and stores nothing', async () => {
    const chat = await seedChat();
    await tenantDb.runAs(owner, (tx) =>
      new MessagesRepository(tx).create({
        chatId: chat.id,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'Already sent.' }],
      }),
    );

    await expect(bind(chat.id, '/srv/llame')).resolves.toEqual({
      status: 'conflict',
    });
    expect(await readWorkspace(chat.id)).toMatchObject({
      workspaceRoot: null,
      workspaceGeneration: 0,
    });
  });

  it('refuses a Chat that holds a Run and stores nothing', async () => {
    const chat = await seedChat();
    // A Run's message can be removed (the column is `ON DELETE set null`), so
    // a Chat can hold a Run and no message; the Run check must catch it.
    const message = await tenantDb.runAs(owner, (tx) =>
      new MessagesRepository(tx).create({
        chatId: chat.id,
        role: 'assistant',
        parts: [{ type: 'text', text: 'A reply whose Run outlives it.' }],
      }),
    );
    await tenantDb.runAs(owner, async (tx) => {
      await new RunsRepository(tx).create({
        chatId: chat.id,
        userId: owner,
        messageId: message.id,
        modelId: 'creation-bind-test',
      });
      await tx
        .delete(schema.messages)
        .where(eq(schema.messages.id, message.id));
    });

    await expect(bind(chat.id, '/srv/llame')).resolves.toEqual({
      status: 'conflict',
    });
    expect(await readWorkspace(chat.id)).toMatchObject({
      workspaceRoot: null,
      workspaceGeneration: 0,
    });
  });

  it('refuses another root and keeps the stored binding', async () => {
    const chat = await seedChat();
    await bind(chat.id, '/srv/llame');

    await expect(bind(chat.id, '/srv/other')).resolves.toEqual({
      status: 'conflict',
    });
    expect(await readWorkspace(chat.id)).toMatchObject({
      workspaceRoot: '/srv/llame',
      workspaceGeneration: 1,
    });
  });

  it('recognizes the root of the Chat’s own creation lease', async () => {
    const chat = await seedChat();
    const seeded = await tenantDb.runAs(owner, async (tx) => {
      const repositories = new RepositoriesRepository(tx);
      const repository = await repositories.createRepository({
        ownerUserId: owner,
        displayName: 'llame',
        canonicalRemote: 'github.com/leon0399/llame',
      });
      if (repository === undefined) throw new Error('No repository row');
      const main: Checkout | undefined = await repositories.createCheckout({
        ownerUserId: owner,
        repositoryId: repository.id,
        executorId: 'creation-host',
        path: '/srv/llame',
        kind: 'main',
        parentCheckoutId: null,
        branch: 'main',
        origin: 'registered',
      });
      const worktree: Checkout | undefined = await repositories.createCheckout({
        ownerUserId: owner,
        repositoryId: repository.id,
        executorId: 'creation-host',
        path: '/srv/.llame-worktrees/llame/one',
        kind: 'worktree',
        parentCheckoutId: main?.id ?? null,
        branch: 'llame/one',
        origin: 'created',
      });
      if (worktree === undefined) throw new Error('No worktree row');
      await repositories.createLease({
        ownerUserId: owner,
        chatId: chat.id,
        checkoutId: worktree.id,
        baseRef: 'main',
        baseCommit: 'a'.repeat(40),
      });
      return worktree;
    });

    await bind(chat.id, seeded.path);

    await expect(bind(chat.id, seeded.path)).resolves.toEqual({
      status: 'bound',
      generation: 2,
    });
    expect(await readWorkspace(chat.id)).toMatchObject({
      workspaceRoot: seeded.path,
      workspaceGeneration: 2,
    });
  });

  it('answers not_found for another owner’s Chat and changes nothing', async () => {
    const chat = await seedChat();

    await expect(
      bind(chat.id, '/srv/llame', 'creation-host', otherOwner),
    ).resolves.toEqual({ status: 'not_found' });
    expect(await readWorkspace(chat.id)).toMatchObject({
      workspaceRoot: null,
      workspaceGeneration: 0,
    });
  });
});
