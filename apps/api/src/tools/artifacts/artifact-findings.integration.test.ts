/**
 * The read-time finding re-check on a live database (tool-result-artifacts
 * D5): a new `read` reject withholds a `grep` finding and leaves its outline,
 * a `bash` part is judged by no policy, a `web_search` result follows its
 * producer's reject-only rule, a bypassed attempt sees everything, the
 * re-check records no decision, and an `artifact://` allow reaches only its own
 * Chat.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { isString } from '@workspace/runtime-safety';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../../db/schema';
import { ChatsRepository } from '../../chats/chats-repository';
import { TenantDbService } from '../../db/tenant-db.service';
import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { type PermissionMode } from '../permissions/permission-mode';
import { type ToolPermissionMap } from '../permissions/types';
import { type ToolContext, type ToolResult } from '../types';
import { readArtifact } from './artifact-reader';
import { writeToolArtifact } from './artifact-writer';
import { type ArtifactFinding, artifactFindings } from './findings';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const d = TEST_DB_URL ? describe : describe.skip;

const SECRET_FILE = '/home/u/secrets/a.ts';
const PUBLIC_FILE = '/home/u/public/b.ts';
const WEB_URL = 'https://example.com/report';

const GREP_TEXT = `## ${SECRET_FILE}\n1: token\n## ${PUBLIC_FILE}\n1: ok\n`;
const WEB_TEXT = `## 1. Report\n${WEB_URL}\n> snippet\n`;
const BASH_TEXT = 'secret token\n';

type SqlClient = Sql;

d('artifact finding re-check', () => {
  let sql: SqlClient;
  let tenantDb: TenantDbService;
  let owner: string;
  let chatId: string;
  let otherChatId: string;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
      max: 4,
    });
    tenantDb = new TenantDbService(drizzle({ client: sql }));
    owner = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${owner}, 'A', ${`a-${owner}@t.com`})`;
    chatId = await createChat(tenantDb, owner, 'Findings');
    otherChatId = await createChat(tenantDb, owner, 'Other');
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${owner}`;
      await sql.end();
    }
  });

  function contextWith(options: {
    chat?: string;
    policy?: ToolPermissionMap;
    mode?: PermissionMode;
    onDerivedDecision?: () => void;
  }): ToolContext {
    return {
      configuredCredentials: [],
      userId: owner,
      chatId: options.chat ?? chatId,
      tenantDb,
      permissionPolicy: compileToolPermissionMap(options.policy ?? {}, 'p'),
      ...(options.mode !== undefined && { permissionMode: options.mode }),
      ...(options.onDerivedDecision !== undefined && {
        onDerivedDecision: options.onDerivedDecision,
      }),
    };
  }

  function write(
    findings: ReadonlyArray<ArtifactFinding>,
    content = GREP_TEXT,
    toolName = 'grep',
  ) {
    return writeToolArtifact(
      tenantDb,
      {
        chatId,
        userId: owner,
        runId: crypto.randomUUID(),
        toolCallId: crypto.randomUUID(),
        toolName,
        complete: true,
        parts: [
          {
            contentType: 'text/markdown',
            content: Buffer.from(content),
            findings: artifactFindings(findings),
          },
        ],
      },
      { maxBytes: 1_048_576 },
    );
  }

  const grepFindings: ReadonlyArray<ArtifactFinding> = [
    { locators: [SECRET_FILE], rule: 'allow_only', start: 1, end: 2 },
    { locators: [PUBLIC_FILE], rule: 'allow_only', start: 3, end: 4 },
  ];

  async function read(
    locator: string,
    context = contextWith({}),
  ): Promise<string> {
    return contentOf(await readArtifact(context, 'read', locator));
  }

  it('withholds a new rejected grep finding and keeps the line numbers', async () => {
    const artifact = await write(grepFindings);

    const text = await read(
      artifact.locator,
      contextWith({
        policy: {
          read: { allow: [{ field: 'path', regex: '^/home/u/public/' }] },
        },
      }),
    );

    expect(text).toBe(
      `1: [withheld]\n2: [withheld]\n3: ## ${PUBLIC_FILE}\n4: 1: ok\n`,
    );
  });

  it('leaves a withheld file out of the outline', async () => {
    const artifact = await write(grepFindings);

    const text = await read(
      `${artifact.locator}:outline`,
      contextWith({
        policy: {
          read: { allow: [{ field: 'path', regex: '^/home/u/public/' }] },
        },
      }),
    );

    expect(text).not.toContain('secrets');
    expect(text).toContain(PUBLIC_FILE);
  });

  it('evaluates no finding of a bash part', async () => {
    const artifact = await writeToolArtifact(
      tenantDb,
      {
        chatId,
        userId: owner,
        runId: crypto.randomUUID(),
        toolCallId: crypto.randomUUID(),
        toolName: 'bash',
        complete: true,
        parts: [
          {
            name: 'stdout',
            contentType: 'text/plain',
            content: Buffer.from(BASH_TEXT),
          },
        ],
      },
      { maxBytes: 1_048_576 },
    );

    const text = await read(
      `${artifact.locator}/stdout`,
      contextWith({ policy: { read: { reject: true } } }),
    );

    expect(text).toContain('secret token');
    expect(text).not.toContain('[withheld]');
  });

  it('withholds a web result after a reject and keeps one without an allow', async () => {
    const artifact = await write(
      [{ locators: [WEB_URL], rule: 'reject_only', start: 1, end: 3 }],
      WEB_TEXT,
      'web_search',
    );

    const rejected = await read(
      artifact.locator,
      contextWith({
        policy: {
          read: { reject: [{ field: 'path', regex: 'example\\.com' }] },
        },
      }),
    );

    expect(rejected).not.toContain(WEB_URL);
    expect(rejected).toContain('[withheld]');

    const visible = await read(
      artifact.locator,
      contextWith({
        policy: { read: { allow: [{ field: 'path', regex: '^/home/' }] } },
      }),
    );

    expect(visible).toContain(WEB_URL);
    expect(visible).not.toContain('[withheld]');
  });

  it('sees every finding on a bypassed attempt', async () => {
    const artifact = await write(grepFindings);

    const text = await read(
      artifact.locator,
      contextWith({
        policy: { read: { reject: [{ field: 'path', regex: '^/home/' }] } },
        mode: 'bypass',
      }),
    );

    expect(text).toContain('token');
    expect(text).not.toContain('[withheld]');
  });

  it('records no finding decision', async () => {
    const artifact = await write(grepFindings);
    const onDerivedDecision = vi.fn();
    await read(
      artifact.locator,
      contextWith({
        policy: {
          read: { allow: [{ field: 'path', regex: '^/home/u/public/' }] },
        },
        onDerivedDecision,
      }),
    );

    expect(onDerivedDecision).not.toHaveBeenCalled();
  });

  it('reaches only the Chat of an allowed artifact locator', async () => {
    const artifact = await write(grepFindings);

    const result = await readArtifact(
      contextWith({
        chat: otherChatId,
        policy: { read: { allow: [{ field: 'path', regex: '^artifact://' }] } },
      }),
      'read',
      artifact.locator,
    );

    expect(result).toMatchObject({ status: 'error', type: 'not_found' });
  });

  it('still reads an artifact after a checkpoint absorbs its turn', async () => {
    const artifact = await write(grepFindings);
    await tenantDb.runAs(owner, (tx) =>
      tx.insert(schema.messages).values({
        chatId,
        seq: 1,
        role: 'checkpoint',
        absorbedThroughSeq: 1,
        parts: [],
      }),
    );

    const text = await read(
      artifact.locator,
      contextWith({
        policy: { read: { allow: [{ field: 'path', regex: '^/home/u/' }] } },
      }),
    );

    expect(text).toContain(PUBLIC_FILE);
  });
});

function contentOf(result: ToolResult): string {
  if (result.status !== 'success' || !isString(result['content'])) {
    throw new Error(`Expected a read success, got ${JSON.stringify(result)}`);
  }

  return result['content'];
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
