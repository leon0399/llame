import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MachineConnector } from '../machines/machine-connector.service';
import { MachineIdentityMismatchError } from '../machines/machine-session';
import { snapshotMachineSkillSources } from '../skills/machine-skill-sources';
import {
  SkillCatalog,
  type SkillCatalogEntry,
  type SkillCatalogPort,
} from '../skills/skill-catalog';
import { createProtocolPeer } from '../testing/machine-protocol-peer';
import { type GrepReadAdmission } from './grep-admission';
import { machineUnsupportedResult } from './grep-results';
import { resolveScopes, refuseUnsearchableGrepScopes } from './grep-scopes';
import { type ScopeOutcome } from './grep-scope-shape';
import { type ToolContext } from './types';
import { createWorkspaceRootCell } from './workspace-path';

const admission: GrepReadAdmission = {
  admit: () => true,
  allows: () => true,
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
    configuredCredentials: [],
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

/**
 * A local Machine whose daemon answers the exact-path probe as a directory.
 * Every path scope lands on it, so host resolution never walks in process.
 */
function localConnector(): MachineConnector {
  const peer = createProtocolPeer({
    answers: { 'fs.stat': { value: { kind: 'directory', isLink: false } } },
  });

  return new MachineConnector({
    machines: { local: 'host-a', default: 'host-a', hosts: { 'host-a': {} } },
    hubVersion: 'test',
    bindIdentity: () => Promise.resolve('match'),
    transportFactory: peer.factory,
    handshakeTimeoutMs: 1000,
  });
}

/** A context holding the native host authority a Run on this host has. */
function hostContext(options: { readonly root?: string } = {}): ToolContext {
  return {
    ...contextOf(options),
    runId: 'run-a',
    localMachine: 'host-a',
    defaultMachine: 'host-a',
    machines: localConnector(),
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

  if ('machine' in outcome) {
    throw new Error('expected scopes, received one Machine scope');
  }

  return outcome;
}

describe('resolveScopes', () => {
  it('resolves one package directory scope with its prefix', async () => {
    await withPackage(async (root, directory) => {
      const outcome = scopesOf(
        await resolveScopes(
          contextOf({ catalog: catalogOf([packageEntry('pdf', directory)]) }),
          ['skill://pdf'],
          admission,
        ),
      );

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

  it('refuses a host scope with no current Machine', async () => {
    const context = contextOf({ root: '/home/u/repo' });

    const refusal = {
      result: {
        status: 'error',
        type: 'invalid_path',
        message:
          'No current Machine: configure machines.default or enter a Workspace.',
      },
    };

    expect(
      await resolveScopes(context, ['file://localhost/etc/x'], admission),
    ).toEqual(refusal);
    expect(
      await resolveScopes(context, ['file://nas/share'], admission),
    ).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message:
          'A file:// URL with a host other than localhost names another Machine. ' +
          'Use machine://<name>/<path> to reach a configured Machine.',
      },
    });
    expect(
      await resolveScopes(context, ['/home/u/repo/src/**'], admission),
    ).toEqual(refusal);
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

  it('keeps the filesystem root as the prefix of a Machine scope', async () => {
    const outcome = await resolveScopes(hostContext(), ['/**'], admission);

    // The root is the prefix itself, not an empty path that names nothing.
    expect(outcome).toMatchObject({
      machines: [{ index: 0, name: 'host-a', path: '/', globSuffix: '**' }],
    });
  });

  it('refuses a host scope path that holds a NUL byte', async () => {
    expect(
      await resolveScopes(hostContext(), ['/tmp/a\u0000b'], admission),
    ).toEqual({
      result: {
        status: 'error',
        type: 'invalid_path',
        message: 'A Machine path must be absolute and contain no NUL bytes.',
      },
    });
  });

  it("leaves a scope on this process's own Machine to its daemon", async () => {
    const peer = createProtocolPeer({
      answers: { 'fs.stat': { value: { kind: 'directory', isLink: false } } },
    });

    const connector = new MachineConnector({
      machines: {
        local: 'host-a',
        default: 'host-a',
        hosts: { 'host-a': {} },
      },
      hubVersion: 'test',
      bindIdentity: () => Promise.resolve('match'),
      transportFactory: peer.factory,
      handshakeTimeoutMs: 1000,
    });

    expect(
      await resolveScopes(
        { ...hostContext(), machines: connector },
        ['machine://host-a/etc'],
        admission,
      ),
    ).toMatchObject({ machines: [{ name: 'host-a', path: '/etc' }] });
    // The exact path was probed on the daemon; this process walked nothing.
    expect((await peer.session(0)).requests).toEqual(['fs.stat']);
  });

  it('leaves a scope on another Machine to its daemon', async () => {
    const peer = createProtocolPeer({
      answers: { 'fs.stat': { value: { kind: 'directory', isLink: false } } },
    });

    const connector = new MachineConnector({
      machines: {
        local: 'host-a',
        default: 'host-a',
        hosts: { gpu: { destination: 'gpu-box' } },
      },
      hubVersion: 'test',
      bindIdentity: () => Promise.resolve('match'),
      transportFactory: peer.factory,
      handshakeTimeoutMs: 1000,
    });

    const context = { ...hostContext(), machines: connector };

    expect(
      await resolveScopes(context, ['machine://gpu/srv'], admission),
    ).toMatchObject({ machines: [{ name: 'gpu', path: '/srv' }] });
    // The other scope's exact path went to its daemon; nothing else did.
    expect((await peer.session(0)).requests).toEqual(['fs.stat']);
  });

  it('spells a decoded glob character in a remote host scope', async () => {
    const peer = createProtocolPeer({
      answers: { 'fs.stat': { value: { kind: 'directory', isLink: false } } },
    });

    const connector = new MachineConnector({
      machines: {
        default: 'gpu',
        hosts: { gpu: { destination: 'gpu-box' } },
      },
      hubVersion: 'test',
      bindIdentity: () => Promise.resolve('match'),
      transportFactory: peer.factory,
      handshakeTimeoutMs: 1000,
    });

    const context = {
      ...contextOf(),
      runId: 'run-a',
      defaultMachine: 'gpu',
      machines: connector,
    };

    // The literal spelling decodes to `[`, which the Machine scope grammar
    // carries as `%5B` so its own parser does not read a glob operator.
    expect(
      await resolveScopes(context, ['/srv/a%5Bb%5D'], admission),
    ).toMatchObject({ machines: [{ name: 'gpu', path: '/srv/a[b]' }] });
  });

  it('refuses a package directory that is not an absolute host path', async () => {
    const outcome = await resolveScopes(
      contextOf({ catalog: catalogOf([packageEntry('pdf', 'relative/pdf')]) }),
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

  it('leaves a package that lives on another Machine to its daemon', async () => {
    const peer = createProtocolPeer({
      answers: { 'fs.stat': { value: { kind: 'directory', isLink: false } } },
    });

    const connector = new MachineConnector({
      machines: {
        default: 'dev',
        hosts: { dev: { destination: 'dev-box' } },
      },
      hubVersion: 'test',
      bindIdentity: () => Promise.resolve('match'),
      transportFactory: peer.factory,
      handshakeTimeoutMs: 1000,
    });

    const outcome = await resolveScopes(
      {
        ...contextOf({
          catalog: catalogOf([packageEntry('pdf', 'machine://dev/x/pdf')]),
        }),
        runId: 'run-a',
        defaultMachine: 'dev',
        machines: connector,
      },
      ['skill://pdf'],
      admission,
    );

    expect(outcome).toMatchObject({
      machines: [{ index: 0, name: 'dev', path: '/x/pdf' }],
    });
    // The package's exact path went to its own daemon.
    expect((await peer.session(0)).requests).toEqual(['fs.stat']);
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

      expect(outcome.scopes.map((scope) => scope.locatorPrefix)).toEqual([
        'skill://alpha/',
        'skill://pdf/',
      ]);
      // Each expanded package is its own scope, ordered for the walk.
      expect(outcome.scopes.map((scope) => scope.index)).toEqual([0, 1]);
    });
  });

  it('keeps package order when an expansion mixes host and Machine packages', async () => {
    await withPackage(async (_root, directory) => {
      const catalog = catalogOf([
        packageEntry('zeta', directory),
        packageEntry('alpha', 'machine://host-a/srv/alpha'),
      ]);

      const outcome = await resolveScopes(
        { ...hostContext(), skillCatalog: catalog },
        ['skill://'],
        admission,
      );

      // `alpha` is a Machine package, `zeta` a host one, and the walk keeps
      // the byte order of their names across the two backends.
      expect(outcome).toMatchObject({
        machines: [{ index: 0, name: 'host-a', path: '/srv/alpha' }],
        scopes: [{ index: 1, locatorPrefix: 'skill://zeta/' }],
      });
    });
  });

  it('searches no Workspace skill when the local daemon answers another identity', async () => {
    const root = 'machine://host-a/home/me/shop';
    const packageDirectory = '/home/me/shop/.agents/skills/ws-only';

    const catalog = catalogOf([
      packageEntry('ws-only', `machine://host-a${packageDirectory}`),
    ]);

    const peer = createProtocolPeer({
      answers: { 'fs.stat': { value: { kind: 'directory', isLink: false } } },
    });

    const connector = new MachineConnector({
      machines: { local: 'host-a', default: 'host-a', hosts: { 'host-a': {} } },
      hubVersion: 'test',
      bindIdentity: () => Promise.resolve('match'),
      transportFactory: peer.factory,
      handshakeTimeoutMs: 1000,
    });

    const verified = await resolveScopes(
      { ...hostContext({ root }), skillCatalog: catalog, machines: connector },
      ['skill://ws-only/SKILL.md'],
      admission,
    );

    // The package's own Machine walks it; this process walks nothing.
    expect(verified).toMatchObject({
      machines: [
        { index: 0, name: 'host-a', path: `${packageDirectory}/SKILL.md` },
      ],
    });
    expect((await peer.session(0)).requests).toEqual(['fs.stat']);

    // A daemon answering another identity contributes no Workspace skill to
    // the attempt's catalog, so the package is not found.
    const refused = await snapshotMachineSkillSources({
      root,
      request: () => Promise.reject(new MachineIdentityMismatchError('host-a')),
    });

    await expect(
      resolveScopes(
        {
          ...hostContext({ root }),
          skillCatalog: new SkillCatalog([], refused?.fileSystem),
        },
        ['skill://ws-only/SKILL.md'],
        admission,
      ),
    ).resolves.toEqual({
      result: {
        status: 'error',
        type: 'not_found',
        message: 'File not found.',
      },
    });
  });

  it('expands a bare skill scope to nothing without a catalog', async () => {
    expect(await resolveScopes(contextOf(), ['skill://'], admission)).toEqual({
      scopes: [],
      machines: [],
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
    expect(refused(['machine://'])).toMatchObject({
      status: 'error',
      type: 'invalid_path',
    });
    // A well-formed Machine scope is searchable on this layer.
    expect(refused(['machine://build/srv/app/**'])).toBeUndefined();
    expect(refused(['file://nas/share'])).toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'A file:// URL with a host other than localhost names another Machine. ' +
        'Use machine://<name>/<path> to reach a configured Machine.',
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

  it('refuses an unsupported glob operator in a host scope or file: alias', () => {
    expect(refused(['/repo/{a,b}'])).toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'The glob operator `{` is not supported; write `*`, `**`, and `?` instead.',
    });
    expect(refused(['file://localhost/repo/[ab]'])).toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'The glob operator `[` is not supported; write `*`, `**`, and `?` instead.',
    });
  });

  it('passes a searchable shape, including a placed host scope', () => {
    expect(refused([`kb://${SPACE}/notes/**`])).toBeUndefined();
    expect(refused(['skill://pdf'])).toBeUndefined();
    expect(refused(['src/**'], '/home/u/repo')).toBeUndefined();
    expect(refused(['file://localhost/repo/src/**'])).toBeUndefined();
  });
});
