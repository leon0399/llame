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

import { isRecord, isString } from '@workspace/runtime-safety';
import { describe, expect, it, vi } from 'vitest';

import { type SkillCatalogPort } from '../skills/skill-catalog';
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

type ContextOptions = {
  /** The entered Workspace root; absent means none is entered. */
  readonly root?: string;
  /** `false` omits the first condition of the host authority gate. */
  readonly executor?: boolean;
  readonly run?: boolean;
  readonly map?: ToolPermissionMap;
};

function contextOf(options: ContextOptions = {}): ToolContext {
  const trusted = options.executor !== false;
  return {
    userId: 'owner-a',
    chatId: 'chat-a',
    toolCallId: 'call-a',
    runId: options.run === false ? undefined : 'run-a',
    nativeExecutorId: trusted ? 'host-a' : undefined,
    permissionPolicy: compileToolPermissionMap(
      options.map ?? PERMISSIVE,
      'test',
    ),
    tenantDb: {
      runAs: () =>
        Promise.reject(new Error('grep never opens a tenant transaction')),
    },
    skillCatalog: NO_CATALOG,
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

function locatorsOf(result: ToolResult): ReadonlyArray<string> {
  return resultList(result).map((passage) => {
    if (!isRecord(passage) || !isString(passage.locator)) {
      throw new Error('a passage carries a locator');
    }
    return passage.locator;
  });
}

function warningsOf(result: ToolResult): ReadonlyArray<unknown> {
  const warnings = success(result).warnings;
  return Array.isArray(warnings) ? warnings : [];
}

function cursorOf(result: ToolResult): string | undefined {
  const cursor = success(result).cursor;
  return isString(cursor) ? cursor : undefined;
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

  it('counts binary and oversized files as skips', async () => {
    await withRoot(async (root) => {
      await writeAt(
        root,
        'binary.bin',
        Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00]),
      );
      await writeAt(root, 'large.txt', Buffer.alloc(2 * 1024 * 1024, 0x61));
      await writeAt(root, 'plain.txt', 'needle\n');
      const result = await run(contextOf(), {
        patterns: ['needle'],
        scopes: [`${root}/**`],
      });
      expect(locatorsOf(result)).toEqual([`${root}/plain.txt:1-1`]);
      expect(warningsOf(result)).toEqual(
        expect.arrayContaining([
          { kind: 'binary', count: 1 },
          { kind: 'oversized', count: 1 },
        ]),
      );
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

describe('host Workspace rule', () => {
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
    expect(result).toMatchObject({ status: 'error', type: 'invalid_path' });
  });

  it('refuses a cursor issued under another Workspace', async () => {
    await withRoot(async (first) => {
      await withRoot(async (second) => {
        await writeAt(first, 'a.md', 'needle\n');
        await writeAt(first, 'b.md', 'needle\n');
        await writeAt(second, 'a.md', 'needle\n');
        const page = await run(contextOf({ root: first }), {
          patterns: ['needle'],
          limit: 1,
        });
        const cursor = cursorOf(page);
        expect(locatorsOf(page)).toEqual([`${first}/a.md:1-1`]);
        if (cursor === undefined) throw new Error('the page carries a cursor');

        expect(
          await run(contextOf({ root: first }), {
            patterns: ['needle'],
            limit: 1,
            cursor,
          }),
        ).toMatchObject({ status: 'success' });
        expect(
          await run(contextOf({ root: second }), {
            patterns: ['needle'],
            limit: 1,
            cursor,
          }),
        ).toMatchObject({ status: 'error', type: 'invalid_input' });
      });
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
