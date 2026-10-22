import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type SkillCatalogEntry,
  type SkillCatalogPort,
} from '../skills/skill-catalog';
import { type GrepReadAdmission } from './grep-admission';
import {
  executorUnavailableResult,
  machineUnsupportedResult,
} from './grep-results';
import { resolveScopes, refuseUnsearchableGrepScopes } from './grep-scopes';
import { type ScopeOutcome } from './grep-scope-shape';
import { type ToolContext } from './types';
import { createWorkspaceRootCell } from './workspace-path';

const admission: GrepReadAdmission = {
  admit: () => true,
  refused: 0,
  recordRefusals() {},
};

function catalogOf(
  entries: ReadonlyArray<SkillCatalogEntry>,
  available = true,
): SkillCatalogPort {
  return {
    getSnapshot: () => ({
      available,
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

function contextOf(
  options: {
    readonly catalog?: SkillCatalogPort;
    readonly selection?: ReadonlySet<string>;
    readonly root?: string;
  } = {},
): ToolContext {
  return {
    userId: 'owner-a',
    chatId: 'chat-a',
    tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
    skillCatalog: options.catalog,
    skillSelection: options.selection,
    workspaceRoot:
      options.root === undefined
        ? undefined
        : createWorkspaceRootCell(options.root),
  };
}

async function withPackage<T>(
  callback: (root: string, directory: string) => Promise<T>,
): Promise<T> {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), 'grep-scopes-')),
  );
  try {
    const directory = path.join(root, 'pdf');
    await mkdir(path.join(directory, 'notes'), { recursive: true });
    await writeFile(path.join(directory, 'SKILL.md'), 'needle\n');
    await writeFile(path.join(directory, 'notes', 'a.md'), 'needle\n');
    return await callback(root, directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function scopesOf(outcome: ScopeOutcome) {
  if ('result' in outcome) {
    throw new Error(`expected scopes, received ${outcome.result.type}`);
  }
  return outcome;
}

describe('resolveScopes', () => {
  it('resolves one package directory scope with its prefix and root', async () => {
    await withPackage(async (root, directory) => {
      const outcome = scopesOf(
        await resolveScopes(
          contextOf({ catalog: catalogOf([packageEntry('pdf', directory)]) }),
          ['skill://pdf'],
          admission,
        ),
      );

      expect(outcome.roots).toEqual(['pdf']);
      expect(outcome.scopes).toHaveLength(1);
      expect(outcome.scopes[0]).toMatchObject({
        index: 0,
        locatorPrefix: 'skill://pdf/',
        singleFile: false,
      });
      expect(outcome.scopes[0]?.locatorFor('SKILL.md')).toBe(
        'skill://pdf/SKILL.md',
      );
      expect(root.length).toBeGreaterThan(0);
    });
  });

  it('resolves a package subpath to the file it names', async () => {
    await withPackage(async (_root, directory) => {
      const outcome = scopesOf(
        await resolveScopes(
          contextOf({ catalog: catalogOf([packageEntry('pdf', directory)]) }),
          ['skill://pdf/SKILL.md'],
          admission,
        ),
      );

      expect(outcome.roots).toEqual(['pdf']);
      expect(outcome.scopes[0]).toMatchObject({
        locatorPrefix: 'skill://pdf/SKILL.md',
        singleFile: true,
      });
    });
  });

  it('resolves a package subdirectory scope by its decoded segments', async () => {
    await withPackage(async (_root, directory) => {
      const outcome = scopesOf(
        await resolveScopes(
          contextOf({ catalog: catalogOf([packageEntry('pdf', directory)]) }),
          ['skill://pdf/notes/'],
          admission,
        ),
      );

      expect(outcome.scopes[0]).toMatchObject({
        locatorPrefix: 'skill://pdf/notes/',
        singleFile: false,
      });
    });
  });

  it('refuses a package path component its locator grammar rejects', async () => {
    await withPackage(async (_root, directory) => {
      const outcome = await resolveScopes(
        contextOf({ catalog: catalogOf([packageEntry('pdf', directory)]) }),
        ['skill://pdf/../x'],
        admission,
      );

      expect(outcome).toEqual({
        result: {
          status: 'error',
          type: 'invalid_path',
          message: 'The scope path is invalid.',
        },
      });
    });
  });

  it('refuses a scope on its own scheme vocabulary', async () => {
    const context = contextOf({ catalog: catalogOf([]) });

    expect(
      await resolveScopes(context, ['machine://dev/x'], admission),
    ).toEqual({
      result: machineUnsupportedResult(),
    });
    expect(
      await resolveScopes(context, ['media://voice/a'], admission),
    ).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message: 'A media:// locator holds no text to search.',
      },
    });
    expect(
      await resolveScopes(context, ['https://example.test/docs'], admission),
    ).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message:
          'A web locator is fetched, not searched; read one page instead.',
      },
    });
    expect(
      await resolveScopes(context, ['http://example.test'], admission),
    ).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message:
          'A web locator is fetched, not searched; read one page instead.',
      },
    });
    expect(
      await resolveScopes(context, ['ftp://host/path'], admission),
    ).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message: 'This path scheme cannot be searched.',
      },
    });
  });

  it('places a file: alias on the host layer that owns it', async () => {
    const context = contextOf({ root: '/home/u/repo' });
    expect(
      await resolveScopes(context, ['file://localhost/etc/x'], admission),
    ).toEqual({ result: executorUnavailableResult() });
    expect(
      await resolveScopes(context, ['file://nas/share'], admission),
    ).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message:
          'A file:// URL with a host other than localhost names another machine. ' +
          "Only this host's files are readable; write the absolute path instead.",
      },
    });
    expect(
      await resolveScopes(context, ['/home/u/repo/src/**'], admission),
    ).toEqual({ result: executorUnavailableResult() });
  });

  it('refuses a skill scope with a selector, a glob, or an invalid name', async () => {
    const context = contextOf({ catalog: catalogOf([]) });

    expect(await resolveScopes(context, ['skill://pdf:3'], admission)).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message:
          'Write a literal colon in a skill:// scope as %3A; grep parses no selector.',
      },
    });
    expect(
      await resolveScopes(context, ['skill://pdf/SKILL.md:3'], admission),
    ).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message:
          'Write a literal colon in a skill:// scope as %3A; grep parses no selector.',
      },
    });
    expect(await resolveScopes(context, ['skill://pd*'], admission)).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message: 'A skill name cannot hold a glob.',
      },
    });
    expect(await resolveScopes(context, ['skill://PDF_x'], admission)).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message: 'The skill locator is invalid.',
      },
    });
    // The empty package name fails the name grammar before the glob rule is
    // ever consulted: the glob check reads the name, not the whole scope.
    expect(await resolveScopes(context, ['skill:///pd*'], admission)).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message: 'The skill locator is invalid.',
      },
    });
  });

  it('names a package the catalog does not hold', async () => {
    const outcome = await resolveScopes(
      contextOf({ catalog: catalogOf([]) }),
      ['skill://absent'],
      admission,
    );
    expect(outcome).toMatchObject({
      result: { status: 'error', type: 'not_found' },
    });
  });

  it('refuses a package that lives on another host', async () => {
    const outcome = await resolveScopes(
      contextOf({
        catalog: catalogOf([packageEntry('pdf', 'machine://dev/x/pdf')]),
      }),
      ['skill://pdf'],
      admission,
    );
    expect(outcome).toEqual({
      result: {
        status: 'error',
        type: 'skill_unavailable',
        message: 'The skill package is unavailable.',
      },
    });
  });

  it.each([
    ['unselected', undefined, true],
    ['selected', new Set(['manual']), false],
  ])(
    'treats a manual-only package as %s',
    async (_label, selection, refused) => {
      await withPackage(async (_root, directory) => {
        const outcome = await resolveScopes(
          contextOf({
            catalog: catalogOf([packageEntry('manual', directory, false)]),
            selection,
          }),
          ['skill://manual'],
          admission,
        );

        if (refused) {
          expect(outcome).toEqual({
            result: {
              status: 'error',
              type: 'skill_requires_explicit_selection',
              message:
                'The skill `manual` is manual-only. It loads only when the user names it explicitly in the current turn, for example by writing `$manual`.',
            },
          });
          return;
        }
        expect(scopesOf(outcome).roots).toEqual(['manual']);
      });
    },
  );

  it('expands a bare skill scope over the packages the selection reaches, in byte order', async () => {
    await withPackage(async (root, directory) => {
      const other = path.join(root, 'alpha');
      await mkdir(other, { recursive: true });
      await writeFile(path.join(other, 'SKILL.md'), 'needle\n');
      const catalog = catalogOf([
        packageEntry('pdf', directory),
        packageEntry('alpha', other),
        packageEntry('manual', directory, false),
      ]);

      const outcome = scopesOf(
        await resolveScopes(contextOf({ catalog }), ['skill://'], admission),
      );

      expect(outcome.roots).toEqual(['alpha', 'pdf']);
      expect(outcome.scopes.map((scope) => scope.locatorPrefix)).toEqual([
        'skill://alpha/',
        'skill://pdf/',
      ]);
      // Each expanded package is its own scope for the cursor to name.
      expect(outcome.scopes.map((scope) => scope.index)).toEqual([0, 1]);
    });
  });

  it('expands a bare skill scope to nothing without a catalog', async () => {
    expect(await resolveScopes(contextOf(), ['skill://'], admission)).toEqual({
      scopes: [],
      roots: [],
    });
  });

  it('fails a bare skill scope when the catalog reports itself unavailable', async () => {
    const outcome = await resolveScopes(
      contextOf({ catalog: catalogOf([], false) }),
      ['skill://'],
      admission,
    );
    expect(outcome).toMatchObject({
      result: { type: 'skill_catalog_unavailable' },
    });
  });
});

describe('refuseUnsearchableGrepScopes', () => {
  const SPACE = '11111111-1111-4111-8111-111111111111';

  /** The refusal of one submitted scope set, or `undefined` for a usable one. */
  function refused(
    scopes: ReadonlyArray<string>,
    root?: string,
  ): ReturnType<typeof refuseUnsearchableGrepScopes> {
    return refuseUnsearchableGrepScopes(
      { scopes },
      root === undefined ? contextOf() : contextOf({ root }),
    );
  }

  it('refuses a scheme this process cannot search', () => {
    expect(refused(['https://example.test/docs'])).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'A web locator is fetched, not searched; read one page instead.',
    });
    expect(refused(['media://voice/a'])).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'A media:// locator holds no text to search.',
    });
    expect(refused(['ftp://host/path'])).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme cannot be searched.',
    });
  });

  it('refuses a bare Machine scope and a remote file: alias', () => {
    expect(refused(['machine://'])).toEqual(machineUnsupportedResult());
    expect(refused(['file://nas/share'])).toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'A file:// URL with a host other than localhost names another machine. ' +
        "Only this host's files are readable; write the absolute path instead.",
    });
  });

  it('refuses an unsupported glob operator and a selector colon', () => {
    expect(refused([`kb://${SPACE}/notes/{a,b}`])).toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'The glob operator `{` is not supported; write `*`, `**`, and `?` instead.',
    });
    expect(refused([`kb://${SPACE}/notes/a.md:3-5`])).toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'Write a literal colon in a kb:// scope as %3A; grep parses no selector.',
    });
    expect(refused(['skill://pdf/SKILL.md:3'])).toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'Write a literal colon in a skill:// scope as %3A; grep parses no selector.',
    });
  });

  it('passes a searchable shape, including a placed host scope', () => {
    expect(refused([`kb://${SPACE}/notes/**`])).toBeUndefined();
    expect(refused(['skill://pdf'])).toBeUndefined();
    expect(refused(['src/**'], '/home/u/repo')).toBeUndefined();
  });
});
