/**
 * The `grep` artifact producer against a live database (tool-result-artifacts
 * D5, D7): the real walk stores its whole result with one finding per file, a
 * `read` reject added afterwards withholds a file's heading and its lines
 * through `artifact://`, and the host file the writer made still holds them.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { isString } from '@workspace/runtime-safety';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../db/schema';
import { ChatsRepository } from '../chats/chats-repository';
import { TenantDbService } from '../db/tenant-db.service';
import { readArtifact } from './artifacts/artifact-reader';
import { grepInputSchema, nativeGrepTool } from './grep';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolPermissionMap } from './permissions/types';
import { type ToolContext, type ToolResult } from './types';
import { createWorkspaceRootCell } from './workspace-path';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const d = TEST_DB_URL ? describe : describe.skip;

/** The Chat's first artifact number. */
const SEQ = 1;

let root: string;
let previousTmpdir: string | undefined;

d('grep artifact producer', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let owner: string;
  let chatId: string;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
      max: 4,
    });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    owner = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${owner}, 'A', ${`a-${owner}@t.com`})`;
    chatId = await tenantDb
      .runAs(owner, (tx) =>
        new ChatsRepository(tx).create({ ownerUserId: owner, title: 'Grep' }),
      )
      .then((chat) => chat.id);
    root = await realpath(
      await mkdtemp(path.join(tmpdir(), 'llame-grep-artifact-it-')),
    );
    await mkdir(path.join(root, '.git'), { recursive: true });
    // Host files land under the test's own `$TMPDIR`.
    previousTmpdir = process.env['TMPDIR'];
    process.env['TMPDIR'] = await mkdtemp(
      path.join(tmpdir(), 'llame-grep-artifact-host-'),
    );
    await writeFixtures(root);
  });

  afterAll(async () => {
    if (previousTmpdir === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = previousTmpdir;
    await rm(root, { recursive: true, force: true });
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${owner}`;
      await sql.end();
    }
  });

  function contextWith(policy: ToolPermissionMap): ToolContext {
    return {
      userId: owner,
      chatId,
      runId: crypto.randomUUID(),
      toolCallId: crypto.randomUUID(),
      nativeExecutorId: 'host-a',
      tenantDb,
      artifactReadable: true,
      artifactHostFiles: true,
      permissionPolicy: compileToolPermissionMap(policy, 'p'),
      workspaceRoot: createWorkspaceRootCell(root),
    };
  }

  async function read(
    locator: string,
    policy: ToolPermissionMap,
  ): Promise<string> {
    const result = await readArtifact(contextWith(policy), 'read', locator);
    if (result.status !== 'success' || !isString(result['content'])) {
      throw new Error(`Expected a read success: ${JSON.stringify(result)}`);
    }
    return result['content'];
  }

  it('withholds a grep finding a new reject names and keeps its host file', async () => {
    const parsed = grepInputSchema.safeParse({
      patterns: ['needle'],
      scopes: [`${root}/**`],
    });
    if (!parsed.success) throw new Error('the fixture arguments must parse');
    const result: ToolResult = await nativeGrepTool.execute(
      contextWith({ grep: { allow: true }, read: { allow: true } }),
      parsed.data,
    );
    if (result.status !== 'success' || !isString(result['artifact'])) {
      throw new Error(`Expected a stored artifact: ${JSON.stringify(result)}`);
    }
    const locator = result['artifact'];
    const secretFile = `${root}/secrets/a.ts`;

    const before = await read(locator, { read: { allow: true } });
    expect(before).toContain(`## ${secretFile}`);
    expect(before).toContain(': needle');

    // The artifact is Markdown: its outline names one heading per file.
    const outline = await read(`${locator}:outline`, {
      read: { allow: true },
    });
    expect(outline).toContain(`## ${secretFile}`);
    expect(outline).toContain(`## ${root}/public/file-000.ts`);

    const after = await read(locator, {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: `^${escapeRegex(secretFile)}` }],
      },
    });
    // The heading and the passage's lines are withheld; every other file's
    // lines keep their text and their numbers.
    expect(
      after.split('\n').filter((line) => line === '[withheld]'),
    ).toHaveLength(4);
    expect(after).not.toContain(`## ${secretFile}`);
    expect(after).toContain(`## ${root}/public/file-000.ts`);
    expect(after.split('\n').length).toBe(before.split('\n').length);

    // The host file the writer made holds the finding as it was admitted.
    const hostFile = path.join(
      tmpdir(),
      'llame',
      'chats',
      chatId,
      'artifacts',
      `grep-${String(SEQ)}.md`,
    );
    const stored = await readFile(hostFile, 'utf8');
    expect(stored).toContain(`## ${secretFile}`);
    expect(stored).toContain('needle');
    expect(stored).not.toContain('[withheld]');
  });
});

/** A root with one secret file and enough long passages to store an artifact. */
async function writeFixtures(root: string): Promise<void> {
  const long = (prefix: string): string => `${prefix}${'x'.repeat(600)}`;
  await mkdir(path.join(root, 'secrets'), { recursive: true });
  await writeFile(
    path.join(root, 'secrets', 'a.ts'),
    [long('a'), long('needle '), long('b')].join('\n'),
  );
  await mkdir(path.join(root, 'public'), { recursive: true });
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      writeFile(
        path.join(root, 'public', `file-${String(index).padStart(3, '0')}.ts`),
        [long('a'), long('needle '), long('b')].join('\n'),
      ),
    ),
  );
}

function escapeRegex(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}
