/**
 * Explicit instruction imports inside one Machine world: the target a relative
 * marker resolves to, and the directory an imported file activates. The world
 * is a Machine `InstructionScope` over a declared tree, addressed by the same
 * `machine://` locators a real probe labels entries with, so the resolution
 * under test is the production one and no SSH process is ever started.
 */

import { parseMachineLocator } from '../machines/machine-locator';
import type {
  InstructionCandidate,
  InstructionScope,
  ReadPage,
} from './instruction-files';
import {
  collectInstructionCandidate,
  type InstructionImportCollector,
  type InstructionImportState,
} from './instruction-imports';

const MACHINE = 'devl';

const locator = (path: string): string => `machine://${MACHINE}${path}`;

/** One Machine world over a declared tree of files and directories. */
function machineWorld(input: {
  readonly files: Readonly<Record<string, string>>;
  readonly directories?: ReadonlyArray<string>;
}) {
  const probed: Array<string> = [];
  const listed: Array<string> = [];
  const reads: Array<string> = [];
  const isDirectory = (path: string): boolean =>
    (input.directories ?? []).includes(path);
  /** The bare names one directory holds, as a Machine lists them. */
  const children = (path: string): Array<string> => {
    const prefix = path === '/' ? '/' : `${path}/`;
    const names = new Set<string>();
    for (const declared of [
      ...Object.keys(input.files),
      ...(input.directories ?? []),
    ]) {
      if (!declared.startsWith(prefix) || declared === path) continue;
      names.add(declared.slice(prefix.length).split('/')[0]);
    }
    return [...names];
  };
  const scope: InstructionScope = {
    root: '/',
    label: (key) => locator(key),
    probe: (key) => {
      probed.push(key);
      const body = input.files[key];
      if (body !== undefined) {
        return Promise.resolve({
          kind: 'file' as const,
          size: Buffer.byteLength(body, 'utf8'),
          canonicalPath: locator(key),
        });
      }
      return Promise.resolve(
        isDirectory(key)
          ? {
              kind: 'directory' as const,
              size: 0,
              canonicalPath: locator(key),
            }
          : { kind: 'missing' as const },
      );
    },
    list: (key) => {
      listed.push(key);
      return Promise.resolve(children(key));
    },
  };
  const page: ReadPage = (selectorPath) => {
    reads.push(selectorPath);
    const marker = selectorPath.lastIndexOf(':raw:');
    const parsed = parseMachineLocator(selectorPath.slice(0, marker));
    const body = parsed.kind === 'path' ? input.files[parsed.path] : undefined;
    return Promise.resolve(
      body === undefined
        ? { status: 'error', type: 'not_found', message: 'No such file.' }
        : { status: 'success', kind: 'file', content: body, truncated: false },
    );
  };
  return { scope, page, probed, listed, reads };
}

/** One attempt's import state over a declared Machine world. */
function stateOf(input: {
  readonly files: Readonly<Record<string, string>>;
  readonly directories?: ReadonlyArray<string>;
  readonly disclosed?: ReadonlyMap<string, ReadonlySet<string>>;
}) {
  const world = machineWorld(input);
  const collector: InstructionImportCollector = {
    keys: new Set<string>(),
    attempted: new Set<string>(),
    files: [],
    denied: [],
  };
  const state: InstructionImportState = {
    collector,
    group: {
      scope: world.scope,
      page: world.page,
      admitsRead: () => true,
      directories: new Map<string, ReadonlySet<string>>(),
      knowledge: false,
    },
    disclosed: input.disclosed ?? new Map<string, ReadonlySet<string>>(),
    abortSignal: undefined,
  };
  return { ...world, state, collector };
}

/** One Machine file as the trigger its own body is read from. */
function triggerOf(path: string): InstructionCandidate {
  return {
    path: locator(path),
    canonicalPath: locator(path),
    size: 0,
  };
}

/** The block paths and imported-by links one collector gathered, in order. */
function blocks(collector: InstructionImportCollector) {
  return collector.files.map((file) => ({
    path: file.path,
    importedBy: file.importedBy,
    knowledge: file.knowledge,
  }));
}

describe('instruction imports on a Machine', () => {
  it('resolves a relative marker in the Machine key space of its importer', async () => {
    const { state, collector, probed, reads } = stateOf({
      files: {
        '/abs/dir/file.md': 'see @./sub/rules.md\n',
        '/abs/dir/sub/rules.md': 'imported rules\n',
      },
    });

    await collectInstructionCandidate(
      state,
      triggerOf('/abs/dir/file.md'),
      new Set<string>(),
      { hop: 0 },
    );

    // The target is addressed on the Machine, relative to the directory the
    // importer itself sits in — never relative to the process's directory.
    expect(probed).toEqual(['/abs/dir/sub/rules.md']);
    expect(blocks(collector)).toEqual([
      {
        path: locator('/abs/dir/file.md'),
        importedBy: undefined,
        knowledge: false,
      },
      {
        path: locator('/abs/dir/sub/rules.md'),
        importedBy: locator('/abs/dir/file.md'),
        knowledge: false,
      },
    ]);
    expect(reads).toEqual([
      `${locator('/abs/dir/file.md')}:raw:1-2000`,
      `${locator('/abs/dir/sub/rules.md')}:raw:1-2000`,
    ]);
  });

  it('resolves a marker spelled with a trailing separator to the same path', async () => {
    const { state, collector, probed, reads } = stateOf({
      files: { '/abs/dir/file.md': 'see @./sub/\n' },
      directories: ['/abs/dir/sub'],
    });

    await collectInstructionCandidate(
      state,
      triggerOf('/abs/dir/file.md'),
      new Set<string>(),
      { hop: 0 },
    );

    // A separator at the end names the same Machine path as its absence: the
    // target is the directory '/abs/dir/sub', which is no file to read.
    expect(probed).toEqual(['/abs/dir/sub']);
    expect(blocks(collector)).toEqual([
      {
        path: locator('/abs/dir/file.md'),
        importedBy: undefined,
        knowledge: false,
      },
    ]);
    expect(reads).toEqual([`${locator('/abs/dir/file.md')}:raw:1-2000`]);
  });

  it('keeps an absolute marker in the Machine key space, normalized', async () => {
    const { state, collector, probed } = stateOf({
      files: {
        '/abs/dir/file.md': 'see @/etc/rules/../rules.md\n',
        '/etc/rules.md': 'normalized rules\n',
      },
    });

    await collectInstructionCandidate(
      state,
      triggerOf('/abs/dir/file.md'),
      new Set<string>(),
      { hop: 0 },
    );

    // An absolute target never resolves through the importer's directory: the
    // `..` segment is normalized lexically, on the Machine.
    expect(probed).toEqual(['/etc/rules.md']);
    expect(collector.files.map((file) => file.path)).toEqual([
      locator('/abs/dir/file.md'),
      locator('/etc/rules.md'),
    ]);
  });

  it('loads nothing for a marker the disclosed set of its directory covers', async () => {
    const { state, collector, probed, reads } = stateOf({
      files: {
        '/notes.md': 'see @./AGENTS.md\n',
        '/AGENTS.md': 'root rules\n',
      },
      // A read disclosed /AGENTS.md in the Machine's own root, the directory
      // an import addressed from the root activates.
      disclosed: new Map([['/', new Set<string>([locator('/AGENTS.md')])]]),
    });

    await collectInstructionCandidate(
      state,
      triggerOf('/notes.md'),
      new Set<string>(),
      { hop: 0 },
    );

    expect(probed).toEqual(['/AGENTS.md']);
    expect(blocks(collector)).toEqual([
      { path: locator('/notes.md'), importedBy: undefined, knowledge: false },
    ]);
    expect(reads).toEqual([`${locator('/notes.md')}:raw:1-2000`]);
  });

  it('walks the directory an imported file activates on its Machine', async () => {
    const { state, collector, listed } = stateOf({
      files: {
        '/notes.md': 'see @./sub/rules.md\n',
        '/sub/rules.md': 'imported rules\n',
        '/sub/AGENTS.md': 'sub rules\n',
      },
      directories: ['/sub'],
    });

    await collectInstructionCandidate(
      state,
      triggerOf('/notes.md'),
      new Set<string>(),
      { hop: 0 },
    );

    // The imported file's own directory is a fresh native trigger: its chain
    // is selected, on the Machine, from the root down to the directory the
    // import addressed, and its files are blocks of their own.
    expect(listed).toEqual(['/', '/sub']);
    expect(blocks(collector)).toEqual([
      { path: locator('/notes.md'), importedBy: undefined, knowledge: false },
      {
        path: locator('/sub/rules.md'),
        importedBy: locator('/notes.md'),
        knowledge: false,
      },
      {
        path: locator('/sub/AGENTS.md'),
        importedBy: undefined,
        knowledge: false,
      },
    ]);
  });
});
