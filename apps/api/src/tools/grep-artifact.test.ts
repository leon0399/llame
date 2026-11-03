/**
 * `grep` result artifacts (tool-result-artifacts D3, D7): the whole result is
 * stored as Markdown while the walk runs, its inline part is the head of that
 * text, the framing lines follow, and the walk stops at the artifact bound. A
 * Run that cannot read an artifact keeps the head and counts what it left out.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import {
  grepLeftOutUnits,
  measureGrepRendering,
  type GrepPassage,
} from '@workspace/native-file-tools';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
import { finishGrepCall } from './grep-artifact';
import { addGrepPassages, createPageState, pageResult } from './grep-page';
import { grepInputSchema, nativeGrepTool } from './grep';
import { renderToolResultText } from './model-text';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolContext, type ToolResult } from './types';
import { createWorkspaceRootCell } from './workspace-path';

/** The Chat counter every write in this suite takes: seq 1. */
const SEQ = 1;

/** The creation time the mocked insert reports. */
const CREATED_AT = new Date('2026-11-02T12:00:00.000Z');

type ArtifactWrites = {
  readonly nextSeq: MockInstance<ArtifactsRepository['nextSeq']>;
  readonly insertArtifact: MockInstance<ArtifactsRepository['insertArtifact']>;
  readonly insertParts: MockInstance<ArtifactsRepository['insertParts']>;
};

let writes: ArtifactWrites;
let root: string;

/** One call's trusted context with a mocked tenant database. */
function contextOf(overrides: Partial<ToolContext> = {}): ToolContext {
  const db: Db = drizzle.mock({ schema });
  return {
    userId: 'owner-a',
    chatId: 'chat-a',
    runId: 'run-a',
    toolCallId: 'call-a',
    nativeExecutorId: 'host-a',
    permissionPolicy: compileToolPermissionMap(
      { grep: { allow: true }, read: { allow: true } },
      'test',
    ),
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    artifactReadable: true,
    workspaceRoot: createWorkspaceRootCell(root),
    ...overrides,
  };
}

/** One file below `root`, with its parent directories. */
async function writeAt(relative: string, content: string): Promise<void> {
  const target = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

/** A line long enough that a few of them fill the inline bound. */
function longLine(prefix: string, units = 600): string {
  return `${prefix}${'x'.repeat(units)}`;
}

/** `count` files of one long passage each: a match with one context line each side. */
async function writePassageFiles(count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      writeAt(
        `d/file-${String(index).padStart(3, '0')}.ts`,
        [longLine('a'), longLine('needle '), longLine('b')].join('\n'),
      ),
    ),
  );
}

async function run(context: ToolContext, args: unknown): Promise<ToolResult> {
  const parsed = grepInputSchema.safeParse(args);
  if (!parsed.success) throw new Error('the fixture arguments must parse');
  return nativeGrepTool.execute(context, parsed.data);
}

function success(result: ToolResult): ToolResult & { status: 'success' } {
  if (result.status !== 'success') {
    throw new Error(`expected success, received ${result.type}`);
  }
  return result;
}

function writtenParts() {
  return writes.insertParts.mock.calls[0]?.[1] ?? [];
}

function artifactText(): string {
  const part = writtenParts()[0];
  if (part === undefined) throw new Error('the call wrote no artifact part');
  return part.content.toString('utf8');
}

/** The inline passages, reduced to the marks the tests assert. */
type InlinePassage = {
  readonly cut: boolean;
  readonly truncated: boolean;
  readonly locator: string;
  readonly content: string;
  readonly matches: ReadonlyArray<number>;
};

/** The inline passages, with only the fields the tests assert. */
function resultsOf(result: ToolResult): ReadonlyArray<InlinePassage> {
  const results = success(result).results;
  if (!Array.isArray(results)) return [];
  return results.filter(isRecord).map((entry) => ({
    cut: entry['cut'] === true,
    truncated: entry['truncated'] === true,
    locator: isString(entry['locator']) ? entry['locator'] : '',
    content: isString(entry['content']) ? entry['content'] : '',
    matches: Array.isArray(entry['matches'])
      ? entry['matches'].filter((match): match is number => isNumber(match))
      : [],
  }));
}

/** The stored left-out count, when the result carries one. */
function leftOutOf(
  result: ToolResult,
): { readonly count: number; readonly of: string } | undefined {
  const leftOut = success(result).leftOut;
  if (!isRecord(leftOut)) return undefined;
  const { count, of } = leftOut;
  if (!isNumber(count) || !isString(of)) return undefined;
  return { count, of };
}

/** The one-based last line the inline part shows of its single passage. */
function endLineOf(result: ToolResult): number {
  const locator = resultsOf(result)[0]?.locator ?? '';
  return Number(/:\d+-(\d+)$/u.exec(locator)?.[1]);
}

/** The stored notice text of a result, without its brackets. */
function bodyText(result: ToolResult): string {
  const notice = success(result).truncationNotice;
  return isString(notice) ? notice : '';
}

function headings(text: string): ReadonlyArray<string> {
  return text.split('\n').filter((line) => line.startsWith('## '));
}

function warningsOf(result: ToolResult): ReadonlyArray<string> {
  const warnings = success(result).warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.flatMap((warning) =>
    isRecord(warning) && isString(warning['kind']) ? [warning['kind']] : [],
  );
}

function remainderOf(result: ToolResult):
  | {
      readonly files: number;
      readonly passages: number;
      readonly next: ReadonlyArray<{
        readonly locator: string;
        readonly start: number;
        readonly end: number;
      }>;
    }
  | undefined {
  const remainder = success(result).remainder;
  if (!isRecord(remainder)) return undefined;
  const next = Array.isArray(remainder['next']) ? remainder['next'] : [];
  return {
    files: Number(remainder['files']),
    passages: Number(remainder['passages']),
    next: next.filter(isRecord).map((entry) => ({
      locator: String(entry['locator']),
      start: Number(entry['start']),
      end: Number(entry['end']),
    })),
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  root = await realpath(
    await mkdtemp(path.join(tmpdir(), 'llame-grep-artifact-')),
  );
  // A repository at the root seals the walk: nothing above it can change which
  // ignore files apply.
  await mkdir(path.join(root, '.git'), { recursive: true });
  writes = {
    nextSeq: vi
      .spyOn(ArtifactsRepository.prototype, 'nextSeq')
      .mockResolvedValue(SEQ),
    insertArtifact: vi
      .spyOn(ArtifactsRepository.prototype, 'insertArtifact')
      .mockResolvedValue({ id: 'artifact-1', createdAt: CREATED_AT }),
    insertParts: vi
      .spyOn(ArtifactsRepository.prototype, 'insertParts')
      .mockResolvedValue(undefined),
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('grep artifacts', () => {
  it('stores the whole walk and keeps the head of its text inline', async () => {
    await writePassageFiles(25);
    const result = await run(contextOf(), {
      patterns: ['needle'],
      scopes: [`${root}/d/**`],
    });

    const body = success(result);
    expect(body.artifact).toBe('artifact://grep-1');
    expect(body.complete).toBe(true);
    expect(warningsOf(result)).toEqual([]);
    // The walk examined every file even though the inline part filled.
    expect(headings(artifactText())).toHaveLength(25);
    expect(writtenParts()[0]?.contentType).toBe('text/markdown');
    const inline = resultsOf(result);
    expect(inline.length).toBeGreaterThan(0);
    expect(inline.length).toBeLessThan(25);
    expect(renderToolResultText('grep', result).length).toBeLessThanOrEqual(
      15_000,
    );
    const remainder = remainderOf(result);
    expect(remainder).toBeDefined();
    expect(remainder?.files).toBe(25 - inline.length);
    expect(remainder?.passages).toBe(25 - inline.length);
    expect(remainder?.next).toHaveLength(10);
    // Each named range starts at the file's heading line in the artifact.
    const lines = artifactText().split('\n');
    for (const entry of remainder?.next ?? []) {
      expect(lines[entry.start - 1]).toBe(`## ${entry.locator}`);
    }
  });

  it('keeps inline line numbers equal to the artifact lines', async () => {
    await writePassageFiles(25);
    const result = await run(contextOf(), {
      patterns: ['needle'],
      scopes: [`${root}/d/**`],
    });

    const remainder = remainderOf(result);
    expect(remainder).toBeDefined();
    const shown = (remainder?.next[0]?.start ?? 1) - 1;
    const artifactLines = artifactText().split('\n').slice(0, shown);
    const inlineLines = renderToolResultText('grep', result)
      .split('\n')
      .slice(0, shown);
    expect(inlineLines).toEqual(artifactLines);
  });

  it('ends the notice at the line after the inline part', async () => {
    await writePassageFiles(25);
    const result = await run(contextOf(), {
      patterns: ['needle'],
      scopes: [`${root}/d/**`],
    });

    const body = success(result);
    const remainder = remainderOf(result);
    const next = remainder?.next[0]?.start;
    const lines = artifactText().split('\n').length;
    expect(body.truncationNotice).toBe(
      `full result: artifact://grep-1 (${String(lines)} lines); continue with artifact://grep-1:${String(next)}-`,
    );
  });

  it('creates no artifact for a result that fits inline', async () => {
    await writeAt('d/a.ts', '1: needle\n');
    await writeAt('d/b.ts', '1: needle\n');
    const result = await run(contextOf(), {
      patterns: ['needle'],
      scopes: [`${root}/d/**`],
    });

    expect(resultsOf(result)).toHaveLength(2);
    expect(success(result)).not.toHaveProperty('artifact');
    expect(writes.insertParts).not.toHaveBeenCalled();
  });

  it('creates no artifact for a walk with no match', async () => {
    await writeAt('d/a.ts', '1: nothing\n');
    await writeAt('d/b.bin', '\u0000\u0001\u0002');
    const result = await run(contextOf(), {
      patterns: ['needle'],
      scopes: [`${root}/d/**`],
    });

    expect(success(result)).toMatchObject({ results: [], complete: true });
    expect(success(result)).not.toHaveProperty('artifact');
    expect(warningsOf(result)).toEqual(['binary']);
    expect(writes.insertParts).not.toHaveBeenCalled();
  });

  it('keeps the head and counts the files it left out without a reader', async () => {
    await writePassageFiles(25);
    const result = await run(contextOf({ artifactReadable: false }), {
      patterns: ['needle'],
      scopes: [`${root}/d/**`],
    });

    expect(writes.insertParts).not.toHaveBeenCalled();
    expect(success(result)).not.toHaveProperty('artifact');
    const leftOut = leftOutOf(result);
    expect(leftOut?.of).toBe('files');
    const count = 25 - resultsOf(result).length;
    expect(leftOut?.count).toBe(count);
    const text = renderToolResultText('grep', result);
    expect(text.split('\n').at(-1)).toBe(
      `[left out: ${String(count)} files; full result not stored]`,
    );
    expect(text.length).toBeLessThanOrEqual(15_000);
  });

  it('stops the walk at the artifact byte bound', async () => {
    await writePassageFiles(25);
    const result = await run(contextOf({ artifactMaxBytes: 20_000 }), {
      patterns: ['needle'],
      scopes: [`${root}/d/**`],
    });

    expect(success(result).complete).toBe(false);
    expect(warningsOf(result)).toContain('artifact_bound');
    const content = artifactText();
    expect(Buffer.byteLength(content, 'utf8')).toBeLessThanOrEqual(20_000);
    expect(headings(content).length).toBeGreaterThan(0);
    expect(headings(content).length).toBeLessThan(25);
  });

  it('cuts the first passage and keeps every line of it in the artifact', async () => {
    const lines = Array.from({ length: 400 }, (_, index) =>
      longLine(`needle ${String(index + 1)} `, 100),
    );
    await writeAt('d/big.ts', lines.join('\n'));
    const result = await run(contextOf(), {
      patterns: ['needle'],
      scopes: [`${root}/d/big.ts`],
    });

    const inline = resultsOf(result);
    expect(inline).toHaveLength(1);
    expect(inline[0]?.cut).toBe(true);
    const text = renderToolResultText('grep', result);
    expect(text).toContain('[passage cut; the artifact holds the rest]');
    expect(text.length).toBeLessThanOrEqual(15_000);
    const cut = resultsOf(result)[0];
    const range = /:(\d+)-(\d+)$/u.exec(cut?.locator ?? '');
    expect(range).not.toBeNull();
    const [start, end] = [Number(range?.[1]), Number(range?.[2])];
    // The inline passage is the artifact's first lines, and its marks follow
    // the lines it kept.
    const contentLines = (cut?.content ?? '').split('\n');
    expect(contentLines).toHaveLength(end - start + 1);
    expect(contentLines[0]).toMatch(/^1: needle 1 /u);
    const matches = cut?.matches ?? [];
    expect(matches.length).toBe(end - start + 1);
    expect(matches.at(-1)).toBe(end);
    // A cut passage is not a capped file: the marker belongs to a twentieth
    // passage alone.
    expect(inline[0]?.truncated).toBe(false);
    expect(text).not.toContain('more passages in this file');
    // Only the rest of the cut passage remains, and the notice continues at
    // the artifact line right after the inline lines.
    const remainder = remainderOf(result);
    expect(remainder).toMatchObject({ files: 1, passages: 1 });
    expect(remainder?.next[0]?.start).toBe(contentLines.length + 2);
    expect(bodyText(result)).toContain(
      `; continue with artifact://grep-1:${String(remainder?.next[0]?.start)}-`,
    );
    const artifact = artifactText().split('\n');
    expect(artifact).toHaveLength(401);
    expect(artifact[0]).toBe(`## ${path.join(root, 'd/big.ts')}`);
    // Every source line of the passage appears exactly once.
    const numbered = artifact.flatMap((entry) => {
      const match = /^\*?(\d+): /u.exec(entry);
      return match === null ? [] : [Number(match[1])];
    });
    expect(numbered).toEqual(
      Array.from({ length: 400 }, (_, index) => index + 1),
    );
  });

  it('counts the lines a cut single passage left out without a reader', async () => {
    const lines = Array.from({ length: 400 }, (_, index) =>
      longLine(`needle ${String(index + 1)} `, 100),
    );
    await writeAt('d/big.ts', lines.join('\n'));
    const result = await run(contextOf({ artifactReadable: false }), {
      patterns: ['needle'],
      scopes: [`${root}/d/big.ts`],
    });

    const text = renderToolResultText('grep', result);
    // Nothing holds the rest, so no marker may claim an artifact does.
    expect(text).not.toContain('[passage cut; the artifact holds the rest]');
    expect(text.length).toBeLessThanOrEqual(15_000);
    expect(leftOutOf(result)?.of).toBe('lines');
    // Every source line after the cut one is counted.
    expect(leftOutOf(result)?.count).toBe(400 - endLineOf(result));
    expect(text.split('\n').at(-1)).toBe(
      `[left out: ${String(leftOutOf(result)?.count)} lines; full result not stored]`,
    );
  });

  it('keeps the whole result inline when exactly `limit` files fit', async () => {
    await writeAt('d/a.ts', '1: needle\n');
    await writeAt('d/b.ts', '1: needle\n');
    await writeAt('d/c.ts', '1: needle\n');
    const result = await run(contextOf(), {
      patterns: ['needle'],
      scopes: [`${root}/d/**`],
      limit: 3,
    });

    expect(resultsOf(result)).toHaveLength(3);
    expect(success(result)).not.toHaveProperty('artifact');
    expect(success(result)).not.toHaveProperty('remainder');
    expect(success(result)).not.toHaveProperty('leftOut');
    expect(writes.insertParts).not.toHaveBeenCalled();
  });

  it('counts the results a head left out without a whole file', async () => {
    const lines: Array<string> = [];
    for (let match = 0; match < 20; match += 1)
      lines.push(longLine('a'), longLine('needle '), longLine('b'), '', '');
    await writeAt('d/one.ts', lines.join('\n'));
    const result = await run(contextOf({ artifactReadable: false }), {
      patterns: ['needle'],
      scopes: [`${root}/d/**`],
    });

    const inline = resultsOf(result);
    expect(inline.length).toBeLessThan(20);
    // The single file is shown, so files are not what was left out.
    const leftOut = leftOutOf(result);
    expect(leftOut?.of).toBe('results');
    expect(leftOut?.count).toBe(20 - inline.length);
    const text = renderToolResultText('grep', result);
    expect(text.split('\n').at(-1)).toBe(
      `[left out: ${String(20 - inline.length)} results; full result not stored]`,
    );
    expect(text.length).toBeLessThanOrEqual(15_000);
  });

  it('marks a file twentieth passage and stores no twenty-first', async () => {
    const lines: Array<string> = [];
    for (let match = 0; match < 25; match += 1)
      lines.push(longLine('a'), longLine('needle '), longLine('b'), '', '');
    await writeAt('d/many.ts', lines.join('\n'));
    const result = await run(contextOf(), {
      patterns: ['needle'],
      scopes: [`${root}/d/many.ts`],
    });

    // The inline head is shorter than the file's cap, so the artifact carries
    // the twentieth passage and its marker.
    expect(resultsOf(result).length).toBeLessThan(20);
    const artifact = artifactText();
    expect(artifact.match(/needle /gu)).toHaveLength(20);
    expect(artifact).toContain(`*${String(2 + 19 * 5)}: needle`);
    expect(artifact.split('\n').at(-1)).toBe(
      '[more passages in this file; read it to see them]',
    );
  });

  it('keeps a later file that ends first in canonical order', async () => {
    await writeAt('d/a.ts', longLine('needle a'));
    await writeAt('d/b.ts', longLine('needle b'));
    await writePassageFiles(24);
    await run(contextOf(), {
      patterns: ['needle'],
      scopes: [`${root}/d/**`],
    });

    const files = headings(artifactText()).map((line) =>
      path.basename(line.slice(3)),
    );
    expect(files.indexOf('a.ts')).toBeLessThan(files.indexOf('b.ts'));
  });

  it('reserves room for the excluded-directory report', async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        writeAt(`excluded-${String(index)}/a.ts`, '1: needle\n'),
      ),
    );
    await writeAt('.ignore', 'excluded-*/\n');
    await writePassageFiles(25);
    const result = await run(contextOf(), {
      patterns: ['needle'],
      scopes: [`${root}/**`],
    });

    const text = renderToolResultText('grep', result);
    expect(text.length).toBeLessThanOrEqual(15_000);
    const lines = text.split('\n');
    const ignoredAt = lines.findIndex((line) => line.startsWith('[ignored '));
    expect(lines[ignoredAt]).toContain('directories');
    const warningAt = lines.findIndex((line) => line.startsWith('[warnings: '));
    const remainderAt = lines.findIndex((line) => line.startsWith('[more: '));
    expect(ignoredAt).toBeGreaterThan(warningAt);
    expect(remainderAt).toBeGreaterThan(ignoredAt);
  });
});

describe('grep inline boundaries', () => {
  function stateOf(passages: ReadonlyArray<GrepPassage>, maxBytes = 1_000_000) {
    const state = createPageState({ maxBytes, mayCarryKnowledge: false });
    addGrepPassages(state.artifact, passages);
    return state;
  }

  const unreadable = () => contextOf({ artifactReadable: false });

  it('keeps a result that renders in exactly the inline bound', async () => {
    // `## a.md` + `*1: ` + text, joined lines: 25 units of framing for two
    // files, so 7,487 and 7,488 units of text render exactly 15,000.
    const two = stateOf([
      { locator: 'a.md:1-1', content: `1: ${'x'.repeat(7487)}`, matches: [1] },
      { locator: 'b.md:1-1', content: `1: ${'x'.repeat(7488)}`, matches: [1] },
    ]);
    // The fixture renders the whole result in exactly the inline bound.
    expect(measureGrepRendering(pageResult(two))).toBe(15_000);
    const exact = await finishGrepCall(two, unreadable(), 20);
    expect(exact).not.toHaveProperty('leftOut');
    expect(success(exact).results).toHaveLength(2);

    // One unit less cannot fit both files, so the head keeps one file.
    const over = stateOf([
      { locator: 'a.md:1-1', content: `1: ${'x'.repeat(7487)}`, matches: [1] },
      { locator: 'b.md:1-1', content: `1: ${'x'.repeat(7489)}`, matches: [1] },
    ]);
    const capped = await finishGrepCall(over, unreadable(), 20);
    expect(leftOutOf(capped)).toMatchObject({ of: 'files', count: 1 });
  });

  it('keeps the first file that exactly fills the inline head', async () => {
    const budget = 15_000 - grepLeftOutUnits(999_999_999, 'results');
    // Two lines, so a stricter comparison loses a line rather than lands on
    // the same single-line floor: the block takes `budget` code units.
    const first = budget - 17 - 10;
    const result = await finishGrepCall(
      stateOf([
        {
          locator: 'a.md:1-2',
          content: `1: ${'x'.repeat(first)}\n2: ${'x'.repeat(10)}`,
          matches: [1],
        },
        { locator: 'b.md:1-1', content: '1: y', matches: [1] },
      ]),
      unreadable(),
      1,
    );

    // The first file fits to the unit, so only the second file is left out.
    // A stricter comparison would cut the first file and count lines.
    expect(resultsOf(result)[0]?.cut).toBe(false);
    expect(leftOutOf(result)).toMatchObject({ of: 'files', count: 1 });
  });

  it('cuts a long passage at its largest whole-line prefix', async () => {
    const content = Array.from(
      { length: 40 },
      (_, index) => `${String(index + 1)}: ${'y'.repeat(400)}`,
    ).join('\n');
    const result = await finishGrepCall(
      stateOf([{ locator: 'a.md:1-40', content, matches: [1] }]),
      unreadable(),
      20,
    );

    const cut = resultsOf(result)[0];
    const end = Number(/:\d+-(\d+)$/u.exec(cut?.locator ?? '')?.[1]);
    // The head holds the lines it can, not a degenerate one-line floor.
    expect(end).toBeGreaterThanOrEqual(30);
    expect(leftOutOf(result)).toMatchObject({ of: 'lines', count: 40 - end });
  });

  it('drops a dangling cut without losing its cap mark', async () => {
    const state = stateOf([
      { locator: 'a.md:1-2', content: '1: a\n2: b', matches: [1], cut: true },
    ]);
    const result = await finishGrepCall(state, unreadable(), 20);
    const plain = resultsOf(result)[0];
    expect(plain?.cut).toBe(false);
    expect(plain?.truncated).toBe(false);
    expect(renderToolResultText('grep', result)).not.toContain(
      'more passages in this file',
    );

    const capped = stateOf([
      {
        locator: 'a.md:1-2',
        content: '1: a\n2: b',
        matches: [1],
        cut: true,
        truncated: true,
      },
    ]);
    const cappedResult = await finishGrepCall(capped, unreadable(), 20);
    expect(resultsOf(cappedResult)[0]?.truncated).toBe(true);
    expect(renderToolResultText('grep', cappedResult)).toContain(
      '[more passages in this file; read it to see them]',
    );
  });
});
