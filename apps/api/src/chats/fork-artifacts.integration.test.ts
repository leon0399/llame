/**
 * The owner fork copies the artifacts its copied tool parts name
 * (tool-result-artifacts D11): the same locators resolve in the fork, a deleted
 * source keeps them, an artifact after the prefix is not copied, a shared fork
 * copies none, and a locator of another Chat is never pulled in.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { isNumber, isString } from '@workspace/runtime-safety';

import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { type ToolContext } from '../tools/types';
import { readArtifact } from '../tools/artifacts/artifact-reader';
import { writeToolArtifact } from '../tools/artifacts/artifact-writer';
import { ChatsService } from './chats.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const d = TEST_DB_URL ? describe : describe.skip;
const MAX_BYTES = 1_048_576;
const GREP_ONE = 'artifact://grep-1';

d('fork artifact copy', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let service: ChatsService;
  let owner: string;
  let stranger: string;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
      max: 6,
    });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    service = new ChatsService(
      tenantDb,
      noopReindexDispatch(),
      noopEmbedDispatch(),
      noopQueryEmbedder(),
    );
    owner = crypto.randomUUID();
    stranger = crypto.randomUUID();

    for (const id of [owner, stranger]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'F', ${`f-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${owner}, ${stranger})`;
      await sql.end();
    }
  });

  it('resolves a copied locator in the fork and continues its counter', async () => {
    const source = await seedSource({
      parts: [toolPart(GREP_ONE)],
      artifactContent: '# file\npassage\n',
    });

    const fork = await service.forkChat(source.chatId, owner);

    expect(await artifactText(fork.id, GREP_ONE)).toContain('passage');

    const next = await writeArtifact(fork.id, {
      toolName: 'web_search',
      content: 'result\n',
    });

    expect(next.locator).toBe('artifact://web_search-2');
  });

  it('keeps the fork artifacts after the source Chat is deleted', async () => {
    const source = await seedSource({
      parts: [toolPart(GREP_ONE)],
      artifactContent: 'kept\n',
    });

    const fork = await service.forkChat(source.chatId, owner);
    await service.deleteChat(owner, source.chatId);

    expect(await artifactText(fork.id, GREP_ONE)).toBe('1: kept\n');
  });

  it('does not copy an artifact named after the prefix', async () => {
    const source = await seedSource({
      parts: [toolPart(GREP_ONE)],
      artifactContent: 'before\n',
    });

    const anchor = await tenantDb.runAs(owner, async (tx) => {
      const messages = new MessagesRepository(tx);

      const user = await messages.create({
        chatId: source.chatId,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'next' }],
      });

      await messages.create({
        chatId: source.chatId,
        role: 'assistant',
        parts: [toolPart('artifact://bash-2/stdout')],
      });

      return user.id;
    });

    const bash = await writeArtifact(source.chatId, {
      toolName: 'bash',
      part: 'stdout',
      content: 'after\n',
    });

    expect(bash.locator).toBe('artifact://bash-2');

    const fork = await service.forkChat(source.chatId, owner, anchor);

    expect(await artifactText(fork.id, GREP_ONE)).toContain('before');
    expect(await read(fork.id, 'artifact://bash-2/stdout')).toMatchObject({
      status: 'error',
      type: 'not_found',
    });
    expect(await listCount(fork.id)).toBe(1);
  });

  it('copies no artifact into a shared fork', async () => {
    const source = await seedSource({
      parts: [toolPart(GREP_ONE)],
      artifactContent: 'secret\n',
      visibility: 'public',
    });

    const fork = await service.forkSharedChat(source.chatId, stranger);

    if (fork === undefined) throw new Error('Expected a shared fork');
    // Counted as the caller: the source's owner identity would mask a copy.
    expect(await listCount(fork.id, stranger)).toBe(0);
  });

  it('never copies an artifact of another Chat', async () => {
    // A name no earlier case can have written, so only a lookup that ignored
    // the source Chat could find it.
    const elsewhere = 'artifact://hunt-1';

    const other = await seedSource({
      parts: [],
      artifactContent: 'elsewhere\n',
      toolName: 'hunt',
    });

    const source = await seedSource({
      parts: [toolPart(elsewhere)],
      artifactContent: undefined,
    });

    const fork = await service.forkChat(source.chatId, owner);

    expect(await listCount(other.chatId)).toBe(1);
    expect(await listCount(fork.id)).toBe(0);
    expect(await read(fork.id, elsewhere)).toMatchObject({
      status: 'error',
      type: 'not_found',
    });
  });

  /** A Chat with a user turn and an assistant turn carrying `parts`; the
   *  optional artifact is written after the rows, as a tool call would. */
  async function seedSource(input: {
    parts: Array<unknown>;
    artifactContent: string | undefined;
    visibility?: 'private' | 'public';
    toolName?: string;
  }) {
    const chatId = await tenantDb.runAs(owner, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: owner,
        title: 'Source',
        visibility: input.visibility ?? 'private',
      });

      const messages = new MessagesRepository(tx);

      const user = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'q' }],
      });

      await messages.create({
        chatId: chat.id,
        role: 'assistant',
        parts: input.parts,
        inReplyTo: user.id,
      });

      return chat.id;
    });

    if (input.artifactContent !== undefined) {
      await writeArtifact(chatId, {
        content: input.artifactContent,
        ...(input.toolName !== undefined && { toolName: input.toolName }),
      });
    }

    return { chatId };
  }

  function toolPart(locator: string) {
    return {
      type: 'tool-grep',
      toolCallId: `call-${locator}`,
      state: 'output-available',
      input: {},
      output: { status: 'success', content: 'passage' },
      artifact: locator,
    };
  }

  function writeArtifact(
    chatId: string,
    input: {
      toolName?: string;
      content: string;
      part?: string;
    },
  ) {
    return writeToolArtifact(
      tenantDb,
      {
        chatId,
        userId: owner,
        runId: crypto.randomUUID(),
        toolCallId: crypto.randomUUID(),
        toolName: input.toolName ?? 'grep',
        complete: true,
        parts: [
          {
            ...(input.part !== undefined && { name: input.part }),
            contentType: 'text/markdown',
            content: Buffer.from(input.content),
          },
        ],
      },
      { maxBytes: MAX_BYTES },
    );
  }

  const context = (chatId: string, userId = owner): ToolContext => ({
    configuredCredentials: [],
    userId,
    chatId,
    tenantDb,
  });

  function read(chatId: string, locator: string, userId = owner) {
    return readArtifact(context(chatId, userId), 'read', locator);
  }

  async function artifactText(chatId: string, locator: string) {
    const result = await read(chatId, locator);

    if (result.status !== 'success' || !isString(result['content'])) {
      throw new Error(`Expected a read success, got ${JSON.stringify(result)}`);
    }

    return result['content'];
  }

  async function listCount(chatId: string, userId = owner): Promise<number> {
    const result = await read(chatId, 'artifact://', userId);

    if (result.status !== 'success' || !isNumber(result['entryCount'])) {
      throw new Error(`Expected a listing, got ${JSON.stringify(result)}`);
    }

    return result['entryCount'];
  }
});
