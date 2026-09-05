/**
 * The cutover migration's data step, exercised against rows that actually
 * carry the retired shapes.
 *
 * The migration runner applies this file to a fresh database on every
 * integration run, which proves it parses — but not that it strips anything,
 * because a fresh database has no legacy parts to strip. This test seeds the
 * three retired shapes and runs the migration's own UPDATE over them, so the
 * filter is what is under test rather than the runner.
 */

import fs from 'node:fs';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';

import * as schema from './schema';
import { TenantDbService } from './tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { isRecord } from '@workspace/runtime-safety';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
// Matches the sibling integration suites: `postgres` is required lazily so the
// unit project never loads the driver at runtime, but a type-only import of
// its client type is erased and carries no runtime cost.
type SqlClient = Sql;

/** The migration's UPDATE, read from the file rather than restated here. */
function cutoverUpdate(): string {
  const file = fs.readFileSync(
    path.resolve(
      __dirname,
      'migrations/20260821030000_context_item_cutover.sql',
    ),
    'utf8',
  );
  const update = file
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .find((statement) => statement.startsWith('UPDATE'));
  if (!update) throw new Error('cutover migration has no UPDATE statement');
  return update.replace(/;$/, '');
}

describeIfDb('context-item cutover migration', () => {
  let sql: SqlClient;
  let tenantDb: TenantDbService;
  let userId: string;

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 3 });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Cutover', ${`cutover-${userId}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  it('strips every retired shape and leaves a pre-cutover chat loadable', async () => {
    const seeded = await tenantDb.runAs(userId, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: userId,
        title: 'Pre-cutover chat',
      });
      const messages = new MessagesRepository(tx);
      const legacy = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: userId,
        parts: [
          {
            type: 'data-model-context',
            data: {
              kind: 'model_switch',
              fromModelId: 'a',
              toModelId: 'b',
              runId: crypto.randomUUID(),
            },
          },
          { type: 'data-tool-availability', data: { version: 1 } },
          { type: 'data-recency-digest', data: { kind: 'supersession' } },
          { type: 'text', text: 'the human text must survive' },
        ],
      });
      const untouched = await messages.create({
        chatId: chat.id,
        role: 'assistant',
        inReplyTo: legacy.id,
        parts: [{ type: 'text', text: 'ordinary answer' }],
      });
      return { chat, legacy, untouched };
    });

    // The migration runs as the owning role with no `app.current_user_id`, so
    // it needs the same NO FORCE window the migration file carries — without
    // it every policy denies and the update silently no-ops.
    await sql`ALTER TABLE messages NO FORCE ROW LEVEL SECURITY`;
    try {
      await sql.unsafe(cutoverUpdate());
    } finally {
      await sql`ALTER TABLE messages FORCE ROW LEVEL SECURITY`;
    }

    const after = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(seeded.chat.id, userId),
    );

    const types = after
      .flatMap((message) => message.parts)
      .filter(isRecord)
      .map((part) => part['type']);
    expect(types).not.toContain('data-model-context');
    expect(types).not.toContain('data-tool-availability');
    expect(types).not.toContain('data-recency-digest');

    // A chat predating the cutover still loads, and its human text is intact —
    // only the context parts are gone.
    expect(after).toHaveLength(2);
    expect(types.filter((type) => type === 'text')).toHaveLength(2);

    await sql`DELETE FROM chats WHERE id = ${seeded.chat.id}`;
  });

  it('leaves a message that carries no retired shape untouched', async () => {
    const seeded = await tenantDb.runAs(userId, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: userId,
        title: 'Post-cutover chat',
      });
      const message = await new MessagesRepository(tx).create({
        chatId: chat.id,
        role: 'user',
        senderUserId: userId,
        parts: [
          {
            type: 'data-context',
            data: {
              v: 1,
              producer: 'recency-digest',
              form: 'snapshot',
              runId: crypto.randomUUID(),
              payload: {},
            },
          },
          { type: 'text', text: 'unified part stays' },
        ],
      });
      return { chat, message };
    });

    await sql`ALTER TABLE messages NO FORCE ROW LEVEL SECURITY`;
    try {
      await sql.unsafe(cutoverUpdate());
    } finally {
      await sql`ALTER TABLE messages FORCE ROW LEVEL SECURITY`;
    }

    const [after] = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(seeded.chat.id, userId),
    );
    expect(after?.parts).toEqual(seeded.message.parts);

    await sql`DELETE FROM chats WHERE id = ${seeded.chat.id}`;
  });
});
