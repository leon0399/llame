/**
 * Database invariants for the stable conversation sequence locator.
 *
 * The suite is intentionally database-backed: Drizzle's schema types cannot
 * prove the unique `(chat_id, seq)` invariant, identity allocation, or update
 * behavior. `test:integration` provisions the same non-superuser table owner
 * and FORCE-RLS topology used by production-shaped tests.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from './schema';
import { TenantDbService, type Db } from './tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
if (!TEST_DB_URL) {
  throw new Error(
    'conversation-sequence.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}
type SqlClient = any;

const textPart = (text: string) => [{ type: 'text', text }];

describe('conversation message sequence database invariants', () => {
  let sqlClient: SqlClient;
  let tenantDb: TenantDbService;
  let ownerUserId: string;

  beforeAll(async () => {
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;
    sqlClient = connect(TEST_DB_URL, { ssl, max: 3 });
    const db: Db = drizzle(sqlClient, { schema });
    tenantDb = new TenantDbService(db);
    ownerUserId = crypto.randomUUID();
    await sqlClient`
      INSERT INTO users (id, name, email)
      VALUES (${ownerUserId}, 'Sequence test owner', ${`sequence-${ownerUserId}@test.com`})
    `;
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id = ${ownerUserId}`;
      await sqlClient.end();
    }
  });

  it('exposes nullable integer source-boundary columns on search documents', async () => {
    const rows = await sqlClient`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'search_chat_documents'
        AND column_name IN (
          'first_message_text_offset',
          'last_message_text_offset_exclusive'
        )
      ORDER BY column_name
    `;

    expect(rows).toEqual([
      {
        column_name: 'first_message_text_offset',
        data_type: 'integer',
        is_nullable: 'YES',
      },
      {
        column_name: 'last_message_text_offset_exclusive',
        data_type: 'integer',
        is_nullable: 'YES',
      },
    ]);
  });

  it('keeps message sequence allocation as a generated bigint identity', async () => {
    const rows = await sqlClient`
      SELECT data_type, is_nullable, is_identity, identity_generation
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'messages'
        AND column_name = 'seq'
    `;

    expect(rows).toEqual([
      {
        data_type: 'bigint',
        is_nullable: 'NO',
        is_identity: 'YES',
        identity_generation: 'ALWAYS',
      },
    ]);
  });

  async function createChat(tx: Db, title: string): Promise<string> {
    const chat = await new ChatsRepository(tx).create({
      ownerUserId,
      title,
    });
    return chat.id;
  }

  it('rejects a duplicate sequence within one chat at the database boundary', async () => {
    const chatId = await tenantDb.runAs(ownerUserId, (tx) =>
      createChat(tx, 'Duplicate sequence'),
    );

    try {
      const first = await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: ownerUserId,
          parts: textPart('first'),
        }),
      );

      await expect(
        tenantDb.runAs(ownerUserId, (tx) =>
          tx.execute(dsql`
            INSERT INTO messages (chat_id, seq, role, sender_user_id, parts)
            OVERRIDING SYSTEM VALUE
            VALUES (
              ${chatId},
              ${first.seq},
              'user',
              ${ownerUserId},
              ${JSON.stringify(textPart('duplicate'))}::jsonb
            )
          `),
        ),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: '23505' }),
      });
    } finally {
      await tenantDb.runAs(ownerUserId, (tx) =>
        new ChatsRepository(tx).deleteById(chatId, ownerUserId),
      );
    }
  });

  it('keeps identity-generated sequence values sparse across chats', async () => {
    const chatA = await tenantDb.runAs(ownerUserId, (tx) =>
      createChat(tx, 'Sparse sequence A'),
    );
    const chatB = await tenantDb.runAs(ownerUserId, (tx) =>
      createChat(tx, 'Sparse sequence B'),
    );

    try {
      const firstA = await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).create({
          chatId: chatA,
          role: 'user',
          senderUserId: ownerUserId,
          parts: textPart('first A'),
        }),
      );
      await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).create({
          chatId: chatB,
          role: 'user',
          senderUserId: ownerUserId,
          parts: textPart('between A messages'),
        }),
      );
      const secondA = await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).create({
          chatId: chatA,
          role: 'user',
          senderUserId: ownerUserId,
          parts: textPart('second A'),
        }),
      );

      expect(firstA.seq).toBeGreaterThan(0);
      expect(secondA.seq).toBeGreaterThan(firstA.seq + 1);
    } finally {
      await tenantDb.runAs(ownerUserId, async (tx) => {
        const chats = new ChatsRepository(tx);
        await chats.deleteById(chatA, ownerUserId);
        await chats.deleteById(chatB, ownerUserId);
      });
    }
  });

  it('does not change sequence when an assistant retry updates its row', async () => {
    const chatId = await tenantDb.runAs(ownerUserId, (tx) =>
      createChat(tx, 'Retry sequence'),
    );

    try {
      const userMessage = await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: ownerUserId,
          parts: textPart('retry prompt'),
        }),
      );
      const assistantMessage = await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).create({
          chatId,
          role: 'assistant',
          senderUserId: null,
          parts: textPart('aborted answer'),
          usage: { status: 'aborted' },
          inReplyTo: userMessage.id,
        }),
      );

      const updated = await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).updateAssistantReply({
          id: assistantMessage.id,
          chatId,
          inReplyTo: userMessage.id,
          parts: textPart('retry answer'),
          usage: { status: 'completed' },
        }),
      );

      expect(updated?.seq).toBe(assistantMessage.seq);
      const readBack = await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).findById(
          chatId,
          ownerUserId,
          assistantMessage.id,
        ),
      );
      expect(readBack?.seq).toBe(assistantMessage.seq);
      expect(readBack?.parts).toEqual(textPart('retry answer'));
    } finally {
      await tenantDb.runAs(ownerUserId, (tx) =>
        new ChatsRepository(tx).deleteById(chatId, ownerUserId),
      );
    }
  });
});
