/**
 * The artifact store on a live database: numbering, the parts, the per-part
 * bound, the conflict rule, Chat-owner RLS (including no identity and another
 * owner), the cascade on Chat delete, and the `artifact://` reader and its two
 * lists (tool-result-artifacts D1, D2, D12).
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { eq, inArray, sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';

import * as schema from '../../db/schema';
import { chats, toolArtifactParts, toolArtifacts } from '../../db/schema';
import { TenantDbService } from '../../db/tenant-db.service';
import { ChatsRepository } from '../../chats/chats-repository';
import { readArtifact } from './artifact-reader';
import { ArtifactsRepository } from './artifacts-repository';
import { writeToolArtifact } from './artifact-writer';
import { type ToolContext, type ToolResult } from '../types';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const d = TEST_DB_URL ? describe : describe.skip;
const MAX_BYTES = 1_048_576;

type SqlClient = Sql;

d('artifact store', () => {
  let sql: SqlClient;
  let tenantDb: TenantDbService;
  let owner: string;
  let stranger: string;
  let chatId: string;
  let otherChatId: string;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
      max: 6,
    });
    tenantDb = new TenantDbService(drizzle({ client: sql }));
    owner = crypto.randomUUID();
    stranger = crypto.randomUUID();

    for (const id of [owner, stranger]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'A', ${`a-${id}@t.com`})`;
    }

    chatId = await createChat(tenantDb, owner, 'Main');
    otherChatId = await createChat(tenantDb, owner, 'Other');
    await createChat(tenantDb, stranger, 'Stranger');
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${owner}, ${stranger})`;
      await sql.end();
    }
  });

  const context = (chat: string, user = owner): ToolContext => ({
    configuredCredentials: [],
    userId: user,
    chatId: chat,
    tenantDb,
  });

  const write = (
    chat: string,
    overrides: {
      toolName?: string;
      toolCallId?: string;
      content?: string;
      parts?: ReadonlyArray<{
        name?: string;
        contentType: string;
        content: Buffer;
        findings?: unknown;
      }>;
      maxBytes?: number;
    } = {},
  ) =>
    writeToolArtifact(
      tenantDb,
      {
        chatId: chat,
        userId: owner,
        runId: crypto.randomUUID(),
        toolCallId: overrides.toolCallId ?? crypto.randomUUID(),
        toolName: overrides.toolName ?? 'grep',
        complete: true,
        parts: overrides.parts ?? [
          {
            contentType: 'text/markdown',
            content: Buffer.from(overrides.content ?? '# file\npassage\n'),
          },
        ],
      },
      { maxBytes: overrides.maxBytes ?? MAX_BYTES },
    );

  const read = (locator: string, chat = chatId, user = owner) =>
    readArtifact(context(chat, user), 'read', locator);

  const contentOf = (result: ToolResult): string => {
    if (result.status !== 'success' || !isString(result['content'])) {
      throw new Error(`Expected a read success, got ${JSON.stringify(result)}`);
    }

    return result['content'];
  };

  const countOf = (result: ToolResult): number => {
    if (result.status !== 'success' || !isNumber(result['entryCount'])) {
      throw new Error(`Expected a listing, got ${JSON.stringify(result)}`);
    }

    return result['entryCount'];
  };

  it('is ENABLED and FORCED for the table-owning non-bypass role', async () => {
    const [role] = await sql`
      SELECT current_user, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `;

    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const tables = await sql`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c WHERE c.relname IN ('tool_artifacts', 'tool_artifact_parts')
      ORDER BY c.relname
    `;

    expect(tables).toEqual([
      {
        relname: 'tool_artifact_parts',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      {
        relname: 'tool_artifacts',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
    ]);
  });

  describe('writer', () => {
    it('numbers across tools from one Chat counter', async () => {
      const chat = await createChat(tenantDb, owner, 'Numbers');
      const grep = await write(chat, { toolName: 'grep' });

      const bash = await write(chat, {
        toolName: 'bash',
        parts: [
          {
            name: 'stdout',
            contentType: 'text/plain',
            content: Buffer.from('x\n'),
          },
        ],
      });

      expect(grep.locator).toBe('artifact://grep-1');
      expect(bash.locator).toBe('artifact://bash-2');

      const [row] = await tenantDb.runAs(owner, (tx) =>
        tx.select().from(chats).where(eq(chats.id, chat)),
      );

      expect(row.artifactSeq).toBe(2);
    });

    it('gives concurrent calls different numbers', async () => {
      const chat = await createChat(tenantDb, owner, 'Concurrent');

      const written = await Promise.all([
        write(chat, { toolName: 'grep' }),
        write(chat, { toolName: 'grep' }),
      ]);

      expect(new Set(written.map((artifact) => artifact.seq)).size).toBe(2);
    });

    it('stores the parts, digest, and findings in one transaction', async () => {
      const chat = await createChat(tenantDb, owner, 'Parts');

      const written = await write(chat, {
        toolName: 'bash',
        parts: [
          {
            name: 'stdout',
            contentType: 'application/json',
            content: Buffer.from('{"a":1}\n'),
            findings: [{ locator: '/r/a.ts', rule: 'allow_only' }],
          },
          {
            name: 'stderr',
            contentType: 'text/plain',
            content: Buffer.from('e\n'),
          },
        ],
      });

      const found = await tenantDb.runAs(owner, (tx) =>
        new ArtifactsRepository(tx).findParts(chat, 'bash', written.seq),
      );

      expect(written.byteSize).toBe(10);
      expect(found?.parts).toEqual([
        { name: 'stderr', lineCount: 1, byteSize: 2 },
        { name: 'stdout', lineCount: 1, byteSize: 8 },
      ]);

      const stored = await tenantDb.runAs(owner, (tx) =>
        tx
          .select()
          .from(toolArtifactParts)
          .where(eq(toolArtifactParts.artifactId, written.id)),
      );

      const stdout = stored.find((part) => part.name === 'stdout');
      expect(stdout?.findings).toEqual([
        { locator: '/r/a.ts', rule: 'allow_only' },
      ]);
      expect(stdout?.sha256).toHaveLength(64);
    });

    it('refuses a part above the byte bound and writes no artifact', async () => {
      const chat = await createChat(tenantDb, owner, 'Too large');

      const attempt = write(chat, {
        content: 'x'.repeat(2048),
        maxBytes: 1024,
      });

      await expect(attempt).rejects.toThrow('tools.artifacts.maxBytes');
      expect(await listed(chat)).toEqual([]);
      expect(await seqOf(chat)).toBe(0);
    });

    it('treats a reused tool call id as a failed write', async () => {
      const chat = await createChat(tenantDb, owner, 'Conflict');
      const runId = crypto.randomUUID();

      const writeOnce = () =>
        writeToolArtifact(
          tenantDb,
          {
            chatId: chat,
            userId: owner,
            runId,
            toolCallId: 'call-1',
            toolName: 'grep',
            complete: true,
            parts: [
              { contentType: 'text/markdown', content: Buffer.from('# a\n') },
            ],
          },
          { maxBytes: MAX_BYTES },
        );

      await writeOnce();

      const refused = await writeOnce().catch((error: unknown) => error);
      expect(sqlStateOf(refused)).toBe('23505');
      expect(await listed(chat)).toHaveLength(1);
    });
  });

  describe('row-level security', () => {
    it('reads nothing without an identity', async () => {
      const chat = await createChat(tenantDb, owner, 'No identity');
      await write(chat);
      const [row] = await sql`SELECT count(*)::int AS n FROM tool_artifacts`;

      expect(row.n).toBe(0);
    });

    it('reads nothing for another owner', async () => {
      const chat = await createChat(tenantDb, owner, 'Another owner');
      const written = await write(chat);

      const rows = await tenantDb.runAs(stranger, (tx) =>
        new ArtifactsRepository(tx).listChat(chat),
      );

      const part = await tenantDb.runAs(stranger, (tx) =>
        new ArtifactsRepository(tx).readPart(chat, 'grep', written.seq, ''),
      );

      expect(rows).toEqual([]);
      expect(part).toBeUndefined();
    });

    it('refuses an insert into another owner Chat', async () => {
      const chat = await createChat(tenantDb, owner, 'Foreign insert');

      const refused = await tenantDb
        .runAs(stranger, (tx) =>
          tx.insert(toolArtifacts).values({
            chatId: chat,
            seq: 99,
            toolName: 'grep',
            toolCallId: 'foreign',
            runId: crypto.randomUUID(),
            complete: true,
          }),
        )
        .catch((error: unknown) => error);

      expect(sqlStateOf(refused)).toBe('42501');
    });

    it('shows no artifact to the public sharing identity', async () => {
      const chat = await tenantDb.runAs(owner, (tx) =>
        new ChatsRepository(tx).create({
          ownerUserId: owner,
          title: 'Shared with an artifact',
          visibility: 'public',
        }),
      );

      await write(chat.id);

      const rows = await tenantDb.runAsPublic((tx) =>
        new ArtifactsRepository(tx).listChat(chat.id),
      );

      expect(rows).toEqual([]);

      const [artifacts] = await tenantDb.runAsPublic((tx) =>
        tx.select({ n: drizzleSql<number>`count(*)::int` }).from(toolArtifacts),
      );

      const [parts] = await tenantDb.runAsPublic((tx) =>
        tx
          .select({ n: drizzleSql<number>`count(*)::int` })
          .from(toolArtifactParts),
      );

      expect(artifacts.n).toBe(0);
      expect(parts.n).toBe(0);
    });

    it('refuses a part insert into another owner artifact', async () => {
      const chat = await createChat(tenantDb, owner, 'Foreign part');
      const written = await write(chat);

      const refused = await tenantDb
        .runAs(stranger, (tx) =>
          tx.insert(toolArtifactParts).values({
            artifactId: written.id,
            name: 'stdout',
            contentType: 'text/plain',
            content: Buffer.from('x'),
            sha256: '0'.repeat(64),
            byteSize: 1,
            lineCount: 1,
          }),
        )
        .catch((error: unknown) => error);

      expect(sqlStateOf(refused)).toBe('42501');
    });

    it('keeps part names unique inside one artifact', async () => {
      const chat = await createChat(tenantDb, owner, 'Duplicate part');

      const written = await write(chat, {
        toolName: 'bash',
        parts: [
          {
            name: 'stdout',
            contentType: 'text/plain',
            content: Buffer.from('o'),
          },
        ],
      });

      const refused = await tenantDb
        .runAs(owner, (tx) =>
          tx.insert(toolArtifactParts).values({
            artifactId: written.id,
            name: 'stdout',
            contentType: 'text/plain',
            content: Buffer.from('e'),
            sha256: '0'.repeat(64),
            byteSize: 1,
            lineCount: 1,
          }),
        )
        .catch((error: unknown) => error);

      expect(sqlStateOf(refused)).toBe('23505');
    });

    it('deletes every artifact and part row with its Chat', async () => {
      const chat = await createChat(tenantDb, owner, 'Cascade');
      const grep = await write(chat);

      const bash = await write(chat, {
        toolName: 'bash',
        parts: [
          {
            name: 'stdout',
            contentType: 'text/plain',
            content: Buffer.from('x\n'),
          },
        ],
      });

      const artifactIds = [grep.id, bash.id];

      const partsBefore = await tenantDb.runAs(owner, (tx) =>
        tx
          .select({ n: drizzleSql<number>`count(*)::int` })
          .from(toolArtifactParts)
          .where(inArray(toolArtifactParts.artifactId, artifactIds)),
      );

      expect(partsBefore[0].n).toBe(2);

      await tenantDb.runAs(owner, (tx) =>
        new ChatsRepository(tx).deleteById(chat, owner),
      );

      const remaining = await tenantDb.runAs(owner, (tx) =>
        tx
          .select({ n: drizzleSql<number>`count(*)::int` })
          .from(toolArtifacts)
          .where(eq(toolArtifacts.chatId, chat)),
      );

      const parts = await tenantDb.runAs(owner, (tx) =>
        tx
          .select({ n: drizzleSql<number>`count(*)::int` })
          .from(toolArtifactParts)
          .where(inArray(toolArtifactParts.artifactId, artifactIds)),
      );

      expect(remaining[0].n).toBe(0);
      expect(parts[0].n).toBe(0);
    });
  });

  describe('reader', () => {
    it('reads a range of an artifact without a native executor', async () => {
      const chat = await createChat(tenantDb, owner, 'Range');
      await write(chat, {
        content: Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join(
          '\n',
        ),
      });
      // A text read grows one context line per side, as a file read does.
      const result = await read('artifact://grep-1:5-7', chat);

      expect(contentOf(result)).toBe(
        '4: line 4\n5: line 5\n6: line 6\n7: line 7\n8: line 8\n',
      );
    });

    it('refuses an unknown part and an unknown artifact', async () => {
      const chat = await createChat(tenantDb, owner, 'Unknown');
      await write(chat, {
        toolName: 'bash',
        parts: [
          {
            name: 'stdout',
            contentType: 'text/plain',
            content: Buffer.from('x\n'),
          },
        ],
      });

      expect(await read('artifact://bash-1/stdin', chat)).toMatchObject({
        status: 'error',
        type: 'not_found',
      });
      expect(await read('artifact://grep-9', chat)).toMatchObject({
        status: 'error',
        type: 'not_found',
      });
    });

    it('refuses edit and write as an invalid path', async () => {
      const chat = await createChat(tenantDb, owner, 'Read only');
      await write(chat);

      for (const operation of ['edit', 'write'] as const) {
        expect(
          await readArtifact(context(chat), operation, 'artifact://grep-1'),
        ).toMatchObject({ status: 'error', type: 'invalid_path' });
      }
    });

    it('lists the Chat artifacts oldest first with their sizes', async () => {
      const chat = await createChat(tenantDb, owner, 'List');
      await write(chat, { content: 'a\nb\n' });
      await write(chat, {
        toolName: 'bash',
        parts: [
          {
            name: 'stdout',
            contentType: 'text/plain',
            content: Buffer.from('x\n'),
          },
        ],
      });

      const result = await read('artifact://', chat);
      const content = contentOf(result);
      expect(countOf(result)).toBe(2);
      expect(content.split('\n')[1]).toMatch(
        /^artifact:\/\/grep-1 \(grep, 2 lines, 4 bytes, \d{4}-/u,
      );
      expect(content).toContain('artifact://bash-2 (bash,');
    });

    it('lists a bash artifact streams', async () => {
      const chat = await createChat(tenantDb, owner, 'Streams');
      await write(chat, {
        toolName: 'bash',
        parts: [
          {
            name: 'stdout',
            contentType: 'text/plain',
            content: Buffer.from('o\n'),
          },
          {
            name: 'stderr',
            contentType: 'text/plain',
            content: Buffer.from('e\n'),
          },
        ],
      });

      const result = await read('artifact://bash-1', chat);
      const content = contentOf(result);
      expect(countOf(result)).toBe(2);
      expect(content).toContain(
        'artifact://bash-1/stdout (bash, 1 line, 2 bytes, 2026-',
      );
      expect(content).toContain(
        'artifact://bash-1/stderr (bash, 1 line, 2 bytes',
      );
    });

    it('keeps listing an artifact whose reply was replaced', async () => {
      const chat = await createChat(tenantDb, owner, 'Replaced');
      await write(chat);
      await tenantDb.runAs(owner, (tx) =>
        tx
          .update(schema.messages)
          .set({ revisedAt: new Date() })
          .where(eq(schema.messages.chatId, chat)),
      );

      expect(contentOf(await read('artifact://', chat))).toContain(
        'artifact://grep-1',
      );
    });

    it('numbers a long one-line part in 8,000-unit pieces', async () => {
      const chat = await createChat(tenantDb, owner, 'Pieces');
      await write(chat, { content: 'x'.repeat(20_000) });

      // One 8,003-unit piece already reaches the read bound, so the read
      // returns it and points at the next piece.
      const result = await read('artifact://grep-1:1-3', chat);
      expect(contentOf(result)).toBe(`1: ${'x'.repeat(8000)}\n`);
      expect(result).toMatchObject({ truncated: true, nextOffset: 1 });
      expect(await read('artifact://grep-1:4', chat)).toMatchObject({
        status: 'error',
        type: 'invalid_selector',
      });
    });

    it('outlines a Markdown part and reads another raw', async () => {
      const chat = await createChat(tenantDb, owner, 'Outline');
      await write(chat, {
        content:
          '# File a\nfirst paragraph\n\nsecond paragraph\n## File b\nthird paragraph\n\nfourth paragraph\n',
      });

      const outline = contentOf(await read('artifact://grep-1:outline', chat));
      expect(outline).toContain('# File a');
      expect(outline).toContain('## File b');
      expect(outline).not.toContain('second paragraph');
      expect(outline).not.toContain('fourth paragraph');
      expect(contentOf(await read('artifact://grep-1:4:raw', chat))).toBe(
        'second paragraph\n',
      );

      const plain = await write(chat, {
        toolName: 'bash',
        parts: [
          {
            name: 'stdout',
            contentType: 'text/plain',
            content: Buffer.from('x\n'),
          },
        ],
      });

      expect(await read(`${plain.locator}/stdout:outline`, chat)).toMatchObject(
        { status: 'error', type: 'invalid_selector' },
      );
    });

    it('returns not_found for another Chat of the same owner', async () => {
      await write(chatId);
      expect(await read('artifact://grep-1', otherChatId)).toMatchObject({
        status: 'error',
        type: 'not_found',
      });
      expect(countOf(await read('artifact://', otherChatId))).toBe(0);
    });

    it('rejects an unknown scheme prefix and a malformed locator', async () => {
      expect(await read('artifact://grep')).toMatchObject({
        status: 'error',
        type: 'invalid_path',
      });
      expect(await read('artifact://grep-1/stdout/extra')).toMatchObject({
        status: 'error',
        type: 'invalid_path',
      });
    });
  });

  async function listed(chat: string) {
    return tenantDb.runAs(owner, (tx) =>
      new ArtifactsRepository(tx).listChat(chat),
    );
  }

  async function seqOf(chat: string) {
    const [row] = await tenantDb.runAs(owner, (tx) =>
      tx
        .select({ seq: chats.artifactSeq })
        .from(chats)
        .where(eq(chats.id, chat)),
    );

    return row.seq;
  }
});

/** The PostgreSQL SQLSTATE behind a Drizzle-wrapped query failure. */
function sqlStateOf(error: unknown): string | undefined {
  let current = error;

  while (isRecord(current)) {
    const code = current['code'];

    if (isString(code)) return code;
    current = current['cause'];
  }

  return undefined;
}

async function createChat(
  tenantDb: TenantDbService,
  ownerUserId: string,
  title: string,
): Promise<string> {
  const chat = await tenantDb.runAs(ownerUserId, (tx) =>
    new ChatsRepository(tx).create({ ownerUserId, title }),
  );

  return chat.id;
}
