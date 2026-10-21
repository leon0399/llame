import {
  KnowledgeFilesystemAdapter,
  KNOWLEDGE_MAX_SEARCH_FILE_BYTES,
  type KnowledgeFilesystemDirectory,
  type KnowledgeFilesystemDirent,
  type KnowledgeFilesystemFile,
  type KnowledgeFilesystemPort,
  type KnowledgeFilesystemStats,
} from './knowledge-filesystem';

const SPACE_ID = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';
const ROOT = '/trusted/root';
const DIRECTORY = `${ROOT}/${SPACE_ID}`;

const directoryStats: KnowledgeFilesystemStats = {
  size: 0,
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false,
};

const fileStats = (size: number): KnowledgeFilesystemStats => ({
  size,
  isDirectory: () => false,
  isFile: () => true,
  isSymbolicLink: () => false,
});

const symlinkStats: KnowledgeFilesystemStats = {
  size: 0,
  isDirectory: () => false,
  isFile: () => true,
  isSymbolicLink: () => true,
};

const fileEntry = (name: string): KnowledgeFilesystemDirent => ({
  name,
  isDirectory: () => false,
  isFile: () => true,
  isSymbolicLink: () => false,
});

const symlinkEntry = (name: string): KnowledgeFilesystemDirent => ({
  ...fileEntry(name),
  isSymbolicLink: () => true,
});

type PortOptions = {
  readonly entries?: ReadonlyArray<KnowledgeFilesystemDirent>;
  readonly noteStats?: KnowledgeFilesystemStats;
  readonly bytes?: Buffer;
  readonly rootStats?: KnowledgeFilesystemStats;
  readonly childStats?: KnowledgeFilesystemStats;
  readonly realpath?: (filePath: string) => string;
  readonly lstatFailure?: (filePath: string) => Error | undefined;
  readonly openFailure?: Error;
  readonly opendirFailure?: Error;
};

function port(options: PortOptions = {}): KnowledgeFilesystemPort {
  const entries = [...(options.entries ?? [fileEntry('note.md')])];
  const bytes = options.bytes ?? Buffer.from('needle\n');
  const noteStats = options.noteStats ?? fileStats(bytes.length);
  const realpath = options.realpath ?? ((filePath: string) => filePath);
  return {
    lstat: vi.fn((filePath: string) => {
      const failure = options.lstatFailure?.(filePath);
      if (failure !== undefined) return Promise.reject(failure);
      if (filePath === ROOT)
        return Promise.resolve(options.rootStats ?? directoryStats);
      if (filePath === DIRECTORY) {
        return Promise.resolve(options.childStats ?? directoryStats);
      }
      return Promise.resolve(noteStats);
    }),
    opendir: vi.fn(() => {
      if (options.opendirFailure !== undefined) {
        return Promise.reject(options.opendirFailure);
      }
      let index = 0;
      const directory: KnowledgeFilesystemDirectory = {
        read: vi.fn(() => Promise.resolve(entries[index++] ?? null)),
        close: vi.fn(() => Promise.resolve()),
      };
      return Promise.resolve(directory);
    }),
    open: vi.fn(() => {
      if (options.openFailure !== undefined) {
        return Promise.reject(options.openFailure);
      }
      const file: KnowledgeFilesystemFile = {
        stat: vi.fn(() => Promise.resolve(noteStats)),
        read: vi.fn<KnowledgeFilesystemFile['read']>(
          (buffer, offset, length, position) => {
            const bytesRead = Math.min(
              length,
              Math.max(0, bytes.length - position),
            );
            bytes.copy(buffer, offset, position, position + bytesRead);
            return Promise.resolve({ bytesRead });
          },
        ),
        close: vi.fn(() => Promise.resolve()),
      };
      return Promise.resolve(file);
    }),
    realpath: vi.fn((filePath: string) => Promise.resolve(realpath(filePath))),
    mkdir: vi.fn(() => Promise.resolve()),
  };
}

function binding() {
  return { id: SPACE_ID, name: 'Personal', root: ROOT, directory: DIRECTORY };
}

describe('Knowledge filesystem adapter edge branches', () => {
  it('rejects a file whose declared size exceeds the shared search budget before opening it', async () => {
    const fileSystem = port({
      noteStats: fileStats(2),
      bytes: Buffer.from('x'),
    });
    const open = vi.spyOn(fileSystem, 'open');
    const budget = {
      remainingEntries: 100,
      remainingFiles: 10,
      remainingBytes: 1,
    };

    await expect(
      new KnowledgeFilesystemAdapter(binding(), fileSystem).search('x', 5, {
        budget,
      }),
    ).rejects.toMatchObject({ code: 'knowledge_limit_exceeded' });
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ['stat', symlinkStats, fileEntry('note.md')],
    ['dirent', fileStats(7), symlinkEntry('note.md')],
  ] as const)(
    'rejects a %s symlink during search',
    async (_label, stats, entry) => {
      const fileSystem = port({ noteStats: stats, entries: [entry] });

      await expect(
        new KnowledgeFilesystemAdapter(binding(), fileSystem).search(
          'needle',
          5,
        ),
      ).rejects.toMatchObject({ code: 'knowledge_path_invalid' });
    },
  );

  it.each([
    ['root', { rootStats: fileStats(0) }],
    ['child', { childStats: fileStats(0) }],
    [
      'root canonical path',
      { realpath: (filePath: string) => `${filePath}-other` },
    ],
    [
      'child canonical path',
      {
        realpath: (filePath: string) =>
          filePath === ROOT ? filePath : `${filePath}-other`,
      },
    ],
  ] as const)(
    'fails closed when the %s binding check fails',
    async (_label, options) => {
      await expect(
        new KnowledgeFilesystemAdapter(binding(), port(options)).search(
          'needle',
          5,
        ),
      ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });
    },
  );

  it('maps a filesystem failure to its scoped error', async () => {
    const unavailable = port({
      lstatFailure: (filePath) =>
        filePath === ROOT ? new Error('permission denied') : undefined,
    });
    await expect(
      new KnowledgeFilesystemAdapter(binding(), unavailable).search(
        'needle',
        5,
      ),
    ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });
  });

  it('translates a directory open failure and a realpath failure without leaking the cause', async () => {
    const directoryFailure = port({
      opendirFailure: Object.assign(new Error('gone'), { code: 'ENOENT' }),
    });
    await expect(
      new KnowledgeFilesystemAdapter(binding(), directoryFailure).search(
        'needle',
        5,
      ),
    ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });

    const realpathFailure = port({
      realpath: () => {
        throw new Error('permission denied');
      },
    });
    await expect(
      new KnowledgeFilesystemAdapter(binding(), realpathFailure).search(
        'needle',
        5,
      ),
    ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });
  });

  it('allows a file exactly at the search-file cap when the operation budget also fits', async () => {
    const bytes = Buffer.from('needle\n');
    const fileSystem = port({
      noteStats: fileStats(KNOWLEDGE_MAX_SEARCH_FILE_BYTES),
      bytes,
    });
    const budget = {
      remainingEntries: 100,
      remainingFiles: 1,
      remainingBytes: KNOWLEDGE_MAX_SEARCH_FILE_BYTES,
    };

    await expect(
      new KnowledgeFilesystemAdapter(binding(), fileSystem).search(
        'needle',
        5,
        {
          budget,
        },
      ),
    ).resolves.toHaveLength(1);
    expect(budget.remainingFiles).toBe(0);
  });
});

const directoryEntry = (name: string): KnowledgeFilesystemDirent => ({
  name,
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false,
});

const specialEntry = (name: string): KnowledgeFilesystemDirent => ({
  name,
  isDirectory: () => false,
  isFile: () => false,
  isSymbolicLink: () => false,
});

type WalkPortOptions = {
  readonly entries?: ReadonlyArray<KnowledgeFilesystemDirent>;
  readonly directories?: ReadonlyArray<string>;
  readonly notes?: KnowledgeFilesystemStats;
  readonly bytes?: Buffer;
  readonly openFile?: () => Promise<KnowledgeFilesystemFile>;
  readonly holdStat?: (
    filePath: string,
  ) => Promise<KnowledgeFilesystemStats> | undefined;
};

/** A port whose every listed entry is settled by the test, not the disk. */
function walkPort(options: WalkPortOptions = {}): KnowledgeFilesystemPort {
  const entries = [...(options.entries ?? [])];
  const bytes = options.bytes ?? Buffer.from('needle\n');
  const notes = options.notes ?? fileStats(bytes.length);
  const directories = new Set([
    ROOT,
    DIRECTORY,
    ...(options.directories ?? []),
  ]);
  return {
    lstat: vi.fn((filePath: string) => {
      const held = options.holdStat?.(filePath);
      if (held !== undefined) return held;
      return Promise.resolve(
        directories.has(filePath) ? directoryStats : notes,
      );
    }),
    opendir: vi.fn(() => {
      let index = 0;
      const directory: KnowledgeFilesystemDirectory = {
        read: vi.fn(() => Promise.resolve(entries[index++] ?? null)),
        close: vi.fn(() => Promise.resolve()),
      };
      return Promise.resolve(directory);
    }),
    open: vi.fn(() => {
      if (options.openFile !== undefined) return options.openFile();
      const file: KnowledgeFilesystemFile = {
        stat: vi.fn(() => Promise.resolve(notes)),
        read: vi.fn<KnowledgeFilesystemFile['read']>(
          (buffer, offset, length, position) => {
            const bytesRead = Math.min(
              length,
              Math.max(0, bytes.length - position),
            );
            bytes.copy(buffer, offset, position, position + bytesRead);
            return Promise.resolve({ bytesRead });
          },
        ),
        close: vi.fn(() => Promise.resolve()),
      };
      return Promise.resolve(file);
    }),
    realpath: vi.fn((filePath: string) => Promise.resolve(filePath)),
    mkdir: vi.fn(() => Promise.resolve()),
  };
}

describe('Knowledge filesystem walk entries', () => {
  it('classifies a link, a directory, a file, a non-file, and an unaddressable name', async () => {
    const fileSystem = walkPort({
      entries: [
        fileEntry('note.md'),
        directoryEntry('sub'),
        symlinkEntry('link.md'),
        specialEntry('fifo'),
        fileEntry('bad\u0001name.md'),
      ],
    });

    await expect(
      new KnowledgeFilesystemAdapter(binding(), fileSystem).listWalk(''),
    ).resolves.toStrictEqual([
      { name: 'note.md', kind: 'file' },
      { name: 'sub', kind: 'directory' },
      { name: 'link.md', kind: 'link' },
      { name: 'fifo', kind: 'other' },
      { name: 'bad\u0001name.md', kind: 'other' },
    ]);
  });
});

describe('Knowledge filesystem walk probes', () => {
  it('reports whether a walk path names a file or a directory', async () => {
    const adapter = new KnowledgeFilesystemAdapter(
      binding(),
      walkPort({ directories: [`${DIRECTORY}/notes`] }),
    );

    await expect(adapter.inspectWalk('notes')).resolves.toBe('directory');
    await expect(adapter.inspectWalk('note.md')).resolves.toBe('file');
  });

  it('refuses a target that a link replaced between resolution and classification', async () => {
    let stats = 0;
    const fileSystem = walkPort({ notes: fileStats(0) });
    const lstat = vi.spyOn(fileSystem, 'lstat');
    lstat.mockImplementation((filePath: string) => {
      if (filePath !== `${DIRECTORY}/notes`) {
        const isDirectory = filePath === ROOT || filePath === DIRECTORY;
        return Promise.resolve(isDirectory ? directoryStats : fileStats(0));
      }
      stats += 1;
      return Promise.resolve(stats === 1 ? directoryStats : symlinkStats);
    });

    await expect(
      new KnowledgeFilesystemAdapter(binding(), fileSystem).inspectWalk(
        'notes',
      ),
    ).rejects.toMatchObject({ code: 'knowledge_path_invalid' });
  });

  it('reads a walk file, and reports an over-bound read as oversized', async () => {
    const bytes = Buffer.from('needle\n');
    const adapter = new KnowledgeFilesystemAdapter(
      binding(),
      walkPort({ bytes }),
    );

    await expect(adapter.readWalk('note.md', bytes.length)).resolves.toEqual(
      bytes,
    );
    await expect(adapter.readWalk('note.md', 2)).resolves.toStrictEqual({
      kind: 'oversized',
    });
  });

  it('reports a file the walk cannot open as unreadable', async () => {
    const adapter = new KnowledgeFilesystemAdapter(
      binding(),
      walkPort({
        openFile: () =>
          Promise.reject(
            Object.assign(new Error('denied'), { code: 'EACCES' }),
          ),
      }),
    );

    await expect(adapter.readWalk('note.md', 64)).resolves.toStrictEqual({
      kind: 'unreadable',
    });
  });

  it('propagates a cancellation instead of counting it as a refusal', async () => {
    const controller = new AbortController();
    const adapter = new KnowledgeFilesystemAdapter(
      binding(),
      walkPort({
        notes: fileStats(6),
        openFile: () =>
          Promise.resolve({
            stat: () => Promise.resolve(fileStats(6)),
            read: () => {
              controller.abort();
              return Promise.withResolvers<{ bytesRead: number }>().promise;
            },
            close: () => Promise.resolve(),
          }),
      }),
    );

    await expect(
      adapter.readWalk('note.md', 64, controller.signal),
    ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
  });

  it('interrupts a component stat when the signal aborts mid-walk', async () => {
    const controller = new AbortController();
    const component = `${DIRECTORY}/notes`;
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<KnowledgeFilesystemStats>();
    const fileSystem = walkPort({
      holdStat: (filePath) => {
        if (filePath !== component) return undefined;
        started.resolve();
        return held.promise;
      },
    });
    const adapter = new KnowledgeFilesystemAdapter(binding(), fileSystem);
    const open = vi.spyOn(fileSystem, 'open');

    const pending = adapter.readWalk('notes/a.md', 64, controller.signal);
    await started.promise;
    controller.abort();
    // The in-flight stat settles after the abort: only the pass-through of the
    // signal into the component walk can turn this into a cancellation.
    held.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }));

    await expect(pending).rejects.toMatchObject({
      code: 'knowledge_cancelled',
    });
    expect(open).not.toHaveBeenCalled();
  });
});
