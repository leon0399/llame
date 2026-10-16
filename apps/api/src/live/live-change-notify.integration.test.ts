/**
 * `llame_notify_change` triggers on a live DB (forced RLS):
 * - a committed write notifies `llame_changes` with a pointer payload whose
 *   owner comes from the row;
 * - a rolled-back write notifies nothing;
 * - a run_events insert resolves its owner and chat through runs;
 * - a payload never carries record content (title).
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';
import { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type Payload = UnknownRecord;

describeIfDb('llame_notify_change triggers', () => {
  let sql: Sql;
  let listener: Sql;
  let tenantDb: TenantDbService;
  let a: string;
  const received: Array<Payload> = [];

  const ofOwner = (owner: string) =>
    received.filter((p) => p['owner'] === owner);

  const waitForPayload = async (
    predicate: (p: Payload) => boolean,
  ): Promise<Payload> => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const hit = received.find(predicate);
      if (hit) return hit;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('notification not received');
  };

  const newChat = (owner: string, title: string): Promise<string> => {
    const id = crypto.randomUUID();
    return tenantDb
      .runAs(owner, (tx) =>
        new ChatsRepository(tx).createIfAbsent({
          id,
          ownerUserId: owner,
          title,
        }),
      )
      .then(() => id);
  };

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 3 });
    listener = connect(TEST_DB_URL!, { ssl, max: 1 });
    const db: Db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    a = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${a}, 'L', ${`l-${a}@t.com`})`;
    await listener.listen('llame_changes', (raw) => {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) received.push(parsed);
    });
  });

  afterAll(async () => {
    await sql`DELETE FROM users WHERE id = ${a}`;
    await listener.end();
    await sql.end();
  });

  it('notifies a committed chat insert with a pointer payload owned by the row owner', async () => {
    const chatId = await newChat(a, 'Secret title');

    const payload = await waitForPayload(
      (p) => p['k'] === 'chat' && p['chat'] === chatId,
    );
    expect(payload).toEqual({
      k: 'chat',
      op: 'insert',
      owner: a,
      chat: chatId,
    });
    expect(JSON.stringify(payload)).not.toContain('Secret title');
  });

  it('notifies a rename', async () => {
    const chatId = await newChat(a, 'Before');
    await waitForPayload((p) => p['chat'] === chatId && p['op'] === 'insert');

    await tenantDb.runAs(a, (tx) =>
      new ChatsRepository(tx).update(chatId, a, { title: 'After' }),
    );

    await waitForPayload((p) => p['chat'] === chatId && p['op'] === 'update');
  });

  it('notifies nothing for a rolled-back write', async () => {
    const chatId = crypto.randomUUID();
    await expect(
      tenantDb.runAs(a, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: chatId,
          ownerUserId: a,
          title: 'Rolled back',
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    // A later committed write proves the listener is live and ordered.
    const marker = await newChat(a, 'Marker');
    await waitForPayload((p) => p['chat'] === marker);
    expect(ofOwner(a).some((p) => p['chat'] === chatId)).toBe(false);
  });

  it('resolves a run event owner and chat through runs, and notifies status changes', async () => {
    const chatId = await newChat(a, 'Run chat');
    const runId = await tenantDb.runAs(a, async (tx) => {
      const message = await new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        senderUserId: a,
        parts: [{ type: 'text', text: 'go' }],
      });
      const run = await new RunsRepository(tx).create({
        chatId,
        messageId: message.id,
        userId: a,
        modelId: 'system:openai:gpt-5.4-mini',
      });
      return run.id;
    });
    await waitForPayload(
      (p) => p['k'] === 'run' && p['run'] === runId && p['status'] === 'queued',
    );

    const event = await tenantDb.runAs(a, (tx) =>
      new RunEventsRepository(tx).append(runId, 'tool.requested', {
        toolName: 'secret_tool',
      }),
    );
    const payload = await waitForPayload(
      (p) => p['k'] === 'run_event' && p['run'] === runId,
    );
    expect(payload).toEqual({
      k: 'run_event',
      op: 'insert',
      owner: a,
      chat: chatId,
      run: runId,
      seq: event.sequence,
      type: 'tool.requested',
    });

    await tenantDb.runAs(a, (tx) =>
      new RunsRepository(tx).markFinished(runId, a, 'completed'),
    );
    await waitForPayload(
      (p) =>
        p['k'] === 'run' && p['run'] === runId && p['status'] === 'completed',
    );
  });
});
