/**
 * The artifact reader's routing, listings, paging, and selector placement, with
 * the repository scripted. The live rows and RLS behavior are in
 * artifact-store.integration.test.ts.
 */

import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../db/schema';
import { type TenantRunner } from '../../db/tenant-db.service';
import { isNumber, isString } from '@workspace/runtime-safety';
import { type ToolContext, type ToolResult } from '../types';
import { readArtifact } from './artifact-reader';
import {
  ArtifactsRepository,
  type ArtifactParts,
  type StoredPart,
} from './artifacts-repository';

const CHAT_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = 'owner-1';
const CREATED_AT = new Date('2026-11-02T10:00:00.000Z');
const ASIDE = '00000000-0000-4000-8000-000000000002';

function contextOf(chatId = CHAT_ID): ToolContext {
  const db = drizzle.mock({ schema });
  const runAs: TenantRunner['runAs'] = (_userId, fn) => fn(db);

  return {
    configuredCredentials: [],
    userId: USER_ID,
    chatId,
    tenantDb: { runAs },
  };
}

function part(
  content: string,
  lineCount: number,
  contentType = 'text/markdown',
): StoredPart {
  return {
    contentType,
    content: Buffer.from(content),
    lineCount,
    findings: null,
  };
}

function contentOf(result: ToolResult): string {
  if (result.status !== 'success' || !isString(result['content'])) {
    throw new Error(`Expected a read success, got ${JSON.stringify(result)}`);
  }

  return result['content'];
}

function countOf(result: ToolResult): number {
  if (result.status !== 'success' || !isNumber(result['entryCount'])) {
    throw new Error(`Expected a listing, got ${JSON.stringify(result)}`);
  }

  return result['entryCount'];
}

function scriptRepository() {
  return {
    listChat: vi.spyOn(ArtifactsRepository.prototype, 'listChat'),
    findParts: vi.spyOn(ArtifactsRepository.prototype, 'findParts'),
    readPart: vi.spyOn(ArtifactsRepository.prototype, 'readPart'),
  };
}

describe('readArtifact', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses edit and write as an invalid path without a query', async () => {
    const scripted = scriptRepository();

    for (const operation of ['edit', 'write'] as const) {
      expect(
        await readArtifact(contextOf(), operation, 'artifact://grep-1'),
      ).toMatchObject({ status: 'error', type: 'invalid_path' });
    }

    expect(scripted.findParts).not.toHaveBeenCalled();
  });

  it('refuses a malformed locator and an out-of-range number', async () => {
    scriptRepository();

    for (const path of [
      'artifact://grep',
      'artifact://grep-0',
      'artifact://grep-2147483648',
      'artifact://grep-1/stdout/extra',
    ]) {
      expect(await readArtifact(contextOf(), 'read', path)).toMatchObject({
        status: 'error',
        type: 'invalid_path',
      });
    }
  });

  it('lists the Chat artifacts oldest first in the Chat form', async () => {
    const scripted = scriptRepository();
    scripted.listChat.mockResolvedValue([
      {
        seq: 1,
        toolName: 'grep',
        createdAt: CREATED_AT,
        lineCount: 2,
        byteSize: 4,
      },
      {
        seq: 2,
        toolName: 'bash',
        createdAt: CREATED_AT,
        lineCount: 1,
        byteSize: 2,
      },
    ]);

    const result = await readArtifact(contextOf(), 'read', 'artifact://');

    expect(countOf(result)).toBe(2);
    const lines = contentOf(result).split('\n');
    expect(lines[0]).toBe('artifact://');
    expect(lines[1]).toBe(
      'artifact://grep-1 (grep, 2 lines, 4 bytes, 2026-11-02T10:00:00.000Z)',
    );
    expect(lines[2]).toBe(
      'artifact://bash-2 (bash, 1 line, 2 bytes, 2026-11-02T10:00:00.000Z)',
    );
  });

  it('lists an empty Chat as no artifacts', async () => {
    scriptRepository().listChat.mockResolvedValue([]);

    const result = await readArtifact(contextOf(), 'read', 'artifact://');

    expect(countOf(result)).toBe(0);
    expect(contentOf(result)).toBe('artifact://\n(no artifacts)\n');
  });

  it('places a single-range listing selector', async () => {
    const scripted = scriptRepository();
    scripted.listChat.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        seq: index + 1,
        toolName: 'grep',
        createdAt: CREATED_AT,
        lineCount: 1,
        byteSize: 1,
      })),
    );

    const result = await readArtifact(contextOf(), 'read', 'artifact://:2-3');

    expect(countOf(result)).toBe(5);
    expect(contentOf(result).split('\n')).toEqual([
      'artifact://',
      'artifact://grep-2 (grep, 1 line, 1 byte, 2026-11-02T10:00:00.000Z)',
      'artifact://grep-3 (grep, 1 line, 1 byte, 2026-11-02T10:00:00.000Z)',
      '',
    ]);
  });

  it('refuses a comma listing selector instead of returning every entry', async () => {
    const scripted = scriptRepository();

    const rows = Array.from({ length: 3 }, (_, index) => ({
      seq: index + 1,
      toolName: 'grep',
      createdAt: CREATED_AT,
      lineCount: 1,
      byteSize: 1,
    }));

    scripted.listChat.mockResolvedValue(rows);

    const result = await readArtifact(
      contextOf(),
      'read',
      'artifact://:1-2,-3',
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'invalid_selector',
    });
  });

  it('refuses an outline, a raw form, and an invalid listing selector', async () => {
    scriptRepository().listChat.mockResolvedValue([]);

    for (const selector of [':outline', ':raw', ':abc']) {
      expect(
        await readArtifact(contextOf(), 'read', `artifact://${selector}`),
      ).toMatchObject({ status: 'error', type: 'invalid_selector' });
    }
  });

  it('pages a listing that exceeds the read bound', async () => {
    const scripted = scriptRepository();
    scripted.listChat.mockResolvedValue(
      Array.from({ length: 400 }, (_, index) => ({
        seq: index + 1,
        toolName: 'mcp__docs__fetch',
        createdAt: CREATED_AT,
        lineCount: 1,
        byteSize: 1,
      })),
    );

    const first = await readArtifact(contextOf(), 'read', 'artifact://');

    expect(countOf(first)).toBe(400);
    expect(first).toMatchObject({ truncated: true });

    if (first.status !== 'success' || !isNumber(first['nextOffset']))
      throw new Error('Expected a paged listing');
    const page = contentOf(first).trimEnd().split('\n');
    expect(page[1]).toContain('artifact://mcp__docs__fetch-1 (');
    expect(page.at(-1)).toContain(
      `artifact://mcp__docs__fetch-${first['nextOffset']} (`,
    );

    const next = await readArtifact(
      contextOf(),
      'read',
      `artifact://:${first['nextOffset'] + 1}-`,
    );

    expect(contentOf(next).split('\n')[1]).toContain(
      `artifact://mcp__docs__fetch-${first['nextOffset'] + 1} (`,
    );
  });

  it('reads a named part with the ordinary selectors', async () => {
    const scripted = scriptRepository();
    scripted.readPart.mockResolvedValue(part('a\nb\nc\nd\ne\nf\ng\n', 7));

    const ranged = await readArtifact(
      contextOf(),
      'read',
      'artifact://grep-1/stdout:2',
    );

    expect(contentOf(ranged)).toBe('1: a\n2: b\n3: c\n');

    const raw = await readArtifact(
      contextOf(),
      'read',
      'artifact://grep-1/stdout:raw',
    );

    expect(contentOf(raw)).toBe('a\nb\nc\nd\ne\nf\ng\n');

    const multi = await readArtifact(
      contextOf(),
      'read',
      'artifact://grep-1/stdout:1,5',
    );

    // Each member keeps one context line, so lines 3 and 7 prove the gaps.
    expect(contentOf(multi)).toContain('5: e');
    expect(contentOf(multi)).not.toContain('3: c');
    expect(contentOf(multi)).not.toContain('7: g');
    expect(scripted.readPart).toHaveBeenCalledWith(
      CHAT_ID,
      'grep',
      1,
      'stdout',
    );
  });

  it('outlines a Markdown part without its later paragraphs', async () => {
    const scripted = scriptRepository();

    const markdown =
      '# File a\nfirst paragraph\n\nsecond paragraph\n## File b\nthird paragraph\n\nfourth paragraph\n';

    scripted.findParts.mockResolvedValue({
      createdAt: CREATED_AT,
      parts: [{ name: '', lineCount: 8, byteSize: markdown.length }],
    });
    scripted.readPart.mockResolvedValue(part(markdown, 8));

    const result = await readArtifact(
      contextOf(),
      'read',
      'artifact://grep-1:outline',
    );

    expect(contentOf(result)).toContain('# File a');
    expect(contentOf(result)).toContain('## File b');
    expect(contentOf(result)).not.toContain('second paragraph');
    expect(contentOf(result)).not.toContain('fourth paragraph');
    expect(result).toMatchObject({ representation: 'outline' });
  });

  it('reads an unnamed single part directly', async () => {
    const scripted = scriptRepository();
    scripted.findParts.mockResolvedValue({
      createdAt: CREATED_AT,
      parts: [{ name: '', lineCount: 1, byteSize: 2 }],
    });
    scripted.readPart.mockResolvedValue(part('x\n', 1, 'text/plain'));

    const result = await readArtifact(contextOf(), 'read', 'artifact://grep-1');

    expect(contentOf(result)).toBe('1: x\n');
    expect(scripted.readPart).toHaveBeenCalledWith(CHAT_ID, 'grep', 1, '');
  });

  it('says that an artifact with no stream has none', async () => {
    scriptRepository().findParts.mockResolvedValue({
      createdAt: CREATED_AT,
      parts: [],
    } satisfies ArtifactParts);

    const result = await readArtifact(contextOf(), 'read', 'artifact://bash-2');

    expect(contentOf(result)).toBe('artifact://bash-2\n(no streams)\n');
  });

  it('lists the streams of a bash artifact in the Chat form', async () => {
    const scripted = scriptRepository();
    scripted.findParts.mockResolvedValue({
      createdAt: CREATED_AT,
      parts: [
        { name: 'stderr', lineCount: 1, byteSize: 2 },
        { name: 'stdout', lineCount: 1, byteSize: 2 },
      ],
    } satisfies ArtifactParts);

    const result = await readArtifact(contextOf(), 'read', 'artifact://bash-2');

    expect(countOf(result)).toBe(2);
    expect(contentOf(result)).toContain(
      'artifact://bash-2/stdout (bash, 1 line, 2 bytes, 2026-11-02T10:00:00.000Z)',
    );
    expect(scripted.readPart).not.toHaveBeenCalled();
  });

  it('lists a bash artifact that spilled only one stream', async () => {
    scriptRepository().findParts.mockResolvedValue({
      createdAt: CREATED_AT,
      parts: [{ name: 'stdout', lineCount: 1, byteSize: 2 }],
    });

    const result = await readArtifact(contextOf(), 'read', 'artifact://bash-2');

    expect(countOf(result)).toBe(1);
    expect(contentOf(result)).toContain('artifact://bash-2/stdout (bash,');
  });

  it('refuses a comma selector on a stream list', async () => {
    scriptRepository().findParts.mockResolvedValue({
      createdAt: CREATED_AT,
      parts: [
        { name: 'stderr', lineCount: 1, byteSize: 2 },
        { name: 'stdout', lineCount: 1, byteSize: 2 },
      ],
    });

    expect(
      await readArtifact(contextOf(), 'read', 'artifact://bash-2:1-2,-3'),
    ).toMatchObject({ status: 'error', type: 'invalid_selector' });
  });

  it('scopes the read to the context Chat', async () => {
    const scripted = scriptRepository();
    scripted.findParts.mockImplementation((chatId) =>
      Promise.resolve(
        chatId === CHAT_ID
          ? {
              createdAt: CREATED_AT,
              parts: [{ name: '', lineCount: 1, byteSize: 2 }],
            }
          : undefined,
      ),
    );
    scripted.readPart.mockResolvedValue(part('x\n', 1, 'text/plain'));

    expect(
      await readArtifact(contextOf(ASIDE), 'read', 'artifact://grep-1'),
    ).toMatchObject({ status: 'error', type: 'not_found' });
    expect(scripted.findParts).toHaveBeenCalledWith(ASIDE, 'grep', 1);
    expect(
      contentOf(await readArtifact(contextOf(), 'read', 'artifact://grep-1')),
    ).toBe('1: x\n');
  });

  it('returns not_found for a missing artifact and an unknown part', async () => {
    const scripted = scriptRepository();
    scripted.findParts.mockResolvedValue(undefined);
    expect(
      await readArtifact(contextOf(), 'read', 'artifact://grep-9'),
    ).toMatchObject({ status: 'error', type: 'not_found' });

    scripted.findParts.mockResolvedValue({
      createdAt: CREATED_AT,
      parts: [{ name: 'stdout', lineCount: 1, byteSize: 2 }],
    });
    scripted.readPart.mockResolvedValue(undefined);
    expect(
      await readArtifact(contextOf(), 'read', 'artifact://bash-1/stdin'),
    ).toMatchObject({ status: 'error', type: 'not_found' });
  });

  it('accepts an upper-case scheme like every other locator reader', async () => {
    const scripted = scriptRepository();
    scripted.findParts.mockResolvedValue({
      createdAt: CREATED_AT,
      parts: [{ name: '', lineCount: 1, byteSize: 2 }],
    });
    scripted.readPart.mockResolvedValue(part('y\n', 1, 'text/plain'));
    scripted.listChat.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => ({
        seq: index + 1,
        toolName: 'grep',
        createdAt: CREATED_AT,
        lineCount: 1,
        byteSize: 1,
      })),
    );

    expect(
      contentOf(await readArtifact(contextOf(), 'read', 'ARTIFACT://grep-1')),
    ).toBe('1: y\n');
    expect(
      countOf(await readArtifact(contextOf(), 'read', 'ARTIFACT://')),
    ).toBe(3);
  });

  it('numbers a long one-line part by the stored line count', async () => {
    const scripted = scriptRepository();
    scripted.findParts.mockResolvedValue({
      createdAt: CREATED_AT,
      parts: [{ name: '', lineCount: 3, byteSize: 20_000 }],
    });
    scripted.readPart.mockResolvedValue({
      contentType: 'text/plain',
      content: Buffer.from('x'.repeat(20_000)),
      lineCount: 3,
      findings: null,
    });

    const result = await readArtifact(
      contextOf(),
      'read',
      'artifact://grep-1:1-3',
    );

    expect(contentOf(result)).toBe(`1: ${'x'.repeat(8000)}\n`);
    expect(result).toMatchObject({ truncated: true, nextOffset: 1 });
  });

  it('passes the Chat, tool, seq, and part name to the repository', async () => {
    const scripted = scriptRepository();
    scripted.findParts.mockResolvedValue({
      createdAt: CREATED_AT,
      parts: [{ name: '', lineCount: 2, byteSize: 4 }],
    });
    scripted.readPart.mockResolvedValue(part('a\nb\n', 2, 'text/plain'));

    const result = await readArtifact(
      contextOf(),
      'read',
      'artifact://grep-1:2',
    );

    expect(scripted.readPart).toHaveBeenCalledWith(CHAT_ID, 'grep', 1, '');
    expect(contentOf(result)).toBe('1: a\n2: b\n');
  });

  it('returns not_found for a missing named part', async () => {
    const scripted = scriptRepository();
    scripted.readPart.mockResolvedValue(undefined);

    expect(
      await readArtifact(contextOf(), 'read', 'artifact://grep-1/stdout'),
    ).toMatchObject({ status: 'error', type: 'not_found' });
  });
});
