import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  KnowledgeFilesystemAdapter,
  type KnowledgeFilesystemBinding,
} from '../knowledge/knowledge-filesystem';
import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { MachineConnector } from '../machines/machine-connector.service';
import {
  TOOL_PROMPT_IDS,
  loadPackagedToolDescription,
} from '../prompts/tool-descriptions';
import {
  skillCatalogUnavailableResult,
  skillUnavailableResult,
} from '../skills/skill-target';
import {
  type SkillCatalogEntry,
  type SkillCatalogPort,
} from '../skills/skill-catalog';
import { isRecord, isString } from '@workspace/runtime-safety';
import { measureNativeModelOutput } from '@workspace/native-file-tools';
import { type ToolResult } from './types';
import { type KnowledgeToolResolver, type ToolContext } from './types';
import { grepInputSchema, nativeGrepTool } from './grep';
import { nativeReadTool } from './native-files';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolPermissionMap } from './permissions/types';
import { TOOL_REGISTRY } from './registry';
import { type DerivedDecision } from './web-read/admission';

const SPACE_A = '11111111-1111-4111-8111-111111111111';
const SPACE_B = '22222222-2222-4222-8222-222222222222';

const PERMISSIVE: ToolPermissionMap = {
  grep: { allow: true },
  read: { allow: true },
};

type SpaceFixture = {
  readonly binding: KnowledgeFilesystemBinding;
  readonly directory: string;
};

async function temporaryRoot(): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), 'llame-grep-')));
}

async function spaceFixture(
  root: string,
  id: string,
  files: Readonly<Record<string, string>>,
): Promise<SpaceFixture> {
  const directory = path.join(root, id);
  await mkdir(directory, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(directory, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { binding: { id, name: id, root, directory }, directory };
}

function lineNumbered(...lines: ReadonlyArray<string>): string {
  return lines.map((line) => `${line}\n`).join('');
}

function knowledgeResolver(
  bindings: ReadonlyMap<string, KnowledgeFilesystemBinding>,
  order: ReadonlyArray<string> = [...bindings.keys()],
): KnowledgeToolResolver {
  return {
    listForOwnerPage: () =>
      Promise.resolve({
        spaces: order.map((id) => ({
          id,
          name: id,
          createdAt: new Date(0),
        })),
      }),
    resolveBindingForOwnerById: (_owner, id) =>
      Promise.resolve(bindings.get(id)),
    createAdapter: (binding: KnowledgeFilesystemBinding) =>
      new KnowledgeFilesystemAdapter(binding),
  };
}

function catalogOf(
  entries: ReadonlyArray<SkillCatalogEntry>,
): SkillCatalogPort {
  return {
    getSnapshot: () => ({
      available: true,
      directories: [],
      entries,
      diagnostics: [],
    }),
  };
}

function packageEntry(
  name: string,
  skillDirectory: string,
  proactive = true,
): SkillCatalogEntry {
  return {
    name,
    description: null,
    proactive,
    sourceDirectory: path.dirname(skillDirectory),
    skillDirectory,
    available: true,
    diagnostics: [],
  };
}

type ContextOptions = {
  readonly resolver?: KnowledgeToolResolver;
  readonly catalog?: SkillCatalogPort;
  readonly map?: ToolPermissionMap;
  readonly selection?: ReadonlySet<string>;
  readonly onDerivedDecision?: (decision: DerivedDecision) => void;
};

function contextOf(options: ContextOptions = {}): ToolContext {
  return {
    userId: 'owner-a',
    chatId: 'chat-a',
    permissionPolicy: compileToolPermissionMap(
      options.map ?? PERMISSIVE,
      'test',
    ),
    tenantDb: {
      runAs: () =>
        Promise.reject(new Error('grep never opens a tenant transaction')),
    },
    knowledgeResolver: options.resolver,
    skillCatalog: options.catalog,
    skillSelection: options.selection,
    onDerivedDecision: options.onDerivedDecision,
  };
}

/** A successful result as an open record, so a field assertion stays checked. */
function success(result: ToolResult) {
  if (result.status !== 'success') {
    throw new Error(`expected success, received ${result.type}`);
  }
  return result;
}

/** The result's passage list, as values this file still has to check. */
function resultList(result: ToolResult): ReadonlyArray<unknown> {
  const results = success(result).results;
  if (!Array.isArray(results)) return [];
  // Copy the unchecked list into `unknown`, so every field is parsed below.
  const list: Array<unknown> = [];
  for (const entry of results) list.push(entry);
  return list;
}

function locatorsOf(result: ToolResult): ReadonlyArray<string> {
  return resultList(result).map((passage) => {
    if (!isRecord(passage) || !isString(passage.locator)) {
      throw new Error('a passage carries a locator');
    }
    return passage.locator;
  });
}

function passageOf(result: ToolResult, index: number) {
  const passage = resultList(result)[index];
  if (
    !isRecord(passage) ||
    !isString(passage.locator) ||
    !isString(passage.content) ||
    !Array.isArray(passage.matches)
  ) {
    throw new Error('the passage is well formed');
  }
  return {
    locator: passage.locator,
    content: passage.content,
    matches: passage.matches,
  };
}

function warningsOf(result: ToolResult): ReadonlyArray<unknown> {
  const warnings = success(result).warnings;
  return Array.isArray(warnings) ? warnings : [];
}

function cursorOf(result: ToolResult): string | undefined {
  const cursor = success(result).cursor;
  return isString(cursor) ? cursor : undefined;
}

function run(context: ToolContext, args: unknown) {
  const parsed = grepInputSchema.safeParse(args);
  if (!parsed.success) throw new Error('the fixture arguments must parse');
  return nativeGrepTool.execute(context, parsed.data);
}

async function withRoot<T>(callback: (root: string) => Promise<T>): Promise<T> {
  const root = await temporaryRoot();
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('registration', () => {
  it('registers the tool as read-only with its packaged description', () => {
    expect(TOOL_REGISTRY.get('grep')).toBe(nativeGrepTool);
    expect(nativeGrepTool.classification).toBe('read_only');
    expect(nativeGrepTool.description).toBe(
      loadPackagedToolDescription('grep'),
    );
    expect(TOOL_PROMPT_IDS).toContain('grep');
  });

  it.each([
    ['an unknown key', { patterns: ['x'], include: '*.ts' }],
    ['nine patterns', { patterns: Array.from({ length: 9 }, () => 'x') }],
    ['no pattern', { patterns: [] }],
    ['an empty pattern', { patterns: [''] }],
    [
      'seventeen scopes',
      {
        patterns: ['x'],
        scopes: Array.from({ length: 17 }, (_, i) => `skill://p${i}`),
      },
    ],
    ['a limit above twenty', { patterns: ['x'], limit: 21 }],
  ])('refuses %s', (_case, args) => {
    expect(grepInputSchema.safeParse(args).success).toBe(false);
  });

  it('accepts the minimal call', () => {
    expect(grepInputSchema.safeParse({ patterns: ['x'] }).success).toBe(true);
  });
});

describe('pattern compilation', () => {
  it('refuses a backreference with the engine message and the index', async () => {
    const result = await run(contextOf(), {
      patterns: ['needle', String.raw`(a)\1`],
      scopes: ['skill://'],
    });
    expect(result).toMatchObject({ status: 'error', type: 'invalid_pattern' });
    expect('message' in result ? result.message : '').toMatch(/^Pattern 1: /);
  });

  it('refuses a pattern over the 512-byte bound before any scope is admitted', async () => {
    const result = await run(contextOf(), {
      patterns: ['é'.repeat(300)],
      scopes: ['skill://'],
    });
    expect(result).toMatchObject({ status: 'error', type: 'invalid_pattern' });
  });

  it('keeps metacharacters in literal mode', async () => {
    await withRoot(async (root) => {
      const pkg = path.join(root, 'pkg');
      await mkdir(pkg);
      await writeFile(
        path.join(pkg, 'SKILL.md'),
        lineNumbered('axb(', 'filler', 'a.b('),
      );
      const result = await run(
        contextOf({ catalog: catalogOf([packageEntry('pdf', pkg)]) }),
        { patterns: ['a.b('], literal: true, scopes: ['skill://pdf'] },
      );
      expect(result).toMatchObject({ status: 'success', complete: true });
      const passage = passageOf(result, 0);
      expect(passage.content).toContain('a.b(');
      expect(passage.content).not.toContain('axb(');
    });
  });
});

describe('scope refusals', () => {
  it.each([
    ['a web scope', 'https://example.test/docs'],
    ['a media scope', `media://${SPACE_A}`],
    ['a remote file alias', 'file://nas/share'],
    ['an unknown scheme', 'ftp://host/path'],
    [`a glob in the Space identifier`, 'kb://*/notes'],
    ['a colon in a skill scope', 'skill://pdf:3'],
    ['an unsupported glob operator', `kb://${SPACE_A}/notes/{a,b}`],
  ])('refuses %s as invalid_path', async (_case, scope) => {
    const result = await run(contextOf(), { patterns: ['x'], scopes: [scope] });
    expect(result).toMatchObject({ status: 'error', type: 'invalid_path' });
  });

  it('refuses an omitted scope with no Workspace and names only scope kinds', async () => {
    const result = await run(
      contextOf({
        resolver: knowledgeResolver(new Map()),
        catalog: catalogOf([]),
      }),
      { patterns: ['x'] },
    );
    expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
    const message = 'message' in result ? result.message : '';
    expect(message).toContain('kb://');
    expect(message).toContain('skill://');
    expect(message).not.toContain(SPACE_A);
  });

  it('fails a host scope as executor_unavailable on this layer', async () => {
    const result = await run(contextOf(), {
      patterns: ['x'],
      scopes: ['/srv/data/**'],
    });
    expect(result).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
  });
});

describe('Knowledge scopes', () => {
  it('visits a bare scope in byte order of the Space identifier', async () => {
    await withRoot(async (root) => {
      const a = await spaceFixture(root, SPACE_A, {
        'notes/a.md': lineNumbered('needle in a'),
      });
      const b = await spaceFixture(root, SPACE_B, {
        'notes/b.md': lineNumbered('needle in b'),
      });
      const result = await run(
        contextOf({
          resolver: knowledgeResolver(
            new Map([
              [SPACE_A, a.binding],
              [SPACE_B, b.binding],
            ]),
            [SPACE_B, SPACE_A],
          ),
        }),
        { patterns: ['needle'], scopes: ['kb://'] },
      );
      expect(result).toMatchObject({ status: 'success', complete: true });
      expect(locatorsOf(result)).toEqual([
        `kb://${SPACE_A}/notes/a.md:1-1`,
        `kb://${SPACE_B}/notes/b.md:1-1`,
      ]);
    });
  });

  it('reports knowledge_space_not_configured for a bare scope with no Space', async () => {
    const result = await run(
      contextOf({ resolver: knowledgeResolver(new Map()) }),
      { patterns: ['x'], scopes: ['kb://'] },
    );
    expect(result).toMatchObject({
      status: 'error',
      type: 'knowledge_space_not_configured',
    });
  });

  it('reports knowledge_space_unavailable without a resolver', async () => {
    const result = await run(contextOf(), {
      patterns: ['x'],
      scopes: [`kb://${SPACE_A}/notes`],
    });
    expect(result).toMatchObject({
      status: 'error',
      type: 'knowledge_space_unavailable',
    });
  });

  it("reports another owner's Space as not found without probing it", async () => {
    await withRoot(async (root) => {
      const a = await spaceFixture(root, SPACE_A, { 'a.md': 'needle' });
      const result = await run(
        contextOf({
          resolver: knowledgeResolver(new Map([[SPACE_A, a.binding]])),
        }),
        { patterns: ['needle'], scopes: [`kb://${SPACE_B}/a.md`] },
      );
      expect(result).toMatchObject({
        status: 'error',
        type: 'knowledge_space_not_found',
      });
    });
  });

  it('returns a hit whose locator reads the same window', async () => {
    await withRoot(async (root) => {
      const a = await spaceFixture(root, SPACE_A, {
        'notes/a.md': lineNumbered('one', 'two', 'three', 'four', 'five'),
      });
      const resolver = knowledgeResolver(new Map([[SPACE_A, a.binding]]));
      const grep = await run(contextOf({ resolver }), {
        patterns: ['four'],
        scopes: [`kb://${SPACE_A}/notes`],
      });
      expect(grep).toMatchObject({ status: 'success' });
      const passage = passageOf(grep, 0);
      expect(passage.locator).toBe(`kb://${SPACE_A}/notes/a.md:3-5`);
      expect(passage.matches).toEqual([4]);

      const read = await nativeReadTool.execute(contextOf({ resolver }), {
        path: passage.locator,
      });
      expect(read).toMatchObject({ status: 'success' });
      // The window carries one context line on each side of the hit.
      expect('shownRange' in read ? read.shownRange : undefined).toEqual({
        startLine: 2,
        endLine: 5,
      });
      expect('content' in read ? read.content : '').toContain('four');
    });
  });

  it('emits the canonical locator, which an encoded scope searches as one file', async () => {
    await withRoot(async (root) => {
      const a = await spaceFixture(root, SPACE_A, {
        'notes/a*.md': lineNumbered('one', 'two', 'needle', 'four'),
      });
      const resolver = knowledgeResolver(new Map([[SPACE_A, a.binding]]));
      const first = await run(contextOf({ resolver }), {
        patterns: ['needle'],
        scopes: [`kb://${SPACE_A}/notes`],
      });
      const hit = passageOf(first, 0).locator;
      // The scheme's formatter encodes no glob character: `*` stays as written.
      expect(hit).toBe(`kb://${SPACE_A}/notes/a*.md:2-4`);

      const second = await run(contextOf({ resolver }), {
        patterns: ['needle'],
        scopes: [`kb://${SPACE_A}/notes/a%2A.md`],
      });
      expect(locatorsOf(second)).toEqual([`kb://${SPACE_A}/notes/a*.md:2-4`]);
    });
  });

  it('treats a refused exact path as missing and hides it from the walk', async () => {
    await withRoot(async (root) => {
      const a = await spaceFixture(root, SPACE_A, {
        'secret.md': lineNumbered('needle'),
        'notes/.env': lineNumbered('needle'),
        'notes/a.md': lineNumbered('needle'),
      });
      const map: ToolPermissionMap = {
        grep: { allow: true },
        read: {
          allow: true,
          reject: [{ field: 'path', regex: '\\.env$|secret\\.md$' }],
        },
      };
      const resolver = knowledgeResolver(new Map([[SPACE_A, a.binding]]));
      const exact = await run(contextOf({ resolver, map }), {
        patterns: ['needle'],
        scopes: [`kb://${SPACE_A}/secret.md`],
      });
      const missing = await run(contextOf({ resolver, map }), {
        patterns: ['needle'],
        scopes: [`kb://${SPACE_A}/absent.md`],
      });
      expect(exact).toEqual(missing);
      expect(exact).toMatchObject({ status: 'error', type: 'not_found' });

      const walk = await run(contextOf({ resolver, map }), {
        patterns: ['needle'],
        scopes: [`kb://${SPACE_A}/notes`],
      });
      expect(walk).toMatchObject({ status: 'success', complete: true });
      expect(locatorsOf(walk)).toEqual([`kb://${SPACE_A}/notes/a.md:1-1`]);
      expect(walk).not.toHaveProperty('readRefused');
    });
  });

  it('records the refused file count in the audit only', async () => {
    await withRoot(async (root) => {
      const a = await spaceFixture(root, SPACE_A, {
        'notes/.env': lineNumbered('needle'),
        'notes/a.md': lineNumbered('needle'),
      });
      const derived: Array<DerivedDecision> = [];
      const result = await run(
        contextOf({
          resolver: knowledgeResolver(new Map([[SPACE_A, a.binding]])),
          map: {
            grep: { allow: true },
            read: {
              allow: true,
              reject: [{ field: 'path', regex: '\\.env$' }],
            },
          },
          onDerivedDecision: (decision) => derived.push(decision),
        }),
        { patterns: ['needle'], scopes: [`kb://${SPACE_A}/notes`] },
      );
      expect(result).toMatchObject({ status: 'success' });
      expect(result).not.toHaveProperty('readRefused');
      expect(derived).toHaveLength(1);
      expect(derived[0]).toMatchObject({ kind: 'grep-file', count: 1 });
    });
  });

  it('records the refusal an exact-path scope ended with', async () => {
    await withRoot(async (root) => {
      const a = await spaceFixture(root, SPACE_A, {
        'secret.md': lineNumbered('needle'),
      });
      const derived: Array<DerivedDecision> = [];
      const result = await run(
        contextOf({
          resolver: knowledgeResolver(new Map([[SPACE_A, a.binding]])),
          map: {
            grep: { allow: true },
            read: {
              allow: true,
              reject: [{ field: 'path', regex: 'secret\\.md$' }],
            },
          },
          onDerivedDecision: (decision) => derived.push(decision),
        }),
        { patterns: ['needle'], scopes: [`kb://${SPACE_A}/secret.md`] },
      );

      // The call ends at the refused file, and the audit still learns how many
      // files policy hid instead of losing the count with the early return.
      expect(result).toMatchObject({ status: 'error', type: 'not_found' });
      expect(derived).toHaveLength(1);
      expect(derived[0]).toMatchObject({ kind: 'grep-file', count: 1 });
    });
  });

  it('carries the Knowledge notice only when the page holds a kb:// passage', async () => {
    await withRoot(async (root) => {
      const a = await spaceFixture(root, SPACE_A, {
        'note.md': lineNumbered('needle'),
      });
      const pkg = path.join(root, 'pdf');
      await mkdir(pkg);
      await writeFile(path.join(pkg, 'SKILL.md'), lineNumbered('needle'));

      const knowledge = await run(
        contextOf({
          resolver: knowledgeResolver(new Map([[SPACE_A, a.binding]])),
        }),
        { patterns: ['needle'], scopes: [`kb://${SPACE_A}`] },
      );
      expect(success(knowledge).notice).toBe(KNOWLEDGE_CONTENT_NOTICE);

      const skill = await run(
        contextOf({ catalog: catalogOf([packageEntry('pdf', pkg)]) }),
        { patterns: ['needle'], scopes: ['skill://pdf'] },
      );
      expect(success(skill)).not.toHaveProperty('notice');
    });
  });
});

describe('skill scopes', () => {
  it('searches no package when no source exists', async () => {
    const result = await run(contextOf(), {
      patterns: ['x'],
      scopes: ['skill://'],
    });
    expect(result).toMatchObject({
      status: 'success',
      results: [],
      complete: true,
    });
  });

  it('follows a link and counts a loop without entering it', async () => {
    await withRoot(async (root) => {
      const pkg = path.join(root, 'pdf');
      await mkdir(pkg);
      await writeFile(path.join(pkg, 'SKILL.md'), lineNumbered('needle body'));
      await writeFile(path.join(pkg, 'zzz.md'), lineNumbered('needle last'));
      const outside = path.join(root, 'outside');
      await mkdir(outside);
      await writeFile(path.join(outside, 'far.md'), lineNumbered('needle far'));
      await symlink(outside, path.join(pkg, 'far-link'));
      await symlink(pkg, path.join(pkg, 'loop'));

      const result = await run(
        contextOf({ catalog: catalogOf([packageEntry('pdf', pkg)]) }),
        { patterns: ['needle'], scopes: ['skill://pdf'] },
      );
      expect(result).toMatchObject({ status: 'success', complete: true });
      expect(locatorsOf(result)).toEqual([
        'skill://pdf/SKILL.md:1-1',
        'skill://pdf/far-link/far.md:1-1',
        'skill://pdf/zzz.md:1-1',
      ]);
      expect(warningsOf(result)).toContainEqual({ kind: 'link', count: 1 });
    });
  });

  it('names a missing package and skips an unselected manual-only one', async () => {
    await withRoot(async (root) => {
      const manual = path.join(root, 'manual');
      await mkdir(manual);
      await writeFile(path.join(manual, 'SKILL.md'), lineNumbered('needle'));
      const catalog = catalogOf([packageEntry('manual', manual, false)]);

      expect(
        await run(contextOf({ catalog }), {
          patterns: ['needle'],
          scopes: ['skill://absent'],
        }),
      ).toMatchObject({ status: 'error', type: 'not_found' });

      const bare = await run(contextOf({ catalog }), {
        patterns: ['needle'],
        scopes: ['skill://'],
      });
      expect(bare).toMatchObject({
        status: 'success',
        results: [],
        complete: true,
      });

      const selected = await run(
        contextOf({ catalog, selection: new Set(['manual']) }),
        { patterns: ['needle'], scopes: ['skill://'] },
      );
      expect(locatorsOf(selected)).toEqual(['skill://manual/SKILL.md:1-1']);
    });
  });
});

describe('paging', () => {
  it('reserves the cursor and the notice inside the 15,000-unit page', async () => {
    await withRoot(async (root) => {
      // A path near the Knowledge byte bound makes the cursor large: a page
      // that filled the budget with passages alone would push the cursor past
      // the runner's 16,000-unit cap, which shortens it in place.
      const directory = Array.from(
        { length: 28 },
        (_, index) => `${String(index).padStart(2, '0')}${'d'.repeat(28)}`,
      ).join('/');
      // Three lines between matches keep every window its own passage.
      const matched = `${'x'.repeat(480)}needle`;
      const lines: Array<string> = [];
      for (let index = 0; index < 14; index += 1)
        lines.push('ctx', 'ctx', 'ctx', matched);
      const a = await spaceFixture(root, SPACE_A, {
        [`${directory}/note.md`]: lineNumbered(...lines),
      });
      const context = contextOf({
        resolver: knowledgeResolver(new Map([[SPACE_A, a.binding]])),
      });
      const scopes = [`kb://${SPACE_A}/${directory}`];

      const first = await run(context, { patterns: ['needle'], scopes });
      expect(first).toMatchObject({ status: 'success', complete: false });
      expect(measureNativeModelOutput(first)).toBeLessThanOrEqual(15_000);
      const cursor = cursorOf(first);
      if (cursor === undefined) throw new Error('the page carries a cursor');

      // The cursor survives the cap intact, so it still resumes the walk.
      const second = await run(context, {
        patterns: ['needle'],
        scopes,
        cursor,
      });
      expect(second).toMatchObject({ status: 'success' });
      expect(locatorsOf(second).length).toBeGreaterThan(0);
    });
  });

  it('never walks a scope twice when a page fills near the budget', async () => {
    await withRoot(async (root) => {
      // The page fills only after the walk examined every missing file, so a
      // call that pages itself again is visible as more than 5,000 reads.
      const space = path.join(root, SPACE_A);
      await mkdir(space, { recursive: true });
      const misses = Array.from(
        { length: 4999 },
        (_, index) => `f${String(index).padStart(4, '0')}.md`,
      );
      await Promise.all(
        misses.map((name) => writeFile(path.join(space, name), 'miss\n')),
      );
      // A path near the Knowledge byte bound makes the cursor large, and one
      // passage per four lines fills the page beside it.
      const directory = Array.from(
        { length: 28 },
        (_, index) => `z${String(index).padStart(2, '0')}${'d'.repeat(26)}`,
      ).join('/');
      await mkdir(path.join(space, ...directory.split('/')), {
        recursive: true,
      });
      const matched = `${'x'.repeat(228)}needle`;
      const lines: Array<string> = [];
      for (let index = 0; index < 20; index += 1)
        lines.push('ctx', matched, 'ctx', 'ctx');
      await writeFile(
        path.join(space, ...`${directory}/note.md`.split('/')),
        lineNumbered(...lines),
      );

      const reads = vi.spyOn(KnowledgeFilesystemAdapter.prototype, 'readWalk');
      try {
        const result = await run(
          contextOf({
            resolver: knowledgeResolver(
              new Map([
                [
                  SPACE_A,
                  { id: SPACE_A, name: SPACE_A, root, directory: space },
                ],
              ]),
            ),
          }),
          { patterns: ['needle'], scopes: [`kb://${SPACE_A}`] },
        );
        expect(result).toMatchObject({ status: 'success', complete: false });
        expect(measureNativeModelOutput(result)).toBeLessThanOrEqual(15_000);
        expect(reads.mock.calls.length).toBeLessThanOrEqual(5000);
      } finally {
        reads.mockRestore();
      }
    });
    // The fixture creates and walks 5,000 files, which is the bound it proves.
  }, 30_000);

  it('resumes after the cursor and refuses a cursor from other inputs', async () => {
    await withRoot(async (root) => {
      const pkg = path.join(root, 'pdf');
      await mkdir(pkg);
      for (const name of ['a.md', 'b.md', 'c.md']) {
        await writeFile(path.join(pkg, name), lineNumbered('needle'));
      }
      const context = contextOf({
        catalog: catalogOf([packageEntry('pdf', pkg)]),
      });
      const first = await run(context, {
        patterns: ['needle'],
        scopes: ['skill://pdf'],
        limit: 1,
      });
      expect(first).toMatchObject({ status: 'success', complete: false });
      const cursor = cursorOf(first);
      expect(locatorsOf(first)).toEqual(['skill://pdf/a.md:1-1']);
      if (cursor === undefined)
        throw new Error('the first page carries a cursor');

      const second = await run(context, {
        patterns: ['needle'],
        scopes: ['skill://pdf'],
        limit: 1,
        cursor,
      });
      expect(locatorsOf(second)).toEqual(['skill://pdf/b.md:1-1']);

      const foreign = await run(context, {
        patterns: ['other'],
        scopes: ['skill://pdf'],
        limit: 1,
        cursor,
      });
      expect(foreign).toMatchObject({ status: 'error', type: 'invalid_input' });
    });
  });

  it('resumes a bare kb:// page in the Space the cursor ended in', async () => {
    await withRoot(async (root) => {
      const a = await spaceFixture(root, SPACE_A, {
        'note.md': lineNumbered('needle'),
      });
      const b = await spaceFixture(root, SPACE_B, {
        'note.md': lineNumbered('needle'),
      });
      const context = contextOf({
        resolver: knowledgeResolver(
          new Map([
            [SPACE_A, a.binding],
            [SPACE_B, b.binding],
          ]),
        ),
      });

      const first = await run(context, {
        patterns: ['needle'],
        scopes: ['kb://'],
        limit: 1,
      });
      expect(locatorsOf(first)).toEqual([`kb://${SPACE_A}/note.md:1-1`]);
      const cursor = cursorOf(first);
      if (cursor === undefined)
        throw new Error('the first page carries a cursor');

      // Every expanded Space is its own scope, so the cursor of the first page
      // hides only that Space's file, not the identically named file of the
      // next one.
      const second = await run(context, {
        patterns: ['needle'],
        scopes: ['kb://'],
        limit: 1,
        cursor,
      });
      expect(locatorsOf(second)).toEqual([`kb://${SPACE_B}/note.md:1-1`]);
    });
  });

  it('resumes a bare skill:// page in the package the cursor ended in', async () => {
    await withRoot(async (root) => {
      for (const name of ['alpha', 'pdf']) {
        const directory = path.join(root, name);
        await mkdir(directory);
        await writeFile(
          path.join(directory, 'SKILL.md'),
          lineNumbered('needle'),
        );
      }
      const context = contextOf({
        catalog: catalogOf([
          packageEntry('pdf', path.join(root, 'pdf')),
          packageEntry('alpha', path.join(root, 'alpha')),
        ]),
      });

      const first = await run(context, {
        patterns: ['needle'],
        scopes: ['skill://'],
        limit: 1,
      });
      expect(locatorsOf(first)).toEqual(['skill://alpha/SKILL.md:1-1']);
      const cursor = cursorOf(first);
      if (cursor === undefined)
        throw new Error('the first page carries a cursor');

      const second = await run(context, {
        patterns: ['needle'],
        scopes: ['skill://'],
        limit: 1,
        cursor,
      });
      expect(locatorsOf(second)).toEqual(['skill://pdf/SKILL.md:1-1']);
    });
  });

  it('returns no passage with complete true when nothing matches', async () => {
    await withRoot(async (root) => {
      const pkg = path.join(root, 'pdf');
      await mkdir(pkg);
      await writeFile(path.join(pkg, 'a.md'), lineNumbered('nothing here'));
      const result = await run(
        contextOf({ catalog: catalogOf([packageEntry('pdf', pkg)]) }),
        { patterns: ['needle'], scopes: ['skill://pdf'] },
      );
      expect(result).toEqual({
        status: 'success',
        results: [],
        complete: true,
        warnings: [],
      });
    });
  });
});

describe('native attempt', () => {
  it('appends no native.attempt: the tenant transaction is never opened', async () => {
    await withRoot(async (root) => {
      const a = await spaceFixture(root, SPACE_A, {
        'notes/a.md': lineNumbered('needle'),
      });
      const runAs = vi.fn(() =>
        Promise.reject(new Error('grep never opens a tenant transaction')),
      );
      const context: ToolContext = {
        ...contextOf({
          resolver: knowledgeResolver(new Map([[SPACE_A, a.binding]])),
        }),
        tenantDb: { runAs },
      };
      const result = await run(context, {
        patterns: ['needle'],
        scopes: [`kb://${SPACE_A}/notes`],
      });
      expect(result).toMatchObject({ status: 'success' });
      expect(runAs).not.toHaveBeenCalled();
    });
  });
});

describe('unavailable catalog', () => {
  it('fails a skill scope when the catalog reports itself unavailable', async () => {
    const result = await run(
      contextOf({
        catalog: {
          getSnapshot: () => ({
            available: false,
            directories: [],
            entries: [],
            diagnostics: ['unreadable'],
          }),
        },
      }),
      { patterns: ['x'], scopes: ['skill://pdf'] },
    );
    expect(result).toEqual(skillCatalogUnavailableResult());
  });
});

describe('pattern and scope ordering', () => {
  it('refuses an over-bound pattern before any scope is admitted', async () => {
    // 300 code units, 600 UTF-8 bytes: the engine's bound is bytes.
    const result = await run(contextOf({ catalog: catalogOf([]) }), {
      patterns: ['é'.repeat(300)],
      scopes: ['machine://dev/notes'],
    });

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_pattern',
      message: 'Pattern 0: pattern exceeds 512 UTF-8 bytes',
    });
  });

  it('names the first oversized pattern before compiling an earlier one', async () => {
    const result = await run(contextOf({ catalog: catalogOf([]) }), {
      patterns: [String.raw`(a)\1`, 'é'.repeat(300)],
      scopes: ['machine://dev/notes'],
    });

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_pattern',
      message: 'Pattern 1: pattern exceeds 512 UTF-8 bytes',
    });
  });

  it('compiles a pattern exactly at the 512-byte bound', async () => {
    await withRoot(async (root) => {
      const pkg = path.join(root, 'pdf');
      await mkdir(pkg);
      await writeFile(
        path.join(pkg, 'SKILL.md'),
        lineNumbered('x'.repeat(512)),
      );
      const result = await run(
        contextOf({ catalog: catalogOf([packageEntry('pdf', pkg)]) }),
        { patterns: ['x'.repeat(512)], scopes: ['skill://pdf'] },
      );

      expect(locatorsOf(result)).toEqual(['skill://pdf/SKILL.md:1-1']);
    });
  });
});

describe('matching modes', () => {
  async function packageWith(root: string, content: string): Promise<string> {
    const pkg = path.join(root, 'pdf');
    await mkdir(pkg, { recursive: true });
    await writeFile(path.join(pkg, 'SKILL.md'), lineNumbered(content));
    return pkg;
  }

  it('matches case-sensitively unless ignoreCase asks otherwise', async () => {
    await withRoot(async (root) => {
      const pkg = await packageWith(root, 'Needle in a haystack');
      const context = contextOf({
        catalog: catalogOf([packageEntry('pdf', pkg)]),
      });

      expect(
        await run(context, { patterns: ['needle'], scopes: ['skill://pdf'] }),
      ).toMatchObject({ status: 'success', results: [] });
      expect(
        locatorsOf(
          await run(context, {
            patterns: ['needle'],
            ignoreCase: true,
            scopes: ['skill://pdf'],
          }),
        ),
      ).toEqual(['skill://pdf/SKILL.md:1-1']);
    });
  });

  it('reads metacharacters as syntax unless literal asks otherwise', async () => {
    await withRoot(async (root) => {
      const pkg = await packageWith(root, 'axb');
      const context = contextOf({
        catalog: catalogOf([packageEntry('pdf', pkg)]),
      });

      expect(
        locatorsOf(
          await run(context, { patterns: ['a.b'], scopes: ['skill://pdf'] }),
        ),
      ).toEqual(['skill://pdf/SKILL.md:1-1']);
      expect(
        await run(context, {
          patterns: ['a.b'],
          literal: true,
          scopes: ['skill://pdf'],
        }),
      ).toMatchObject({ status: 'success', results: [] });
    });
  });
});

describe('cursor inputs', () => {
  async function pagedPackage(root: string): Promise<ToolContext> {
    const pkg = path.join(root, 'pdf');
    await mkdir(pkg);
    await writeFile(path.join(pkg, 'a.md'), lineNumbered('needle'));
    await writeFile(path.join(pkg, 'b.md'), lineNumbered('needle'));
    return contextOf({ catalog: catalogOf([packageEntry('pdf', pkg)]) });
  }

  it('omits a cursor from a complete result', async () => {
    await withRoot(async (root) => {
      const context = await pagedPackage(root);
      const result = await run(context, {
        patterns: ['needle'],
        scopes: ['skill://pdf'],
      });
      expect(result).not.toHaveProperty('cursor');
    });
  });

  it('keys the cursor on the effective ignoreCase flag', async () => {
    await withRoot(async (root) => {
      const context = await pagedPackage(root);
      const page = await run(context, {
        patterns: ['needle'],
        ignoreCase: true,
        scopes: ['skill://pdf'],
        limit: 1,
      });
      const cursor = cursorOf(page);
      if (cursor === undefined)
        throw new Error('the first page carries a cursor');

      expect(
        await run(context, {
          patterns: ['needle'],
          ignoreCase: false,
          scopes: ['skill://pdf'],
          limit: 1,
          cursor,
        }),
      ).toMatchObject({ status: 'error', type: 'invalid_input' });
    });
  });

  it('keys the cursor on the effective literal flag', async () => {
    await withRoot(async (root) => {
      const context = await pagedPackage(root);
      const page = await run(context, {
        patterns: ['needle'],
        literal: true,
        scopes: ['skill://pdf'],
        limit: 1,
      });
      const cursor = cursorOf(page);
      if (cursor === undefined)
        throw new Error('the first page carries a cursor');

      expect(
        await run(context, {
          patterns: ['needle'],
          literal: false,
          scopes: ['skill://pdf'],
          limit: 1,
          cursor,
        }),
      ).toMatchObject({ status: 'error', type: 'invalid_input' });
    });
  });

  it('treats an explicit false as the same input as an omitted flag', async () => {
    await withRoot(async (root) => {
      const context = await pagedPackage(root);
      const omitted = await run(context, {
        patterns: ['needle'],
        scopes: ['skill://pdf'],
        limit: 1,
      });
      const cursor = cursorOf(omitted);
      if (cursor === undefined)
        throw new Error('the first page carries a cursor');

      expect(
        await run(context, {
          patterns: ['needle'],
          ignoreCase: false,
          literal: false,
          scopes: ['skill://pdf'],
          limit: 1,
          cursor,
        }),
      ).toMatchObject({ status: 'success' });
    });
  });
});

describe('scope kinds message', () => {
  const MACHINES = new MachineConnector({
    machines: undefined,
    hubVersion: 'test',
    onContact: () => undefined,
  });

  it.each([
    [{}, 'grep requires scopes, and this process has no searchable backend.'],
    [
      { nativeExecutorId: 'host-a' },
      'grep requires scopes: this process can search host paths.',
    ],
    [
      { machines: MACHINES },
      'grep requires scopes: this process can search machine:// locators.',
    ],
    [
      { knowledgeResolver: knowledgeResolver(new Map()) },
      'grep requires scopes: this process can search kb:// locators.',
    ],
    [
      { skillCatalog: catalogOf([]) },
      'grep requires scopes: this process can search skill:// locators.',
    ],
    [
      {
        knowledgeResolver: knowledgeResolver(new Map()),
        skillCatalog: catalogOf([]),
      },
      'grep requires scopes: this process can search kb:// locators, and skill:// locators.',
    ],
    [
      {
        nativeExecutorId: 'host-a',
        knowledgeResolver: knowledgeResolver(new Map()),
        skillCatalog: catalogOf([]),
      },
      'grep requires scopes: this process can search host paths, kb:// locators, and skill:// locators.',
    ],
  ])(
    'names only the backends this process can serve',
    async (extra, message) => {
      const result = await run(
        { ...contextOf(), ...extra },
        { patterns: ['x'] },
      );
      expect(result).toEqual({
        status: 'error',
        type: 'invalid_input',
        message,
      });
    },
  );
});

describe('walk failures', () => {
  it('propagates a cancellation the walk raised instead of a result', async () => {
    await withRoot(async (root) => {
      const pkg = path.join(root, 'pdf');
      await mkdir(pkg);
      await writeFile(path.join(pkg, 'SKILL.md'), lineNumbered('needle'));
      const controller = new AbortController();
      const catalog = catalogOf([packageEntry('pdf', pkg)]);
      const context: ToolContext = {
        ...contextOf(),
        abortSignal: controller.signal,
        skillCatalog: {
          getSnapshot: (sources) => {
            // Cancel while the scope resolves: the entry check has already
            // run, so the cancellation has to travel out of the walk itself.
            controller.abort();
            return catalog.getSnapshot(sources);
          },
        },
      };

      await expect(
        run(context, { patterns: ['needle'], scopes: ['skill://pdf/**'] }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  it('returns the closed result a scope failed with instead of throwing', async () => {
    await withRoot(async (root) => {
      const pkg = path.join(root, 'pdf');
      await mkdir(pkg);
      const result = await run(
        contextOf({ catalog: catalogOf([packageEntry('pdf', pkg)]) }),
        { patterns: ['needle'], scopes: ['skill://pdf/absent/**'] },
      );

      expect(result).toEqual(skillUnavailableResult());
    });
  });
});
