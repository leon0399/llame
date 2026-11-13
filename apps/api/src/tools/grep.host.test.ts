import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { dirname } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import { describe, expect, it, vi, type MockInstance } from 'vitest';

import { type Db } from '../db/tenant-db.service';
import { type GrepBoundsConfig } from '../instance-config/llame-config';
import { type SkillCatalogPort } from '../skills/skill-catalog';
import { ArtifactsRepository } from './artifacts/artifacts-repository';
import { grepInputSchema, nativeGrepTool } from './grep';
import { machineUnsupportedResult } from './grep-results';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolPermissionMap } from './permissions/types';
import { type ToolContext, type ToolResult } from './types';
import { createWorkspaceRootCell } from './workspace-path';

const PERMISSIVE: ToolPermissionMap = {
  grep: { allow: true },
  read: { allow: true },
};

const NO_CATALOG: SkillCatalogPort = {
  getSnapshot: () => ({
    available: true,
    directories: [],
    entries: [],
    diagnostics: [],
  }),
};

/** The artifact writes the tests that read one make, as their own mocks. */
let artifactWrites:
  | MockInstance<ArtifactsRepository['insertParts']>
  | undefined;

function stubArtifactWrites(): void {
  // A spy installed twice keeps its earlier calls, so each stub starts clean.
  vi.restoreAllMocks();
  vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(1);
  vi.spyOn(ArtifactsRepository.prototype, 'insertArtifact').mockResolvedValue({
    id: 'artifact-1',
    createdAt: new Date('2026-11-02T12:00:00.000Z'),
  });
  artifactWrites = vi
    .spyOn(ArtifactsRepository.prototype, 'insertParts')
    .mockResolvedValue(undefined);
}

/** The text of the one artifact the call wrote. */
function artifactText(): string {
  const parts = artifactWrites?.mock.calls[0]?.[1] ?? [];
  const part = parts[0];

  if (part === undefined) throw new Error('the call wrote no artifact');

  return part.content.toString('utf8');
}

/** The artifact headings, one per file of the stored text. */
function artifactHeadings(): ReadonlyArray<string> {
  return artifactText()
    .split('\n')
    .filter((line) => line.startsWith('## '));
}

type ContextOptions = {
  /** The entered Workspace root; absent means none is entered. */
  readonly root?: string;
  /** The Run can read artifacts, so a result too large for the head is stored. */
  readonly artifacts?: boolean;
  /** `false` omits the first condition of the host authority gate. */
  readonly executor?: boolean;
  readonly run?: boolean;
  readonly map?: ToolPermissionMap;
  /** Operator `tools.grep` bounds; absent means every bound is unset. */
  readonly grepBounds?: GrepBoundsConfig;
  /** The call's own timeout, so a spinning walk fails fast in the test. */
  readonly timeoutMs?: number;
  /** The stored-result bound, when a test needs a small one. */
  readonly artifactMaxBytes?: number;
};

function contextOf(options: ContextOptions = {}): ToolContext {
  const trusted = options.executor !== false;
  const db: Db = drizzle.mock();

  return {
    userId: 'owner-a',
    chatId: 'chat-a',
    configuredCredentials: [],
    toolCallId: 'call-a',
    runId: options.run === false ? undefined : 'run-a',
    nativeExecutorId: trusted ? 'host-a' : undefined,
    permissionPolicy: compileToolPermissionMap(
      options.map ?? PERMISSIVE,
      'test',
    ),
    tenantDb:
      options.artifacts === true
        ? {
            runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
              callback(db),
          }
        : {
            runAs: () =>
              Promise.reject(
                new Error('grep never opens a tenant transaction'),
              ),
          },
    ...(options.artifacts === true && { artifactReadable: true }),
    skillCatalog: NO_CATALOG,
    grepBounds: options.grepBounds,
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    ...(options.artifactMaxBytes !== undefined && {
      artifactMaxBytes: options.artifactMaxBytes,
    }),
    workspaceRoot:
      options.root === undefined
        ? undefined
        : createWorkspaceRootCell(options.root),
  };
}

async function temporaryRoot(): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), 'llame-grep-host-')));
}

async function withRoot<T>(callback: (root: string) => Promise<T>): Promise<T> {
  const root = await temporaryRoot();
  // A repository at the fixture root seals the walk: nothing above `tmpdir`
  // can change which ignore files apply.
  await mkdir(path.join(root, '.git'), { recursive: true });

  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Write one file below `root`, creating its parent directories. */
async function writeAt(
  root: string,
  relative: string,
  content: string | Uint8Array,
): Promise<string> {
  const target = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);

  return target;
}

/** Operator grep bounds, every field unset unless named. */
function bounds(overrides: Partial<GrepBoundsConfig> = {}): GrepBoundsConfig {
  return {
    maxFilesExamined: null,
    maxEntriesListed: null,
    maxBytesRead: null,
    maxFileBytes: null,
    ...overrides,
  };
}

function run(context: ToolContext, args: unknown) {
  const parsed = grepInputSchema.safeParse(args);

  if (!parsed.success) throw new Error('the fixture arguments must parse');

  return nativeGrepTool.execute(context, parsed.data);
}

function success(result: ToolResult) {
  if (result.status !== 'success') {
    throw new Error(`expected success, received ${result.type}`);
  }

  return result;
}

function resultList(result: ToolResult): ReadonlyArray<unknown> {
  const results = success(result).results;

  if (!Array.isArray(results)) return [];
  const list: Array<unknown> = [];

  for (const entry of results) list.push(entry);

  return list;
}

/** The nearest directory above `directory` that holds a `.git` entry. */
async function gitAbove(directory: string): Promise<string | undefined> {
  let current = directory;

  for (;;) {
    try {
      await lstat(path.join(current, '.git'));

      return current;
    } catch {
      const parent = dirname(current);

      if (parent === current) return undefined;
      current = parent;
    }
  }
}

function locatorsOf(result: ToolResult): ReadonlyArray<string> {
  return resultList(result).map((passage) => {
    if (!isRecord(passage) || !isString(passage.locator)) {
      throw new Error('a passage carries a locator');
    }

    return passage.locator;
  });
}

/** The excluded-directory report of a successful result, when it carries one. */
function ignoredOf(result: ToolResult):
  | {
      readonly count: number;
      readonly locators: ReadonlyArray<string>;
      readonly atLeast: boolean;
    }
  | undefined {
  const ignored = success(result).ignored;

  if (!isRecord(ignored)) return undefined;
  const { count, locators, atLeast } = ignored;

  if (!isNumber(count) || !Array.isArray(locators)) return undefined;

  if (!locators.every(isString)) return undefined;

  return { count, locators, atLeast: atLeast === true };
}

function warningsOf(result: ToolResult): ReadonlyArray<unknown> {
  const warnings = success(result).warnings;

  return Array.isArray(warnings) ? warnings : [];
}

describe('host walk policy', () => {
  it('does not enter a gitignored directory', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', 'node_modules/\n');
      await writeAt(root, 'node_modules/pkg/index.js', 'needle\n');
      await writeAt(root, 'src/app.js', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/**`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/src/app.js:1-1`]);
    });
  });

  it('searches an explicitly named gitignored file', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', 'dist/\n');
      await writeAt(root, 'dist/app.js', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/dist/app.js`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/dist/app.js:1-1`]);
    });
  });

  it('never enters the Git directory and still searches hidden files', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.git/config', 'needle\n');
      await writeAt(root, '.editorconfig', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/**`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/.editorconfig:1-1`]);
    });
  });

  it('does not follow a host symbolic link', async () => {
    await withRoot(async (root) => {
      const outside = path.join(root, 'outside');
      await writeAt(outside, 'far.md', 'needle\n');
      const inside = path.join(root, 'repo');
      await writeAt(inside, 'near.md', 'needle\n');
      await symlink(outside, path.join(inside, 'link'), 'dir');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${inside}/**`],
      });

      expect(locatorsOf(result)).toEqual([`${inside}/near.md:1-1`]);
    });
  });

  it('counts a binary file as a skip and searches a two-mebibyte file', async () => {
    await withRoot(async (root) => {
      await writeAt(
        root,
        'binary.bin',
        Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00]),
      );
      // No fixed file-size cut: a file over one mebibyte is searched, and its
      // bytes count against the call's byte budget.
      const large = `${'a'.repeat(2 * 1024 * 1024)}\nneedle\n`;
      await writeAt(root, 'large.txt', large);
      await writeAt(root, 'plain.txt', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/**`],
      });

      expect(locatorsOf(result)).toEqual([
        `${root}/large.txt:1-2`,
        `${root}/plain.txt:1-1`,
      ]);
      expect(warningsOf(result)).toEqual([{ kind: 'binary', count: 1 }]);
    });
  });

  it('treats a colon in a host path as path text', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'v:1/a.md', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/v:1/**`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/v:1/a.md:1-1`]);
    });
  });

  it('resolves parent segments before the walk starts', async () => {
    await withRoot(async (base) => {
      const repo = path.join(base, 'repo');
      await mkdir(repo);
      const elsewhere = path.join(base, 'elsewhere');
      await writeAt(elsewhere, 'a.md', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${repo}/../elsewhere/**`],
      });

      expect(locatorsOf(result)).toEqual([`${elsewhere}/a.md:1-1`]);
    });
  });

  it('refuses a symbolic link as the one path a scope names', async () => {
    await withRoot(async (root) => {
      const target = await writeAt(root, 'real.md', 'needle\n');
      const link = path.join(root, 'link.md');
      await symlink(target, link);

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [link],
      });

      expect(result).toMatchObject({ status: 'error', type: 'not_found' });
    });
  });

  it('reports a glob scope over a missing directory as not_found', async () => {
    await withRoot(async (root) => {
      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/absent/**`],
      });

      expect(result).toMatchObject({ status: 'error', type: 'not_found' });
    });
  });

  it('reports a glob scope whose root is a link or a file as not_found', async () => {
    await withRoot(async (root) => {
      const outside = path.join(root, 'outside');
      await writeAt(outside, 'far.md', 'needle\n');
      const link = path.join(root, 'link');
      await symlink(outside, link, 'dir');

      const linked = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${link}/**`],
      });

      expect(linked).toMatchObject({ status: 'error', type: 'not_found' });

      await writeAt(root, 'one.md', 'needle\n');

      const fileRoot = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/one.md/**`],
      });

      expect(fileRoot).toMatchObject({ status: 'error', type: 'not_found' });
    });
  });

  it('searches a single file scope without walking a directory', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'one.md', 'needle\n');
      await writeAt(root, 'two.md', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/one.md`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/one.md:1-1`]);
    });
  });
});

describe('host ignore files above the scope', () => {
  it('applies a repository rule to a narrower scope', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', 'dist/\n');
      await writeAt(root, 'apps/web/dist/out.js', 'needle\n');
      await writeAt(root, 'apps/web/keep.js', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/apps`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/apps/web/keep.js:1-1`]);
    });
  });

  it('applies an ignore file outside a repository', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'Projects/.ignore', '.build-cache/\n');
      await writeAt(
        root,
        'Projects/Arduino/libraries/.build-cache/x.h',
        'needle\n',
      );
      await writeAt(root, 'Projects/Arduino/libraries/keep.h', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/Projects/Arduino`],
      });

      expect(locatorsOf(result)).toEqual([
        `${root}/Projects/Arduino/libraries/keep.h:1-1`,
      ]);
    });
  });

  it('never searches an ignore file of a directory scope', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.ignore', 'needle\n');
      await writeAt(root, 'plain.md', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/plain.md:1-1`]);
    });
  });

  it('starts repository detection at the prefix itself', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', '*.md\n');
      await mkdir(path.join(root, 'inner/.git'), { recursive: true });
      await writeAt(root, 'inner/README.md', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/inner`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/inner/README.md:1-1`]);
    });
  });

  it('applies a gitignore between the repository and the prefix', async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, 'repo/.git'), { recursive: true });
      await writeAt(root, 'repo/apps/.gitignore', 'dist/\n');
      await writeAt(root, 'repo/apps/web/dist/out.js', 'needle\n');
      await writeAt(root, 'repo/apps/web/keep.js', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/repo/apps/web`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/repo/apps/web/keep.js:1-1`]);
    });
  });

  it('treats a .git file as a repository', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', '*.md\n');
      await writeAt(root, 'worktree/.git', 'gitdir: elsewhere\n');
      await writeAt(root, 'worktree/sub/README.md', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/worktree/sub`],
      });

      expect(locatorsOf(result)).toEqual([
        `${root}/worktree/sub/README.md:1-1`,
      ]);
    });
  });

  it('does not apply a gitignore above the repository', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', '*.md\n');
      await mkdir(path.join(root, 'repo/.git'), { recursive: true });
      await writeAt(root, 'repo/README.md', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/repo`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/repo/README.md:1-1`]);
    });
  });

  it('does not apply a gitignore outside a repository above the scope', async () => {
    // This tree has no repository on purpose, so it cannot use the sealed root.
    expect(
      await gitAbove(dirname(tmpdir())),
      'tmpdir must sit outside every git work tree',
    ).toBeUndefined();
    const root = await temporaryRoot();

    try {
      await writeAt(root, 'Projects/.gitignore', '*.md\n');
      await writeAt(root, 'Projects/Arduino/README.md', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/Projects/Arduino`],
      });

      expect(locatorsOf(result)).toEqual([
        `${root}/Projects/Arduino/README.md:1-1`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('host excluded-directory report', () => {
  it('names the excluded directory a later scope searches', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', 'node_modules/\n');
      await writeAt(root, 'node_modules/dep.js', 'needle\n');

      const first = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [root],
      });

      expect(ignoredOf(first)).toEqual({
        count: 1,
        locators: [`${root}/node_modules`],
        atLeast: false,
      });

      const second = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/node_modules`],
      });

      expect(locatorsOf(second)).toEqual([`${root}/node_modules/dep.js:1-1`]);
    });
  });

  it('judges a directory as written with a regex reject', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', 'secrets/\n');
      await writeAt(root, 'secrets/key.txt', 'needle\n');

      const result = await run(
        contextOf({
          map: {
            grep: { allow: true },
            read: {
              allow: true,
              reject: [{ field: 'path', regex: '/secrets$' }],
            },
          },
        }),
        { patterns: ['needle'], scopes: [root] },
      );

      expect(ignoredOf(result)).toBeUndefined();
    });
  });

  it('does not name a directory the read group refuses', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', 'node_modules/\nsecrets/\n');
      await writeAt(root, 'node_modules/dep.js', 'needle\n');
      await writeAt(root, 'secrets/key.txt', 'needle\n');

      const result = await run(
        contextOf({
          map: {
            grep: { allow: true },
            read: {
              allow: true,
              reject: [{ field: 'path', literal: `${root}/secrets` }],
            },
          },
        }),
        { patterns: ['needle'], scopes: [root] },
      );

      expect(ignoredOf(result)).toEqual({
        count: 1,
        locators: [`${root}/node_modules`],
        atLeast: false,
      });
    });
  });

  it('hides a directory a reject names with a final separator', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', '.ssh/\n');
      await writeAt(root, '.ssh/id.txt', 'needle\n');

      const result = await run(
        contextOf({
          map: {
            grep: { allow: true },
            read: {
              allow: true,
              reject: [{ field: 'path', literal: `${root}/.ssh/` }],
            },
          },
        }),
        { patterns: ['needle'], scopes: [root] },
      );

      expect(ignoredOf(result)).toBeUndefined();
    });
  });

  it('names an excluded directory in bypass mode', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', 'node_modules/\n');
      await writeAt(root, 'node_modules/dep.js', 'needle\n');

      const context: ToolContext = {
        ...contextOf({
          map: {
            grep: { allow: true },
            read: {
              allow: true,
              reject: [{ field: 'path', literal: `${root}/node_modules` }],
            },
          },
        }),
        permissionMode: 'bypass',
      };

      const result = await run(context, {
        patterns: ['needle'],
        scopes: [root],
      });

      expect(ignoredOf(result)?.locators).toEqual([`${root}/node_modules`]);
    });
  });

  it('marks a count past one thousand as a lower bound', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', '*.tmp/\n');

      for (let index = 0; index < 1001; index += 1)
        await mkdir(path.join(root, `d${String(index).padStart(4, '0')}.tmp`));

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [root],
      });

      expect(ignoredOf(result)).toMatchObject({
        count: 1000,
        atLeast: true,
      });
    });
  });

  it('spells a bracketed directory so a later scope searches it', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', 'node_modules/\n');
      await writeAt(root, 'app/[id]/node_modules/dep.js', 'needle\n');

      const first = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [root],
      });

      expect(ignoredOf(first)?.locators).toEqual([
        `${root}/app/%5Bid%5D/node_modules`,
      ]);

      const second = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/app/%5Bid%5D/node_modules`],
      });

      expect(locatorsOf(second)).toEqual([
        `${root}/app/[id]/node_modules/dep.js:1-1`,
      ]);
    });
  });

  it('spells a literal percent so a later scope searches it', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '.gitignore', 'node_modules/\n');
      await writeAt(root, '100%41/node_modules/dep.js', 'needle\n');

      const first = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [root],
      });

      expect(ignoredOf(first)?.locators).toEqual([
        `${root}/100%2541/node_modules`,
      ]);

      const second = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/100%2541/node_modules`],
      });

      expect(locatorsOf(second)).toEqual([
        `${root}/100%41/node_modules/dep.js:1-1`,
      ]);
    });
  });
});

describe('host scope spellings', () => {
  it('decodes the literal %2A spelling in the prefix', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'a*b/one.js', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/a%2Ab`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/a*b/one.js:1-1`]);
    });
  });

  it('keeps another percent sequence as text', async () => {
    await withRoot(async (root) => {
      await writeAt(root, '100%41/one.js', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/100%41`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/100%41/one.js:1-1`]);
    });
  });

  it('decodes a spelled percent once', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'a%2A/one.js', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/a%252A`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/a%2A/one.js:1-1`]);
    });
  });

  it('does not decode a file alias a second time', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'a%2A/one.js', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`file://${root}/a%252A`],
      });

      expect(locatorsOf(result)).toEqual([`${root}/a%2A/one.js:1-1`]);
    });
  });
});

describe('host Workspace rule', () => {
  it('does not decode a percent spelling in the Workspace root', async () => {
    await withRoot(async (root) => {
      const workspace = `${root}/100%2541`;
      await writeAt(workspace, 'a.md', 'needle\n');

      const absolute = await run(contextOf({ root: workspace }), {
        patterns: ['needle'],
      });

      expect(locatorsOf(absolute)).toEqual([`${workspace}/a.md:1-1`]);

      const relative = await run(contextOf({ root: workspace }), {
        patterns: ['needle'],
        scopes: ['a.md'],
      });

      expect(locatorsOf(relative)).toEqual([`${workspace}/a.md:1-1`]);
    });
  });

  it('searches the Workspace root when scopes are omitted', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'a.md', 'needle\n');
      const result = await run(contextOf({ root }), { patterns: ['needle'] });
      expect(locatorsOf(result)).toEqual([`${root}/a.md:1-1`]);
    });
  });

  it('names only scope kinds without a Workspace', async () => {
    const result = await run(
      { ...contextOf(), skillCatalog: undefined },
      { patterns: ['needle'] },
    );

    expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
    const message = 'message' in result ? result.message : '';
    expect(message).toContain('host paths');
    expect(message).not.toContain('kb://');
    expect(message).not.toContain('skill://');
  });

  it('resolves a relative scope from the Workspace root', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'src/a.ts', 'needle\n');
      await writeAt(root, 'other/b.ts', 'needle\n');

      const result = await run(contextOf({ root }), {
        patterns: ['needle'],
        scopes: ['src/**'],
      });

      expect(locatorsOf(result)).toEqual([`${root}/src/a.ts:1-1`]);
    });
  });

  it('refuses a relative scope with no entered Workspace', async () => {
    const result = await run(contextOf(), {
      patterns: ['needle'],
      scopes: ['src/**'],
    });

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'A relative scope needs an entered Workspace.',
    });
  });

  it('maps a host scope inside a Machine Workspace to the Machine', async () => {
    const context = contextOf({ root: 'machine://devl/home/me/shop' });
    expect(
      await run(context, {
        patterns: ['needle'],
        scopes: ['/home/me/shop/src/**'],
      }),
    ).toEqual(machineUnsupportedResult());
    expect(
      await run(context, { patterns: ['needle'], scopes: ['src/**'] }),
    ).toEqual(machineUnsupportedResult());
  });
});

describe('host authority', () => {
  it.each([
    ['no native executor', { executor: false }],
    ['no Run identity', { run: false }],
  ])(
    'fails a host scope with %s as executor_unavailable',
    async (_case, options) => {
      await withRoot(async (root) => {
        await writeAt(root, 'a.md', 'needle\n');

        const result = await run(contextOf(options), {
          patterns: ['needle'],
          scopes: [`${root}/**`],
        });

        expect(result).toMatchObject({
          status: 'error',
          type: 'executor_unavailable',
        });
      });
    },
  );

  it('opens no tenant transaction for a host walk', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'a.md', 'needle\n');

      const runAs = vi.fn(() =>
        Promise.reject(new Error('grep never opens a tenant transaction')),
      );

      const context: ToolContext = {
        ...contextOf({ root }),
        tenantDb: { runAs },
      };

      const result = await run(context, { patterns: ['needle'] });
      expect(result).toMatchObject({ status: 'success' });
      expect(runAs).not.toHaveBeenCalled();
    });
  });

  it('serves a skill source alone while host and Knowledge scopes fail closed', async () => {
    // The `tool-calling` scenario "Grep is admitted by any serving backend":
    // a skill source admits the tool, and each other backend keeps failing.
    const context = contextOf({ executor: false });
    expect(
      await run(context, { patterns: ['x'], scopes: ['/srv/data/**'] }),
    ).toMatchObject({ status: 'error', type: 'executor_unavailable' });
    expect(
      await run(context, {
        patterns: ['x'],
        scopes: ['kb://11111111-1111-4111-8111-111111111111/notes'],
      }),
    ).toMatchObject({
      status: 'error',
      type: 'knowledge_space_unavailable',
    });
    expect(
      await run(context, { patterns: ['x'], scopes: ['skill://'] }),
    ).toMatchObject({ status: 'success', results: [], complete: true });
  });
});

describe('operator bounds', () => {
  it('stops the walk at the configured file bound', async () => {
    await withRoot(async (root) => {
      for (const name of ['a.md', 'b.md', 'c.md']) {
        await writeAt(root, name, 'miss\n');
      }

      await writeAt(root, 'd.md', 'needle\n');

      const context = contextOf({
        grepBounds: bounds({ maxFilesExamined: 3 }),
      });

      const result = await run(context, {
        patterns: ['needle'],
        scopes: [`${root}/**`],
      });

      expect(result).toMatchObject({ status: 'success', results: [] });
      expect(success(result).complete).toBe(false);
      expect(warningsOf(result)).toEqual([{ kind: 'file_bound', count: 1 }]);
      // The walk has one call, so a stopped one names the bound and returns
      // no cursor the model could page with.
      expect(result).not.toHaveProperty('cursor');
    });
  });

  it('stops the walk at the configured byte bound', async () => {
    await withRoot(async (root) => {
      // Four KiB files against an eight KiB bound: two files fill it, which is
      // the ten one-MiB files of the spec's example at a test's scale.
      const kib = `${'x'.repeat(4095)}\n`;
      await writeAt(root, 'a.md', kib);
      await writeAt(root, 'b.md', kib);
      await writeAt(root, 'c.md', 'needle\n');

      const context = contextOf({
        grepBounds: bounds({ maxBytesRead: 8192 }),
      });

      const result = await run(context, {
        patterns: ['needle'],
        scopes: [`${root}/**`],
      });

      expect(result).toMatchObject({ status: 'success', results: [] });
      expect(success(result).complete).toBe(false);
      expect(warningsOf(result)).toEqual([{ kind: 'byte_bound', count: 1 }]);
      expect(result).not.toHaveProperty('cursor');
    });
  });

  it('names a first file the byte bound stops inside', async () => {
    await withRoot(async (root) => {
      // Larger than one 64 KiB read chunk, so the bound stops the file
      // between its chunks rather than after it ended.
      await writeAt(root, 'data/big.log', `${'x'.repeat(63)}\n`.repeat(4000));
      await writeAt(root, 'data/z.md', 'needle\n');

      const context = contextOf({
        grepBounds: bounds({ maxBytesRead: 8192 }),
      });

      const result = await run(context, {
        patterns: ['needle'],
        scopes: [`${root}/data/**`],
      });

      expect(result).toMatchObject({
        status: 'success',
        results: [],
        unfinishedFile: `${root}/data/big.log`,
      });
      expect(warningsOf(result)).toEqual([{ kind: 'byte_bound', count: 1 }]);
      expect(result).not.toHaveProperty('cursor');
    });
  });

  it('skips a file over the configured file-size bound', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'big.log', 'needle\n'.repeat(300));
      await writeAt(root, 'small.md', 'needle\n');

      const result = await run(
        contextOf({
          grepBounds: bounds({ maxFileBytes: 1024 }),
        }),
        { patterns: ['needle'], scopes: [`${root}/**`] },
      );

      expect(locatorsOf(result)).toEqual([`${root}/small.md:1-1`]);
      expect(warningsOf(result)).toEqual([{ kind: 'oversized', count: 1 }]);
    });
  });

  it('keeps the passage the file bound takes last', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'a.md', 'miss\n');
      await writeAt(root, 'b.md', 'miss\n');
      await writeAt(root, 'c.md', 'needle\n');
      await writeAt(root, 'd.md', 'needle\n');

      const result = await run(
        contextOf({ grepBounds: bounds({ maxFilesExamined: 3 }) }),
        { patterns: ['needle'], scopes: [`${root}/**`] },
      );

      // The third file is the one that matches, and the bound stops the walk
      // after it: its passage is in the result, not lost behind the stop.
      expect(locatorsOf(result)).toEqual([`${root}/c.md:1-1`]);
      expect(success(result).complete).toBe(false);
      expect(warningsOf(result)).toEqual([{ kind: 'file_bound', count: 1 }]);
    });
  });
});

/** A tree of `count` one-line matching files, in byte order. */
async function matchingTree(root: string, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      writeAt(root, `f${String(index).padStart(3, '0')}.md`, 'needle\n'),
    ),
  );
}

describe('host pages inside one call', () => {
  it('ends at the artifact bound when a page keeps nothing', async () => {
    await withRoot(async (root) => {
      // A long match fills the bound, and the next candidate is a binary file
      // whose skip warning no longer fits the engine's own reserve: the empty
      // page must end the walk at the artifact bound, not spin to the timeout.
      await writeAt(root, 'a.ts', `needle ${'x'.repeat(120)}\n`);
      await writeAt(root, 'b.bin', '\u0000\u0001');

      const result = await run(
        contextOf({
          artifacts: true,
          timeoutMs: 300,
          artifactMaxBytes: 180,
        }),
        { patterns: ['needle'], scopes: [`${root}/**`] },
      );

      expect(warningsOf(result)).toEqual([
        { kind: 'artifact_bound', count: 1 },
      ]);
      expect(success(result).complete).toBe(false);
    });
  });

  // A walk of more than the inline head resumes inside the call. Each case
  // proves a bound that trips after the head filled sees what the head left.

  it('subtracts the file bound across engine pages', async () => {
    await withRoot(async (root) => {
      stubArtifactWrites();
      await matchingTree(root, 251);

      const result = await run(
        contextOf({
          artifacts: true,
          grepBounds: bounds({ maxFilesExamined: 250 }),
        }),
        { patterns: ['needle'], scopes: [`${root}/**`] },
      );

      // The walk stops at the 250th file and never takes the 251st, so the
      // artifact holds one passage for each examined file.
      expect(artifactHeadings()).toHaveLength(250);
      expect(success(result).complete).toBe(false);
      expect(warningsOf(result)).toEqual([{ kind: 'file_bound', count: 1 }]);
    });
  });

  it('subtracts the byte bound across engine pages', async () => {
    await withRoot(async (root) => {
      stubArtifactWrites();
      // Each file reads seven bytes, so the bound is reached by the 201st
      // file and stops the walk before the one after it.
      await matchingTree(root, 251);

      const result = await run(
        contextOf({
          artifacts: true,
          grepBounds: bounds({ maxBytesRead: 200 * 7 + 7 }),
        }),
        { patterns: ['needle'], scopes: [`${root}/**`] },
      );

      expect(artifactHeadings()).toHaveLength(201);
      expect(success(result).complete).toBe(false);
      expect(warningsOf(result)).toEqual([{ kind: 'byte_bound', count: 1 }]);
    });
  });

  it('carries progress into the next engine page', async () => {
    await withRoot(async (root) => {
      stubArtifactWrites();
      await matchingTree(root, 200);
      // Larger than one read chunk, so the bound stops the file between its
      // chunks on the next page.
      await writeAt(root, 'zz-big.log', `${'x'.repeat(63)}\n`.repeat(4000));

      const result = await run(
        contextOf({
          artifacts: true,
          grepBounds: bounds({ maxBytesRead: 200 * 7 + 600 }),
        }),
        { patterns: ['needle'], scopes: [`${root}/**`] },
      );

      // The call progressed before the stop, so it names no unfinished file.
      expect(artifactHeadings()).toHaveLength(200);
      expect(success(result).unfinishedFile).toBeUndefined();
      expect(success(result).complete).toBe(false);
      expect(warningsOf(result)).toEqual([{ kind: 'byte_bound', count: 1 }]);
    });
  });
});

describe('host scope pages', () => {
  it('walks two submitted host scopes in one call in scope order', async () => {
    await withRoot(async (root) => {
      await writeAt(root, 'a/two.md', 'needle\n');
      await writeAt(root, 'b/one.md', 'needle\n');

      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/b/**`, `${root}/a/**`],
      });

      // One engine call per scope, appended in the submitted order.
      expect(locatorsOf(result)).toEqual([
        `${root}/b/one.md:1-1`,
        `${root}/a/two.md:1-1`,
      ]);
      expect(success(result).complete).toBe(true);
    });
  });

  it('walks every submitted host scope in one call', async () => {
    await withRoot(async (root) => {
      stubArtifactWrites();
      await writeAt(root, 'a/one.md', 'needle\n');
      await writeAt(root, 'b/one.md', 'needle\n');
      await writeAt(root, 'b/two.md', 'needle\n');

      const result = await run(contextOf({ artifacts: true }), {
        patterns: ['needle'],
        scopes: [`${root}/a/**`, `${root}/b/**`],
        limit: 1,
      });

      // `limit` bounds the inline part alone: the walk still visits every
      // scope and the artifact holds all three files.
      expect(locatorsOf(result)).toEqual([`${root}/a/one.md:1-1`]);
      expect(artifactHeadings()).toEqual([
        `## ${root}/a/one.md`,
        `## ${root}/b/one.md`,
        `## ${root}/b/two.md`,
      ]);
      expect(success(result).complete).toBe(true);
      expect(result).not.toHaveProperty('cursor');
    });
  });
});
