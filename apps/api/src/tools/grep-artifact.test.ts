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
  GREP_RANKING_UNITS,
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

import { z } from 'zod';

import { type Db } from '../db/tenant-db.service';
import {
  KnowledgeFilesystemAdapter,
  type KnowledgeWalkOpen,
} from '../knowledge/knowledge-filesystem';
import {
  DecisionsService,
  type CandidateJudgement,
  type DecisionJudge,
  type JudgeCandidatesInput,
} from '../decisions/decisions.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
import { finishGrepCall } from './grep-artifact';
import { rankGrepRuns } from './grep-rerank';
import { addGrepPassages, createPageState, pageResult } from './grep-page';
import { grepInputSchema, nativeGrepTool } from './grep';
import { renderToolResultText } from './model-text';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import {
  type KnowledgeToolResolver,
  type ToolContext,
  type ToolResult,
} from './types';
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
  const db: Db = drizzle.mock();

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
    configuredCredentials: overrides.configuredCredentials ?? [],
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

/** What a rank would be asked; these suites configure no rank model. */
const ASK = { patterns: ['needle'] };

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
    const exact = await finishGrepCall(two, unreadable(), 20, ASK);
    expect(exact).not.toHaveProperty('leftOut');
    expect(success(exact).results).toHaveLength(2);

    // One unit less cannot fit both files, so the head keeps one file.
    const over = stateOf([
      { locator: 'a.md:1-1', content: `1: ${'x'.repeat(7487)}`, matches: [1] },
      { locator: 'b.md:1-1', content: `1: ${'x'.repeat(7489)}`, matches: [1] },
    ]);

    const capped = await finishGrepCall(over, unreadable(), 20, ASK);
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
      ASK,
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
      ASK,
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

    const result = await finishGrepCall(state, unreadable(), 20, ASK);
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

    const cappedResult = await finishGrepCall(capped, unreadable(), 20, ASK);
    expect(resultsOf(cappedResult)[0]?.truncated).toBe(true);
    expect(renderToolResultText('grep', cappedResult)).toContain(
      '[more passages in this file; read it to see them]',
    );
  });
});

describe('grep rerank', () => {
  const MODEL = 'jev';
  const KEY = 'decision-key-fixture';

  const BOUNDS = {
    maxFilesExamined: null,
    maxEntriesListed: null,
    maxBytesRead: null,
    maxFileBytes: null,
    rerank: { model: MODEL },
  } as const;

  type Answer = Record<string, number> | 'unavailable';

  /** A lane double that answers `answers`, records each call, and protects KEY. */
  function lane(answers: Answer) {
    const calls: Array<JudgeCandidatesInput> = [];

    const decisions: DecisionJudge = {
      judgeCandidates: (input) => {
        calls.push(input);

        const unavailable =
          answers === 'unavailable' || Object.keys(answers).length === 0;

        const judgement: CandidateJudgement = unavailable
          ? {
              status: 'unavailable',
              probabilities: undefined,
              unanswered: input.cards.map((card) => card.key),
              usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
              model: null,
              latencyMs: 1,
            }
          : {
              status: 'answered',
              probabilities: new Map(Object.entries(answers)),
              unanswered: [],
              usage: { inputTokens: 500, outputTokens: 0, costUsd: 0.001 },
              model: 'jev-test',
              latencyMs: 30,
            };

        return Promise.resolve(judgement);
      },
      protectText: (_model, text) => text.replaceAll(KEY, '[protected]'),
    };

    return { calls, decisions };
  }

  const rankedContext = (
    decisions: DecisionJudge,
    extra?: Partial<ToolContext>,
  ) => contextOf({ decisions, grepBounds: BOUNDS, ...extra });

  /** One long single-line passage, so three of them overfill the inline part. */
  function longPassage(file: string, line: number, units = 6000): GrepPassage {
    return {
      locator: `${file}:${String(line)}-${String(line)}`,
      content: `${String(line)}: ${'x'.repeat(units)}`,
      matches: [line],
    };
  }

  function stateOf(passages: ReadonlyArray<GrepPassage>) {
    const state = createPageState({
      maxBytes: 1_000_000,
      mayCarryKnowledge: false,
    });

    addGrepPassages(state.artifact, passages);

    return state;
  }

  function rerankOf(result: ToolResult) {
    const display = success(result).display;

    const parsed = RERANK_RECORD.safeParse(
      isRecord(display) ? display['rerank'] : undefined,
    );

    return parsed.success ? parsed.data : undefined;
  }

  const RERANK_RECORD = z.object({
    model: z.string(),
    order: z.array(z.string()),
    scores: z.record(z.string(), z.number()),
    latencyMs: z.number(),
    costUsd: z.number().nullable(),
    runLengths: z.array(z.number()),
  });

  const ASK_X = { patterns: ['set_config', 'current_setting'] };

  it('keeps the same passages with and without an objective', async () => {
    await writePassageFiles(3);
    const args = { patterns: ['needle'], scopes: [`${root}/d/**`] };
    const plain = await run(contextOf(), args);

    const asked = await run(contextOf(), {
      ...args,
      objective: 'where the needle lives',
    });

    expect(success(asked).results).toEqual(success(plain).results);
    expect(success(asked).warnings).toEqual(success(plain).warnings);
    expect(success(asked).complete).toBe(success(plain).complete);
  });

  it('accepts 2,000 units of objective and refuses 2,001', () => {
    const patterns = ['x'];
    expect(
      grepInputSchema.safeParse({ patterns, objective: 'o'.repeat(2000) })
        .success,
    ).toBe(true);
    expect(
      grepInputSchema.safeParse({ patterns, objective: 'o'.repeat(2001) })
        .success,
    ).toBe(false);
  });

  it('sends the objective, or the joined patterns, as the criterion', async () => {
    const answers = lane({ p0: 0.1, p1: 0.9, p2: 0.5 });

    const passages = [
      longPassage('/a.ts', 1),
      longPassage('/b.ts', 1),
      longPassage('/c.ts', 1),
    ];

    await finishGrepCall(
      stateOf(passages),
      rankedContext(answers.decisions),
      20,
      { ...ASK_X, objective: 'the retry loop' },
    );
    await finishGrepCall(
      stateOf(passages),
      rankedContext(answers.decisions),
      20,
      ASK_X,
    );

    expect(answers.calls[0]).toMatchObject({
      tool: 'grep',
      model: MODEL,
      objective: 'the retry loop',
      query: 'set_config | current_setting',
      cardBound: 384,
    });
    expect(answers.calls[1]?.objective).toBeUndefined();
    expect(answers.calls[1]?.query).toBe('set_config | current_setting');
  });

  it('makes no decision call for a result that fits inline or is empty', async () => {
    const answers = lane({ p0: 0.9 });

    const small = await finishGrepCall(
      stateOf([
        { locator: '/a.ts:1-1', content: '1: needle', matches: [1] },
        { locator: '/b.ts:1-1', content: '1: needle', matches: [1] },
        { locator: '/c.ts:1-1', content: '1: needle', matches: [1] },
      ]),
      rankedContext(answers.decisions),
      20,
      ASK,
    );

    const empty = await finishGrepCall(
      stateOf([]),
      rankedContext(answers.decisions),
      20,
      ASK,
    );

    expect(answers.calls).toHaveLength(0);
    expect(small).not.toHaveProperty('display');
    expect(small).not.toHaveProperty('ranking');
    expect(empty).not.toHaveProperty('display');
    expect(empty).not.toHaveProperty('ranking');
  });

  it('ranks two long runs, which overfill the inline part', async () => {
    const answers = lane({ p0: 0.2, p1: 0.8 });

    const result = await finishGrepCall(
      stateOf([longPassage('/a.ts', 1, 9000), longPassage('/b.ts', 1, 9000)]),
      rankedContext(answers.decisions),
      20,
      ASK,
    );

    expect(answers.calls).toHaveLength(1);
    expect(answers.calls[0]?.cards).toHaveLength(2);
    expect(headings(renderToolResultText('grep', result))[0]).toBe('## /b.ts');
  });

  it('ranks by whole runs and states the order in the record only', async () => {
    const answers = lane({ p0: 0.1, p2: 0.9 });

    const result = await finishGrepCall(
      stateOf([
        longPassage('/a.ts', 1),
        longPassage('/b.ts', 1),
        longPassage('/c.ts', 1),
      ]),
      rankedContext(answers.decisions),
      20,
      ASK,
    );

    expect(rerankOf(result)).toEqual({
      model: 'jev-test',
      order: ['p2', 'p0', 'p1'],
      scores: { p0: 0.1, p2: 0.9 },
      latencyMs: 30,
      costUsd: 0.001,
      runLengths: [1, 1, 1],
    });
    expect(result).not.toHaveProperty('ranking');
    expect(headings(artifactText())).toEqual([
      '## /c.ts',
      '## /a.ts',
      '## /b.ts',
    ]);
    const text = renderToolResultText('grep', result);
    expect(text).not.toContain('jev-test');
    expect(text).not.toContain('runLengths');
  });

  it('keeps three runs when a reorder puts one file beside itself', async () => {
    const answers = lane({ p0: 0.9, p1: 0.1, p2: 0.8 });

    const result = await finishGrepCall(
      stateOf([
        longPassage('/x.ts', 10),
        longPassage('/y.ts', 5),
        longPassage('/x.ts', 20),
      ]),
      rankedContext(answers.decisions),
      20,
      ASK,
    );

    expect(rerankOf(result)).toMatchObject({
      order: ['p0', 'p2', 'p1'],
      runLengths: [1, 1, 1],
    });
    expect(headings(artifactText())).toEqual([
      '## /x.ts',
      '## /x.ts',
      '## /y.ts',
    ]);
    const live = renderToolResultText('grep', result);
    // The inline part holds the two x runs, each under its own heading.
    expect(headings(live)).toEqual(['## /x.ts', '## /x.ts']);
    // A replayed part renders the same text from the stored record.
    const replayed: ToolResult = structuredClone(result);
    expect(renderToolResultText('grep', replayed)).toBe(live);
    // Every finding starts on its heading line.
    const lines = artifactText().split('\n');
    const stored = writtenParts()[0]?.findings;

    if (!isRecord(stored) || !Array.isArray(stored['findings'])) {
      throw new Error('the artifact stores findings');
    }

    const starts = stored['findings']
      .filter(isRecord)
      .map((finding) => Number(finding['start']));

    expect(starts).toHaveLength(3);

    for (const start of starts)
      expect(lines[start - 1]?.startsWith('## ')).toBe(true);
  });

  it('consumes the lengths only through a truncated final inline run', async () => {
    // Canonical order x:10, y, x:20: three runs, two of one file. The rank
    // puts the two x runs side by side and y last; the inline part ends after
    // the second x run, so it consumes the lengths only that far.
    const answers = lane({ p0: 0.9, p2: 0.8, p1: 0.1 });

    const result = await finishGrepCall(
      stateOf([
        longPassage('/x.ts', 10),
        longPassage('/y.ts', 1),
        longPassage('/x.ts', 20),
      ]),
      rankedContext(answers.decisions),
      20,
      ASK,
    );

    expect(rerankOf(result)).toMatchObject({
      order: ['p0', 'p2', 'p1'],
      runLengths: [1, 1, 1],
    });
    expect(resultsOf(result).map((entry) => entry.locator)).toEqual([
      '/x.ts:10-10',
      '/x.ts:20-20',
    ]);
    const live = renderToolResultText('grep', result);
    expect(headings(live)).toEqual(['## /x.ts', '## /x.ts']);
    expect(remainderOf(result)?.files).toBe(1);
    expect(renderToolResultText('grep', structuredClone(result))).toBe(live);
  });

  it('keeps walk order and says so after a failed rank call', async () => {
    const answers = lane('unavailable');

    const state = stateOf([
      longPassage('/a.ts', 1),
      longPassage('/b.ts', 1),
      longPassage('/c.ts', 1),
    ]);

    state.warnings.set('deadline', 1);
    state.ignored.count = 1;
    state.ignored.paths.push('/d/dist');

    const result = await finishGrepCall(
      state,
      rankedContext(answers.decisions),
      20,
      ASK,
    );

    expect(success(result).ranking).toBe('unavailable');
    expect(result).not.toHaveProperty('display');
    expect(headings(artifactText())).toEqual([
      '## /a.ts',
      '## /b.ts',
      '## /c.ts',
    ]);
    const text = renderToolResultText('grep', result);
    const warnings = text.indexOf('[warnings:');
    const ranking = text.indexOf('[ranking unavailable; walk order]');
    const ignored = text.indexOf('[ignored');
    expect(warnings).toBeGreaterThan(-1);
    expect(ranking).toBeGreaterThan(warnings);
    expect(ignored).toBeGreaterThan(ranking);
    expect(text).not.toContain('jev');
  });

  it('reserves room for the ranking line whatever the inline fill', async () => {
    // No artifact is readable, so the call takes the left-out path. The sweep
    // covers every fill within the ranking line's width of the exact edge a
    // reserve without that line would overrun.
    const reserve = grepLeftOutUnits(999_999_999, 'results');
    const edge = 15_000 - reserve - GREP_RANKING_UNITS;

    const fit = (units: number) =>
      measureGrepRendering({
        results: [longPassage('/a.ts', 1), longPassage('/b.ts', 1, units)],
        complete: true,
      });

    let swept = 0;

    for (let units = 6000; units < 9000; units += 1) {
      const filled = fit(units);

      if (filled < edge - 1 || filled > edge + GREP_RANKING_UNITS + 1) continue;
      swept += 1;
      const answers = lane('unavailable');

      const result = await finishGrepCall(
        stateOf([
          longPassage('/a.ts', 1),
          longPassage('/b.ts', 1, units),
          longPassage('/c.ts', 1),
        ]),
        rankedContext(answers.decisions, { artifactReadable: false }),
        20,
        ASK,
      );

      expect(success(result)).toHaveProperty('leftOut');
      // The ranking line's room is kept back: the second file joins the head
      // only when its fill leaves that room.
      expect(resultsOf(result)).toHaveLength(filled <= edge ? 2 : 1);
      expect(measureGrepRendering(success(result))).toBeLessThanOrEqual(15_000);
      expect(renderToolResultText('grep', result)).toContain(
        '[ranking unavailable; walk order]',
      );

      // Without a rank call there is no ranking line, so its room is not kept.
      const unranked = await finishGrepCall(
        stateOf([
          longPassage('/a.ts', 1),
          longPassage('/b.ts', 1, units),
          longPassage('/c.ts', 1),
        ]),
        contextOf({ artifactReadable: false }),
        20,
        ASK,
      );

      expect(resultsOf(unranked)).toHaveLength(
        filled <= edge + GREP_RANKING_UNITS ? 2 : 1,
      );
    }

    expect(swept).toBeGreaterThanOrEqual(GREP_RANKING_UNITS);
  });

  it('ranks the judged runs first when only some are answered', async () => {
    const answers = lane({ p2: 0.7 });

    const result = await finishGrepCall(
      stateOf([
        longPassage('/a.ts', 1),
        longPassage('/b.ts', 1),
        longPassage('/c.ts', 1),
      ]),
      rankedContext(answers.decisions),
      20,
      ASK,
    );

    expect(result).not.toHaveProperty('ranking');
    expect(rerankOf(result)).toMatchObject({
      order: ['p2', 'p0', 'p1'],
      scores: { p2: 0.7 },
    });
  });

  it('ends the walk at 108 seconds before ranking and lets 120 seconds abort the rank', async () => {
    const space = '44444444-4444-4444-8444-444444444444';
    const body = `${'x'.repeat(6000)} needle`;

    for (const name of ['a', 'b', 'c']) {
      await writeAt(`kb/${space}/${name}.md`, body);
    }

    for (let n = 1; n <= 9; n += 1) {
      await writeAt(`kb/${space}/d${n}.md`, body);
    }

    await writeAt(`kb/${space}/zz/d.md`, body);
    await writeAt('d/later.ts', body);

    const binding = {
      id: space,
      name: space,
      root: path.join(root, 'kb'),
      directory: path.join(root, 'kb', space),
    };

    const knowledgeResolver: KnowledgeToolResolver = {
      listForOwnerPage: () => Promise.resolve({ spaces: [] }),
      resolveBindingForOwnerById: () => Promise.resolve(binding),
      createAdapter: (resolved) => new KnowledgeFilesystemAdapter(resolved),
    };

    // The walk's deadline passes once it has taken and read a.md, b.md, and
    // c.md. The read-ahead keeps at most eight reads queued behind the one the
    // walk waits on and frees a slot only when the walk takes a file, so the
    // twelfth open is the signal that the walk has taken the fourth file, and
    // with it finished the first three. The fourth file onward hold their
    // chunks until that signal, so the clock moves on the walk's own progress
    // and never on elapsed time.
    const openWalk: KnowledgeFilesystemAdapter['openWalk'] =
      // eslint-disable-next-line @typescript-eslint/unbound-method -- captured unbound and re-invoked with an explicit receiver below.
      KnowledgeFilesystemAdapter.prototype.openWalk;

    let opens = 0;
    let walkTakenThree = Promise.withResolvers<void>();
    vi.spyOn(
      KnowledgeFilesystemAdapter.prototype,
      'openWalk',
    ).mockImplementation(async function (
      this: KnowledgeFilesystemAdapter,
      file: string,
      signal?: AbortSignal,
    ): Promise<KnowledgeWalkOpen> {
      opens += 1;
      const ordinal = opens;

      if (ordinal === 12) {
        vi.setSystemTime(108_001);
        walkTakenThree.resolve();
      }

      // SAFETY: the captured method resolves exactly a KnowledgeWalkOpen.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `.call` on the captured method is typed any by the linter.
      const opened = (await openWalk.call(
        this,
        file,
        signal,
      )) as KnowledgeWalkOpen;

      if ('kind' in opened) return opened;
      const { chunks } = opened;
      const held = ordinal > 3;
      const gate = walkTakenThree.promise;

      return {
        size: opened.size,
        close: () => opened.close(),
        chunks: (async function* () {
          if (held) await gate;
          yield* chunks;
        })(),
      };
    });

    const args = {
      patterns: ['needle'],
      scopes: [`kb://${space}/`, `${root}/d/**`],
      limit: 1,
    };

    const seen: Array<{
      readonly now: number;
      readonly keys: ReadonlyArray<string>;
      readonly texts: string;
      readonly signal: AbortSignal | undefined;
    }> = [];

    const decisionsOf = (
      controller: AbortController,
      timeout: DOMException | undefined,
    ): DecisionJudge => ({
      judgeCandidates: (input) => {
        seen.push({
          now: Date.now(),
          keys: input.cards.map((card) => card.key),
          texts: input.cards.map((card) => card.text).join('\n'),
          signal: input.abortSignal,
        });

        if (timeout === undefined) {
          return lane('unavailable').decisions.judgeCandidates(input);
        }

        vi.setSystemTime(120_001);
        controller.abort(timeout);

        return Promise.reject(timeout);
      },
      protectText: (_model, text) => text,
    });

    vi.useFakeTimers({ toFake: ['Date'] });

    try {
      // The walk's deadline passes inside the first scope: the second scope is
      // never opened, the deadline warning stands, and the judge sees only
      // the first scope's runs, under the enclosing signal.
      vi.setSystemTime(0);
      const open = new AbortController();

      const result = await run(
        rankedContext(decisionsOf(open, undefined), {
          knowledgeResolver,
          timeoutMs: 120_000,
          abortSignal: open.signal,
        }),
        args,
      );

      expect(warningsOf(result)).toEqual(['deadline']);
      expect(success(result).ranking).toBe('unavailable');
      expect(seen).toHaveLength(1);
      expect(seen[0]?.now).toBeGreaterThanOrEqual(108_001);
      expect(seen[0]?.texts).toContain(`kb://${space}/a.md`);
      expect(seen[0]?.texts).toContain(`kb://${space}/c.md`);
      expect(seen[0]?.texts).not.toContain('later.ts');
      expect(seen[0]?.signal).toBe(open.signal);

      // The enclosing 120-second deadline then aborts the rank: a timeout,
      // with no failure line kept.
      vi.setSystemTime(0);
      opens = 0;
      walkTakenThree = Promise.withResolvers<void>();
      const closed = new AbortController();
      const timeout = new DOMException('tool timeout', 'TimeoutError');
      await expect(
        run(
          rankedContext(decisionsOf(closed, timeout), {
            knowledgeResolver,
            timeoutMs: 120_000,
            abortSignal: closed.signal,
          }),
          args,
        ),
      ).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(seen[1]?.signal).toBe(closed.signal);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the judge the enclosing signal and lets its abort through', async () => {
    const controller = new AbortController();
    const timeout = new DOMException('tool timeout', 'TimeoutError');
    let seen: AbortSignal | undefined;

    const decisions: DecisionJudge = {
      judgeCandidates: (input) => {
        seen = input.abortSignal;
        controller.abort(timeout);

        return Promise.reject(timeout);
      },
      protectText: (_model, text) => text,
    };

    const state = stateOf([
      longPassage('/a.ts', 1),
      longPassage('/b.ts', 1),
      longPassage('/c.ts', 1),
    ]);

    await expect(
      finishGrepCall(
        state,
        rankedContext(decisions, { abortSignal: controller.signal }),
        20,
        ASK,
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(seen).toBe(controller.signal);
    expect(state.ranking).toBeUndefined();
  });

  describe('with a rerank model', () => {
    const RERANK_KEY = 'rerank-key-fixture';
    const rerankBounds = { ...BOUNDS, rerank: { model: 'rr-fast' } };

    const threeRuns = () =>
      stateOf([
        longPassage('/a.ts', 1),
        longPassage('/b.ts', 1),
        longPassage('/c.ts', 1),
      ]);

    function rerankLane(): DecisionsService {
      return new DecisionsService({
        config: {
          ...BUILT_IN_DEFAULTS,
          providers: [
            {
              id: 'rerank',
              type: 'cohere-rerank',
              key: RERANK_KEY,
              baseUrl: 'https://openrouter.ai/api/v1',
              headers: {},
            },
          ],
          rerankModels: [
            {
              id: 'rr-fast',
              provider: 'rerank',
              model: 'cohere/rerank-5-fast',
            },
          ],
        },
      });
    }

    const rerankedContext = (extra?: Partial<ToolContext>) =>
      contextOf({
        decisions: rerankLane(),
        grepBounds: rerankBounds,
        ...extra,
      });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('ranks the runs by the rerank scores and stores the served model', async () => {
      const bodies: Array<string> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        bodies.push(await new Response(init?.body).text());

        return Response.json({
          model: 'cohere/rerank-v5.0-fast',
          results: [
            { index: 0, relevance_score: 0.1 },
            { index: 1, relevance_score: 0.3 },
            { index: 2, relevance_score: 0.9 },
          ],
          usage: { total_tokens: 2139, cost: 0.00004278 },
        });
      });

      const result = await finishGrepCall(
        threeRuns(),
        rerankedContext(),
        20,
        ASK,
      );

      expect(bodies).toHaveLength(1);
      expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({
        model: 'cohere/rerank-5-fast',
        query: 'needle',
      });
      expect({ ...rerankOf(result), latencyMs: 0 }).toEqual({
        model: 'cohere/rerank-v5.0-fast',
        order: ['p2', 'p1', 'p0'],
        scores: { p0: 0.1, p1: 0.3, p2: 0.9 },
        latencyMs: 0,
        costUsd: 0.00004278,
        runLengths: [1, 1, 1],
      });
      expect(headings(artifactText())).toEqual([
        '## /c.ts',
        '## /b.ts',
        '## /a.ts',
      ]);
    });

    it('keeps walk order and says so after a failed rerank request', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() =>
          Promise.resolve(new Response('', { status: 422 })),
        );

      const result = await finishGrepCall(
        threeRuns(),
        rerankedContext(),
        20,
        ASK,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(success(result).ranking).toBe('unavailable');
      expect(result).not.toHaveProperty('display');
      expect(headings(artifactText())).toEqual([
        '## /a.ts',
        '## /b.ts',
        '## /c.ts',
      ]);
      expect(renderToolResultText('grep', result)).toContain(
        '[ranking unavailable; walk order]',
      );
    });

    it('settles with the runner timeout when the deadline passes during the request', async () => {
      const controller = new AbortController();
      const timeout = new DOMException('tool timeout', 'TimeoutError');

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation((_url, init) => {
          const { promise, reject } = Promise.withResolvers<Response>();
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
          controller.abort(timeout);

          return promise;
        });

      const state = threeRuns();

      await expect(
        finishGrepCall(
          state,
          rerankedContext({ abortSignal: controller.signal }),
          20,
          ASK,
        ),
      ).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(state.ranking).toBeUndefined();
    });
  });

  it('makes no decision call for a state with no file runs', async () => {
    const answers = lane({ p0: 0.9 });
    const state = stateOf([]);

    await rankGrepRuns(rankedContext(answers.decisions), state, ASK_X);

    expect(answers.calls).toHaveLength(0);
    expect(state.ranking).toBeUndefined();
    expect(state.rerank).toBeUndefined();
  });

  it('sends an empty run id without one, and no objective or signal key unset', async () => {
    const answers = lane({ p0: 0.1, p1: 0.9, p2: 0.5 });

    const { runId, ...withoutRun } = contextOf({
      decisions: answers.decisions,
      grepBounds: BOUNDS,
    });

    expect(runId).toBe('run-a');
    await finishGrepCall(
      stateOf([
        longPassage('/a.ts', 1),
        longPassage('/b.ts', 1),
        longPassage('/c.ts', 1),
      ]),
      withoutRun,
      20,
      ASK_X,
    );

    expect(answers.calls[0]?.runId).toBe('');
    expect(answers.calls[0]).not.toHaveProperty('objective');
    expect(answers.calls[0]).not.toHaveProperty('abortSignal');
  });

  it('treats a plain judge failure as an unavailable rank, signal or none', async () => {
    const decisions: DecisionJudge = {
      judgeCandidates: () => Promise.reject(new Error('judge down')),
      protectText: (_model, text) => text,
    };

    const passages = [
      longPassage('/a.ts', 1),
      longPassage('/b.ts', 1),
      longPassage('/c.ts', 1),
    ];

    const bare = stateOf(passages);
    await finishGrepCall(bare, rankedContext(decisions), 20, ASK_X);
    const signalled = stateOf(passages);
    await finishGrepCall(
      signalled,
      rankedContext(decisions, { abortSignal: new AbortController().signal }),
      20,
      ASK_X,
    );

    expect(bare.ranking).toBe('unavailable');
    expect(signalled.ranking).toBe('unavailable');
  });

  it('opens one heading for a run of two passages of one file when ranked', async () => {
    const answers = lane({ p0: 0.2, p1: 0.9, p2: 0.5 });

    const result = await finishGrepCall(
      stateOf([
        longPassage('/a.ts', 1),
        longPassage('/a.ts', 20),
        longPassage('/b.ts', 1),
        longPassage('/c.ts', 1),
      ]),
      rankedContext(answers.decisions),
      20,
      ASK_X,
    );

    expect(rerankOf(result)).toMatchObject({
      order: ['p1', 'p2', 'p0'],
      runLengths: [1, 1, 2],
    });
    expect(headings(artifactText())).toEqual([
      '## /b.ts',
      '## /c.ts',
      '## /a.ts',
    ]);
  });

  it('builds cards only from runs the read group admitted, across host and kb://', async () => {
    const space = '33333333-3333-4333-8333-333333333333';
    const directory = path.join(root, 'kb', space);
    const body = `${'x'.repeat(6000)} needle`;
    await writeAt('d/a.ts', body);
    await writeAt('d/secret.ts', body);
    await writeAt(`kb/${space}/notes/a.md`, body);
    await writeAt(`kb/${space}/notes/secret.md`, body);

    const binding = {
      id: space,
      name: space,
      root: path.join(root, 'kb'),
      directory,
    };

    const knowledgeResolver: KnowledgeToolResolver = {
      listForOwnerPage: () => Promise.resolve({ spaces: [] }),
      resolveBindingForOwnerById: () => Promise.resolve(binding),
      createAdapter: (resolved) => new KnowledgeFilesystemAdapter(resolved),
    };

    const answers = lane({ p0: 0.4, p1: 0.6 });

    const result = await run(
      rankedContext(answers.decisions, {
        knowledgeResolver,
        permissionPolicy: compileToolPermissionMap(
          {
            grep: { allow: true },
            read: { allow: true, reject: [{ field: 'path', regex: 'secret' }] },
          },
          'test',
        ),
      }),
      {
        patterns: ['needle'],
        scopes: [`${root}/d/**`, `kb://${space}/`],
        limit: 1,
      },
    );

    expect(answers.calls).toHaveLength(1);
    const cards = answers.calls[0]?.cards ?? [];
    expect(cards.map((card) => card.key)).toEqual(['p0', 'p1']);
    expect(cards.map((card) => card.text.split('\n')[0])).toEqual([
      `${root}/d/a.ts`,
      `kb://${space}/notes/a.md`,
    ]);
    expect(JSON.stringify(cards)).not.toContain('secret');
    expect(renderToolResultText('grep', result)).not.toContain('secret');
    expect(artifactText()).not.toContain('secret');
    // The rank put the second admitted run first.
    expect(headings(artifactText())[0]).toBe(`## kb://${space}/notes/a.md`);
  });

  it('replaces the decision key in locators and text before any cut', async () => {
    const answers = lane({ p0: 0.5, p1: 0.9 });

    const keyed: GrepPassage = {
      locator: `/${KEY}/a.ts:3-3`,
      content: `3: token ${KEY} ${'x'.repeat(6000)}`,
      matches: [3],
    };

    const state = stateOf([
      keyed,
      longPassage('/b.ts', 1),
      longPassage('/c.ts', 1),
    ]);

    const result = await finishGrepCall(
      state,
      rankedContext(answers.decisions),
      20,
      ASK,
    );

    const text = renderToolResultText('grep', result);
    expect(text).toContain('[protected]');
    expect(text).not.toContain(KEY);
    expect(artifactText()).not.toContain(KEY);
    expect(JSON.stringify(answers.calls)).not.toContain(KEY);

    const first = resultsOf(result).find((entry) =>
      entry.locator.includes('[protected]'),
    );

    expect(first?.matches).toEqual([3]);
    expect(first?.locator.endsWith(':3-3')).toBe(true);
  });

  it('replaces the decision key in the unfinished file and ignored directories', async () => {
    const answers = lane({ p0: 0.5, p1: 0.9, p2: 0.1 });

    const state = stateOf([
      longPassage('/a.ts', 1),
      longPassage('/b.ts', 1),
      longPassage('/c.ts', 1),
    ]);

    state.ignored.count = 1;
    state.ignored.paths.push(`/r/${KEY}/dist`);
    state.ignored.seen.add(`/r/${KEY}/dist`);
    state.unfinished = `/r/${KEY}/big.log`;

    const result = await finishGrepCall(
      state,
      rankedContext(answers.decisions),
      20,
      ASK,
    );

    const live = renderToolResultText('grep', result);
    expect(live).toContain('/r/%5Bprotected%5D/dist');
    expect(live).toContain('/r/[protected]/big.log');
    expect(live).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(artifactText()).not.toContain(KEY);
    expect(renderToolResultText('grep', structuredClone(result))).not.toContain(
      KEY,
    );
  });

  it('preserves source text that resembles rank metadata', async () => {
    const answers = lane({ p0: 0.9, p1: 0.5, p2: 0.1 });

    const resembling: GrepPassage = {
      locator: '/a.ts:1-1',
      content: `1: jev-test rerank 0.9 runLengths ${'x'.repeat(6000)}`,
      matches: [1],
    };

    const result = await finishGrepCall(
      stateOf([resembling, longPassage('/b.ts', 1), longPassage('/c.ts', 1)]),
      rankedContext(answers.decisions),
      20,
      ASK,
    );

    expect(renderToolResultText('grep', result)).toContain(
      '*1: jev-test rerank 0.9 runLengths',
    );
    expect(artifactText()).toContain('1: jev-test rerank 0.9 runLengths');
  });
});
