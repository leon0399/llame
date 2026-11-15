/**
 * `bash` stream spill against a live database (tool-result-artifacts D4): a
 * large output is stored whole as a `bash-<n>/stdout` part and read back
 * through its artefact locator, and a one-line JSON `stdout` is numbered and
 * read in 8,000-unit pieces. The call records the inline preview and the
 * locator, never the full stream.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { isString } from '@workspace/runtime-safety';
import { describe, expect, it } from 'vitest';

import { ChatsRepository } from '../chats/chats-repository';
import { TenantDbService } from '../db/tenant-db.service';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { readArtifact } from './artifacts/artifact-reader';
import { spillBashResult } from './bash-spill';
import { type ToolContext, type ToolResult } from './types';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL is required for bash spill tests');
}

const MAX_BYTES = 8_388_608;

/** A 3 MB log in 100-character lines. */
function largeLog(): string {
  return Array.from(
    { length: 30_000 },
    (_, index) => `line ${String(index).padStart(5, '0')} ${'x'.repeat(89)}`,
  ).join('\n');
}

describe('bash stream spill', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let owner: string;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL, {
      ssl: /sslmode=require/.test(TEST_DB_URL) ? 'require' : false,
      max: 4,
    });
    tenantDb = new TenantDbService(drizzle({ client: sql }));
    owner = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${owner}, 'A', ${`a-${owner}@t.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${owner}`;
      await sql.end();
    }
  });

  async function context(): Promise<ToolContext> {
    const chat = await tenantDb.runAs(owner, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId: owner, title: 'Bash' }),
    );

    return {
      configuredCredentials: [],
      userId: owner,
      chatId: chat.id,
      runId: crypto.randomUUID(),
      toolCallId: crypto.randomUUID(),
      tenantDb,
      permissionPolicy: compileTestPermissionPolicy(),
      artifactReadable: true,
      artifactMaxBytes: MAX_BYTES,
    };
  }

  function successful(stdout: string) {
    return {
      status: 'success' as const,
      exitCode: 0,
      stdout,
      stderr: '',
      truncated: false,
      wallTimeMs: 12,
    };
  }

  async function read(toolContext: ToolContext, locator: string) {
    return readArtifact(toolContext, 'read', locator);
  }

  function contentOf(result: ToolResult): string {
    if (result.status !== 'success' || !isString(result['content']))
      throw new Error(`Expected a read success, got ${JSON.stringify(result)}`);

    return result['content'];
  }

  it('stores a 3 MB output whole and reads it through its locator', async () => {
    const toolContext = await context();
    const log = largeLog();
    const result = await spillBashResult(toolContext, successful(log));

    expect(result.status).toBe('success');

    if (result.status !== 'success') return;
    expect(result.artifact).toBe('artifact://bash-1');
    // The recorded result holds the preview and the locator, not the stream.
    expect(String(result.stdout).length).toBeLessThan(17_000);
    expect(result.truncationNotice).toBe(
      'full result: artifact://bash-1/stdout (30000 lines)',
    );

    const first = contentOf(
      await read(toolContext, 'artifact://bash-1/stdout:1-3'),
    );

    expect(first).toContain('1: line 00000');
    expect(first).toContain('3: line 00002');

    const last = contentOf(
      await read(toolContext, 'artifact://bash-1/stdout:30000'),
    );

    expect(last).toContain('line 29999');
  });

  it('numbers a one-line JSON stdout in pieces and reads the pieces', async () => {
    const toolContext = await context();

    const json = JSON.stringify({
      items: Array.from({ length: 4000 }, (_, index) => index),
    });

    const result = await spillBashResult(toolContext, successful(json));

    expect(result.status).toBe('success');

    if (result.status !== 'success') return;
    // One source line of about 20,000 units counts as three artifact lines.
    expect(result.truncationNotice).toBe(
      'full result: artifact://bash-1/stdout (3 lines)',
    );

    const first = contentOf(
      await read(toolContext, 'artifact://bash-1/stdout:1-1'),
    );

    expect(first).toContain('1: {"items":[');
    // The first piece is the 8,000-unit prefix of the one source line.
    const piece = first.slice(first.indexOf(': ') + 2).trimEnd();
    expect(piece.length).toBe(8000);
    expect(json.startsWith(piece)).toBe(true);
  });
});
