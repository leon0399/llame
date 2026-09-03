/**
 * Database invariants for the stable conversation sequence locator.
 *
 * The suite is intentionally database-backed: Drizzle's schema types cannot
 * prove the unique `(chat_id, seq)` invariant, Chat-local allocation, or update
 * behavior. `test:integration` provisions the same non-superuser table owner
 * and FORCE-RLS topology used by production-shaped tests.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Sql } from 'postgres';

import * as schema from './schema';
import { TenantDbService, type Db } from './tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
if (!TEST_DB_URL) {
  throw new Error(
    'conversation-sequence.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration` or provide an already-provisioned database.',
  );
}
// `postgres` is required lazily so the unit project never loads the driver at
// runtime, but a type-only import of its client type is erased and carries no
// runtime cost.
type SqlClient = Sql;

const textPart = (text: string) => [{ type: 'text', text }];
const sequenceMigrationStatements = readFileSync(
  join(__dirname, 'migrations', '20260828123726_flowery_nitro.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);

describe('conversation message sequence database invariants', () => {
  let sqlClient: SqlClient;
  let tenantDb: TenantDbService;
  let ownerUserId: string;
  let otherUserId: string;

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;
    sqlClient = connect(TEST_DB_URL, { ssl, max: 3 });
    const db: Db = drizzle(sqlClient, { schema });
    tenantDb = new TenantDbService(db);
    ownerUserId = crypto.randomUUID();
    otherUserId = crypto.randomUUID();
    await sqlClient`
      INSERT INTO users (id, name, email)
      VALUES
        (${ownerUserId}, 'Sequence test owner', ${`sequence-${ownerUserId}@test.com`}),
        (${otherUserId}, 'Other sequence owner', ${`sequence-${otherUserId}@test.com`})
    `;
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id IN (${ownerUserId}, ${otherUserId})`;
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

  it('stores message sequence as an explicit positive bigint', async () => {
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
        is_identity: 'NO',
        identity_generation: null,
      },
    ]);

    const constraints = await sqlClient`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'messages'::regclass
        AND conname = 'messages_seq_positive'
    `;
    expect(constraints).toEqual([{ definition: 'CHECK ((seq > 0))' }]);
  });

  it('restores FORCE RLS on every table opened by the migration', async () => {
    const rows = await sqlClient`
      SELECT relname, relforcerowsecurity
      FROM pg_class
      WHERE oid IN (
        'messages'::regclass,
        'run_events'::regclass,
        'compactions'::regclass
      )
      ORDER BY relname
    `;
    expect(rows).toEqual([
      { relname: 'compactions', relforcerowsecurity: true },
      { relname: 'messages', relforcerowsecurity: true },
      { relname: 'run_events', relforcerowsecurity: true },
    ]);
  });

  async function createChat(tx: Db, title: string): Promise<string> {
    const chat = await new ChatsRepository(tx).create({
      ownerUserId,
      title,
    });
    return chat.id;
  }

  async function withSchema<T>(
    schemaName: string,
    fn: (tx: SqlClient) => Promise<T>,
  ): Promise<T> {
    // postgres.js's begin() unwraps a returned array's own promise elements
    // (UnwrapPromiseArray<T>), which can't resolve back to a bare opaque T.
    // Wrapping the result in an object sidesteps that: `{ value: T }` never
    // matches the array branch, so the unwrap is provably a no-op here.
    const { value } = await sqlClient.begin(async (tx: SqlClient) => {
      await tx`SET LOCAL search_path TO ${tx(schemaName)}`;
      return { value: await fn(tx) };
    });
    return value;
  }

  async function createLegacyMigrationFixture(
    locatorSource: 'message' | 'event' | 'compaction' | null,
  ) {
    const schemaName = `sequence_migration_${crypto.randomUUID().replaceAll('-', '')}`;
    const chatA = crypto.randomUUID();
    const chatB = crypto.randomUUID();
    const messagesA = Array.from({ length: 4 }, () => crypto.randomUUID());
    const messagesB = Array.from({ length: 4 }, () => crypto.randomUUID());
    const earlierCompactionId = crypto.randomUUID();
    const laterCompactionId = crypto.randomUUID();

    await sqlClient`CREATE SCHEMA ${sqlClient(schemaName)}`;
    await withSchema(schemaName, async (tx) => {
      await tx.unsafe(`
        CREATE TABLE messages (
          id uuid PRIMARY KEY,
          chat_id uuid NOT NULL,
          seq bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
          parts jsonb NOT NULL
        );
        CREATE UNIQUE INDEX messages_chat_seq_unique_idx
          ON messages (chat_id, seq);
        CREATE TABLE run_events (payload jsonb);
        CREATE TABLE compactions (
          id uuid PRIMARY KEY,
          chat_id uuid NOT NULL,
          upto_seq bigint NOT NULL,
          replacement_history jsonb NOT NULL
        );
        CREATE UNIQUE INDEX compactions_chat_upto_seq_idx
          ON compactions (chat_id, upto_seq);
        CREATE POLICY messages_all ON messages USING (true) WITH CHECK (true);
        CREATE POLICY run_events_all ON run_events USING (true) WITH CHECK (true);
        CREATE POLICY compactions_all ON compactions USING (true) WITH CHECK (true);
        ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
        ALTER TABLE messages FORCE ROW LEVEL SECURITY;
        ALTER TABLE run_events ENABLE ROW LEVEL SECURITY;
        ALTER TABLE run_events FORCE ROW LEVEL SECURITY;
        ALTER TABLE compactions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE compactions FORCE ROW LEVEL SECURITY;
      `);
      const legacyPart = [
        {
          type: 'tool-conversation_read',
          input: { chatId: chatA, messageSeq: 3 },
        },
      ];
      for (let i = 0; i < 4; i++) {
        await tx`
          INSERT INTO messages (id, chat_id, parts)
          VALUES (${messagesB[i]}, ${chatB}, ${JSON.stringify([])}::jsonb)
        `;
        await tx`
          INSERT INTO messages (id, chat_id, parts)
          VALUES (
            ${messagesA[i]},
            ${chatA},
            ${JSON.stringify(
              i === 3 && locatorSource === 'message' ? legacyPart : [],
            )}::jsonb
          )
        `;
      }
      const compactionHistory =
        locatorSource === 'compaction'
          ? [{ role: 'assistant', parts: legacyPart }]
          : [];
      // Insert the later boundary first: without dropping the unique index,
      // rewriting old 8 -> new 4 collides with the still-old boundary 4.
      await tx`
        INSERT INTO compactions (
          id,
          chat_id,
          upto_seq,
          replacement_history
        )
        VALUES (
          ${laterCompactionId},
          ${chatA},
          8,
          ${JSON.stringify(compactionHistory)}::jsonb
        )
      `;
      await tx`
        INSERT INTO compactions (
          id,
          chat_id,
          upto_seq,
          replacement_history
        )
        VALUES (${earlierCompactionId}, ${chatA}, 4, '[]'::jsonb)
      `;
      if (locatorSource === 'event') {
        await tx`
          INSERT INTO run_events (payload)
          VALUES (${JSON.stringify({
            toolName: 'search_conversations',
            output: { results: [{ messageSeq: 3 }] },
          })}::jsonb)
        `;
      }
    });
    return {
      schemaName,
      chatA,
      chatB,
      messagesA,
      messagesB,
      earlierCompactionId,
      laterCompactionId,
    };
  }

  async function applySequenceMigration(schemaName: string): Promise<void> {
    await withSchema(schemaName, async (tx) => {
      for (const statement of sequenceMigrationStatements) {
        await tx.unsafe(statement);
      }
    });
  }

  async function dropSchema(schemaName: string): Promise<void> {
    await sqlClient`DROP SCHEMA IF EXISTS ${sqlClient(schemaName)} CASCADE`;
  }

  it('rewrites legacy global order and preserves the compaction terminal message', async () => {
    const fixture = await createLegacyMigrationFixture(null);
    try {
      await applySequenceMigration(fixture.schemaName);
      const state = await withSchema(fixture.schemaName, async (tx) => {
        const messages = await tx`
          SELECT id::text, chat_id::text, seq::text
          FROM messages
          ORDER BY chat_id, seq
        `;
        const compactions = await tx`
          SELECT c.upto_seq::text, m.id::text AS terminal_message_id
          FROM compactions AS c
          INNER JOIN messages AS m
            ON m.chat_id = c.chat_id AND m.seq = c.upto_seq
          ORDER BY c.upto_seq
        `;
        const [column] = await tx`
          SELECT is_identity
          FROM information_schema.columns
          WHERE table_schema = ${fixture.schemaName}
            AND table_name = 'messages'
            AND column_name = 'seq'
        `;
        const force = await tx`
          SELECT relname, relforcerowsecurity
          FROM pg_class
          WHERE oid IN (
            'messages'::regclass,
            'run_events'::regclass,
            'compactions'::regclass
          )
          ORDER BY relname
        `;
        return { messages, compactions, column, force };
      });

      expect(state.messages).toHaveLength(8);
      expect(state.messages).toEqual(
        expect.arrayContaining([
          ...fixture.messagesA.map((id, index) => ({
            id,
            chat_id: fixture.chatA,
            seq: String(index + 1),
          })),
          ...fixture.messagesB.map((id, index) => ({
            id,
            chat_id: fixture.chatB,
            seq: String(index + 1),
          })),
        ]),
      );
      expect(state.compactions).toEqual([
        { upto_seq: '2', terminal_message_id: fixture.messagesA[1] },
        { upto_seq: '4', terminal_message_id: fixture.messagesA[3] },
      ]);
      expect(state.column).toEqual({ is_identity: 'NO' });
      expect(state.force).toEqual([
        { relname: 'compactions', relforcerowsecurity: true },
        { relname: 'messages', relforcerowsecurity: true },
        { relname: 'run_events', relforcerowsecurity: true },
      ]);
    } finally {
      await dropSchema(fixture.schemaName);
    }
  });

  it.each(['message', 'event', 'compaction'] as const)(
    'aborts before mutation for an experimental locator in %s history',
    async (locatorSource) => {
      const fixture = await createLegacyMigrationFixture(locatorSource);
      try {
        await expect(
          applySequenceMigration(fixture.schemaName),
        ).rejects.toThrow(
          /persisted experimental global conversation locators/,
        );
        const state = await withSchema(fixture.schemaName, async (tx) => {
          const messages = await tx`
            SELECT id::text, seq::text
            FROM messages
            ORDER BY seq
          `;
          const compactions = await tx`
            SELECT upto_seq::text
            FROM compactions
            ORDER BY upto_seq
          `;
          const [column] = await tx`
            SELECT is_identity
            FROM information_schema.columns
            WHERE table_schema = ${fixture.schemaName}
              AND table_name = 'messages'
              AND column_name = 'seq'
          `;
          return { messages, compactions, column };
        });
        expect(state.messages).toEqual(
          Array.from({ length: 4 }, (_, index) => [
            { id: fixture.messagesB[index], seq: String(index * 2 + 1) },
            { id: fixture.messagesA[index], seq: String(index * 2 + 2) },
          ]).flat(),
        );
        expect(state.compactions).toEqual([
          { upto_seq: '4' },
          { upto_seq: '8' },
        ]);
        expect(state.column).toEqual({ is_identity: 'YES' });
      } finally {
        await dropSchema(fixture.schemaName);
      }
    },
  );

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

  it('allocates dense one-based sequence values independently per chat', async () => {
    const chatA = await tenantDb.runAs(ownerUserId, (tx) =>
      createChat(tx, 'Local sequence A'),
    );
    const chatB = await tenantDb.runAs(ownerUserId, (tx) =>
      createChat(tx, 'Local sequence B'),
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

      expect(firstA.seq).toBe(1);
      expect(secondA.seq).toBe(2);
      const messagesB = await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatB, ownerUserId),
      );
      expect(messagesB.map(({ seq }) => seq)).toEqual([1]);
    } finally {
      await tenantDb.runAs(ownerUserId, async (tx) => {
        const chats = new ChatsRepository(tx);
        await chats.deleteById(chatA, ownerUserId);
        await chats.deleteById(chatB, ownerUserId);
      });
    }
  });

  it('does not consume a sequence value when an insert transaction rolls back', async () => {
    const chatId = await tenantDb.runAs(ownerUserId, (tx) =>
      createChat(tx, 'Rollback sequence'),
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
        tenantDb.runAs(ownerUserId, async (tx) => {
          await new MessagesRepository(tx).create({
            chatId,
            role: 'user',
            senderUserId: ownerUserId,
            parts: textPart('rolled back'),
          });
          throw new Error('force rollback');
        }),
      ).rejects.toThrow('force rollback');

      const second = await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: ownerUserId,
          parts: textPart('second'),
        }),
      );
      expect([first.seq, second.seq]).toEqual([1, 2]);
    } finally {
      await tenantDb.runAs(ownerUserId, (tx) =>
        new ChatsRepository(tx).deleteById(chatId, ownerUserId),
      );
    }
  });

  it('serializes ordinary concurrent inserts into distinct dense values', async () => {
    const chatId = await tenantDb.runAs(ownerUserId, (tx) =>
      createChat(tx, 'Concurrent sequence'),
    );

    try {
      const created = await Promise.all(
        ['first', 'second', 'third'].map((text) =>
          tenantDb.runAs(ownerUserId, (tx) =>
            new MessagesRepository(tx).create({
              chatId,
              role: 'user',
              senderUserId: ownerUserId,
              parts: textPart(text),
            }),
          ),
        ),
      );
      expect(created.map(({ seq }) => seq).sort((a, b) => a - b)).toEqual([
        1, 2, 3,
      ]);
    } finally {
      await tenantDb.runAs(ownerUserId, (tx) =>
        new ChatsRepository(tx).deleteById(chatId, ownerUserId),
      );
    }
  });

  it('bounds named sequence-conflict retries and leaves no message behind', async () => {
    const chatId = await tenantDb.runAs(ownerUserId, (tx) =>
      createChat(tx, 'Sequence retry exhaustion'),
    );

    try {
      await tenantDb.runAs(ownerUserId, async (tx) => {
        await tx.execute(
          dsql`select set_config('llame.test_sequence_chat', ${chatId}, true)`,
        );
        await tx.execute(dsql`
          CREATE SEQUENCE message_sequence_retry_probe
        `);
        await tx.execute(dsql`
          CREATE FUNCTION fail_test_message_sequence_insert()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.chat_id::text = current_setting('llame.test_sequence_chat', true) THEN
              PERFORM nextval('message_sequence_retry_probe');
              RAISE unique_violation
                USING CONSTRAINT = 'messages_chat_seq_unique_idx';
            END IF;
            RETURN NEW;
          END
          $$
        `);
        await tx.execute(dsql`
          CREATE TRIGGER fail_test_message_sequence_insert
          BEFORE INSERT ON messages
          FOR EACH ROW EXECUTE FUNCTION fail_test_message_sequence_insert()
        `);

        await expect(
          new MessagesRepository(tx).create({
            chatId,
            role: 'user',
            senderUserId: ownerUserId,
            parts: textPart('never committed'),
          }),
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            code: '23505',
            constraint_name: 'messages_chat_seq_unique_idx',
          }),
        });
        const [{ last_value: attempts }] = await tx.execute<{
          last_value: string;
        }>(dsql`SELECT last_value::text FROM message_sequence_retry_probe`);
        expect(Number(attempts)).toBe(8);

        await tx.execute(
          dsql`DROP TRIGGER fail_test_message_sequence_insert ON messages`,
        );
        await tx.execute(
          dsql`DROP FUNCTION fail_test_message_sequence_insert()`,
        );
        await tx.execute(dsql`DROP SEQUENCE message_sequence_retry_probe`);
      });
      const messages = await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, ownerUserId),
      );
      expect(messages).toEqual([]);
    } finally {
      await tenantDb.runAs(ownerUserId, (tx) =>
        new ChatsRepository(tx).deleteById(chatId, ownerUserId),
      );
    }
  });

  it('denies cross-tenant sequence allocation under FORCE RLS', async () => {
    const chatId = await tenantDb.runAs(ownerUserId, (tx) =>
      createChat(tx, 'Owner sequence'),
    );

    try {
      await expect(
        tenantDb.runAs(otherUserId, (tx) =>
          new MessagesRepository(tx).create({
            chatId,
            role: 'user',
            senderUserId: otherUserId,
            parts: textPart('foreign'),
          }),
        ),
        // Name the denial: a bare toThrow() here passes on any failure, so a
        // typo in the fixture would read as isolation working. Asserted on the
        // driver's own SQLSTATE rather than on message text -- drizzle's
        // top-level message is "Failed query: insert into ..." and the RLS
        // detail lives on the cause, the same shape this file already relies
        // on for 23505 above. 42501 is insufficient_privilege, which is what
        // a FORCE RLS policy denial raises.
      ).rejects.toThrow(
        expect.objectContaining({
          cause: expect.objectContaining({ code: '42501' }),
        }),
      );
      const messages = await tenantDb.runAs(ownerUserId, (tx) =>
        new MessagesRepository(tx).findByChatId(chatId, ownerUserId),
      );
      expect(messages).toEqual([]);
    } finally {
      await tenantDb.runAs(ownerUserId, (tx) =>
        new ChatsRepository(tx).deleteById(chatId, ownerUserId),
      );
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
