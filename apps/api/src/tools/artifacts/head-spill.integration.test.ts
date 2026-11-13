/**
 * A `head` spill on a live database: the stored part is the pretty-printed JSON
 * rendering, and `read("artifact://mcp__docs__fetch-1:1-200")` returns its first
 * numbered lines, the start of the long text value included, with a
 * continuation line naming the next line (tool-result-artifacts "A result that
 * does not fit is stored as an artifact" — "A long JSON result is read by
 * lines").
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { isString } from '@workspace/runtime-safety';

import { TenantDbService } from '../../db/tenant-db.service';
import { ChatsRepository } from '../../chats/chats-repository';
import { renderToolResultText } from '../model-text';
import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { type ToolContext, type ToolResult } from '../types';
import { readArtifact } from './artifact-reader';
import { capHeadResult } from './spill';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const d = TEST_DB_URL ? describe : describe.skip;
const LOCATOR = 'artifact://mcp__docs__fetch-1';

d('head spill', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let owner: string;
  let chatId: string;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
      max: 2,
    });
    tenantDb = new TenantDbService(drizzle({ client: sql }));
    owner = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${owner}, 'A', ${`a-${owner}@t.com`})`;

    const chat = await tenantDb.runAs(owner, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId: owner, title: 'Main' }),
    );

    chatId = chat.id;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${owner}`;
      await sql.end();
    }
  });

  const context = (): ToolContext => ({
    configuredCredentials: [],
    userId: owner,
    chatId,
    runId: crypto.randomUUID(),
    toolCallId: crypto.randomUUID(),
    tenantDb,
    artifactReadable: true,
    permissionPolicy: compileToolPermissionMap(
      { read: { allow: [{ field: 'path', regex: '^artifact://' }] } },
      'test-policy',
    ),
  });

  it('reads a long JSON text value by lines with a continuation', async () => {
    const longText = 'x'.repeat(400_000);

    const spilled = await capHeadResult(context(), 'mcp__docs__fetch', {
      status: 'success',
      text: longText,
    });

    expect(spilled).toMatchObject({ artifact: LOCATOR, truncated: true });
    const read = await readArtifact(context(), 'read', `${LOCATOR}:1-200`);
    const text = renderToolResultText('read', read);
    expect(text).toContain('"text": "xxxxxxxx');
    expect(text).toMatch(
      /Use artifact:\/\/mcp__docs__fetch-1:\d+- to continue\]/u,
    );

    // The raw part is the pretty-printed JSON: one member on each line, and
    // its long value is read in bounded pieces.
    const stored = await readArtifact(context(), 'read', `${LOCATOR}:raw`);
    expect(contentOf(stored)).toContain(
      '{\n  "status": "success",\n  "text": "xxxxxxxx',
    );
    expect(stored).toMatchObject({ truncated: true });
  });
});

function contentOf(result: ToolResult): string {
  if (result.status !== 'success' || !isString(result.content)) {
    throw new Error(`Expected a read success, got ${JSON.stringify(result)}`);
  }

  return result.content;
}
