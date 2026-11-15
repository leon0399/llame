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
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ChatsRepository } from '../chats/chats-repository';
import { TenantDbService } from '../db/tenant-db.service';
import { readArtifact } from './artifacts/artifact-reader';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
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
    tenantDb = new TenantDbService(drizzle({ client: sql }));
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

  /** A read context: no Workspace root, so a finding keeps its host path. */
  function readContext(policy: ToolPermissionMap): ToolContext {
    const { workspaceRoot: _root, ...context } = contextWith(policy);

    return context;
  }

  function contextWith(policy: ToolPermissionMap): ToolContext {
    return {
      configuredCredentials: [],
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

  /** The stored part, read through the owner's identity so RLS serves it. */
  async function storedPart() {
    return await tenantDb.runAs(owner, async (tx) => {
      const repository = new ArtifactsRepository(tx);
      const part = await repository.readPart(chatId, 'grep', SEQ, '');

      if (part === undefined) throw new Error('the call stored no part');

      return part;
    });
  }

  async function storedText(): Promise<string> {
    return (await storedPart()).content.toString('utf8');
  }

  async function storedFindings(): Promise<
    ReadonlyArray<{
      locators: ReadonlyArray<string>;
      start: number;
      end: number;
    }>
  > {
    const document = (await storedPart()).findings;

    if (!isRecord(document) || !Array.isArray(document['findings'])) return [];

    return document['findings'].flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const locators = entry['locators'];
      const start = entry['start'];
      const end = entry['end'];

      if (!Array.isArray(locators) || !isNumber(start) || !isNumber(end))
        return [];

      return [
        {
          locators: locators.filter((locator): locator is string =>
            isString(locator),
          ),
          start,
          end,
        },
      ];
    });
  }

  async function read(
    locator: string,
    policy: ToolPermissionMap,
  ): Promise<string> {
    const result = await readArtifact(readContext(policy), 'read', locator);

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
    const secretDir = `${root}/secrets/`;
    const secretFile = `${secretDir}a.ts`;

    // A whole-artifact read is paged at the read bound; the secret directory
    // sorts after `public/`, so its heading is outside the first page.
    const firstPage = await read(locator, { read: { allow: true } });
    expect(firstPage).toContain(`## ${root}/public/file-000.ts`);

    // The artifact is Markdown: its outline names one heading per file, and
    // the stored finding range of each file starts at that heading line.
    const outline = await read(`${locator}:outline`, {
      read: { allow: true },
    });

    expect(outline).toContain(`## ${secretFile}`);
    expect(outline).toContain(`## ${root}/public/file-000.ts`);
    const findings = await storedFindings();
    const text = await storedText();
    const textLines = text.split('\n');
    const secret = findingOf(findings, secretFile);
    expect(textLines[secret.start - 1]).toBe(`## ${secretFile}`);

    if (secret.end < textLines.length)
      expect(textLines[secret.end]).toMatch(/^## /u);
    // The two-passage file: its range spans the blank separator, so a range
    // that counted it as zero lines would end one line early.
    const two = findingOf(findings, `${secretDir}two.ts`);
    expect(textLines[two.start - 1]).toBe(`## ${secretDir}two.ts`);
    const twoLines = textLines.slice(two.start - 1, two.end);
    expect(twoLines.some((line) => line.startsWith('*1: needle one'))).toBe(
      true,
    );
    expect(twoLines.some((line) => line.startsWith('*5: needle two'))).toBe(
      true,
    );
    expect(twoLines.filter((line) => line === '')).toHaveLength(1);

    // The finding's own range shows its heading and lines, then every line of
    // it is withheld once the directory is refused, without moving a number.
    const range = `${locator}:${String(secret.start)}-${String(secret.end)}`;
    const admitted = await read(range, { read: { allow: true } });
    expect(admitted).toContain(`## ${secretFile}`);
    expect(admitted).toContain(': needle');

    const withheld = await read(range, {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: `^${escapeRegex(secretDir)}` }],
      },
    });

    // The read window may include neighbouring lines; judge the finding's own
    // numbered lines, which must all be withheld.
    const served = withheld.split('\n').flatMap((line) => {
      const match = /^(\d+): /u.exec(line);

      return match === null ? [] : [{ number: Number(match[1]), line }];
    });

    const own = served.filter(
      (entry) => entry.number >= secret.start && entry.number <= secret.end,
    );

    expect(own).toHaveLength(secret.end - secret.start + 1);
    expect(own.every((entry) => entry.line.endsWith('[withheld]'))).toBe(true);
    expect(withheld).not.toContain('needle');

    // A file next to it keeps its own heading and lines.
    const publicFile = `${root}/public/file-000.ts`;
    const publicFinding = findingOf(findings, publicFile);

    const visible = await read(
      `${locator}:${String(publicFinding.start)}-${String(publicFinding.end)}`,
      {
        read: {
          allow: true,
          reject: [{ field: 'path', regex: `^${escapeRegex(secretDir)}` }],
        },
      },
    );

    expect(visible).toContain(`## ${publicFile}`);
    expect(visible).not.toContain('[withheld]');

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

/** One stored finding: its source locators and its artifact line range. */
type ArtifactFindingRow = {
  readonly locators: ReadonlyArray<string>;
  readonly start: number;
  readonly end: number;
};

/** The finding of one file, or a failure when the producer recorded none. */
function findingOf(
  findings: ReadonlyArray<ArtifactFindingRow>,
  file: string,
): ArtifactFindingRow {
  const found = findings.find((finding) => finding.locators.includes(file));

  if (found === undefined) throw new Error(`no finding recorded for ${file}`);

  return found;
}

/** A root with one secret directory and enough long passages to store an artifact. */
async function writeFixtures(root: string): Promise<void> {
  const long = (prefix: string): string => `${prefix}${'x'.repeat(600)}`;
  await mkdir(path.join(root, 'secrets'), { recursive: true });
  await writeFile(
    path.join(root, 'secrets', 'a.ts'),
    [long('a'), long('needle '), long('b')].join('\n'),
  );
  // Two passages of one file: the blank line between them must count in the
  // artifact's numbering, or the next finding's range shifts.
  await writeFile(
    path.join(root, 'secrets', 'two.ts'),
    [long('needle one'), long('b'), '', '', long('needle two')].join('\n'),
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
