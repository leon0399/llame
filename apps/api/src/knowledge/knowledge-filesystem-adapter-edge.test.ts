import {
  KnowledgeFilesystemAdapter,
  KNOWLEDGE_MAX_READ_BYTES,
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
const NOTE = `${DIRECTORY}/note.md`;

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

const directoryEntry = (name: string): KnowledgeFilesystemDirent => ({
  name,
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false,
});

type PortOptions = {
  readonly entries?: ReadonlyArray<KnowledgeFilesystemDirent>;
  readonly noteStats?: KnowledgeFilesystemStats;
  readonly openedFileStats?: KnowledgeFilesystemStats;
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
  const openedFileStats = options.openedFileStats ?? noteStats;
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
        stat: vi.fn(() => Promise.resolve(openedFileStats)),
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
    ['directory', { ...directoryStats }],
    ['symlink', { ...symlinkStats }],
    ['oversized', fileStats(KNOWLEDGE_MAX_READ_BYTES + 1)],
  ] as const)(
    'rejects an opened %s file during read',
    async (_label, stats) => {
      const fileSystem = port({ openedFileStats: stats });

      await expect(
        new KnowledgeFilesystemAdapter(binding(), fileSystem).read('note.md'),
      ).rejects.toMatchObject({
        code:
          stats.isSymbolicLink() || stats.isDirectory()
            ? 'knowledge_path_invalid'
            : 'knowledge_limit_exceeded',
      });
    },
  );

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

  it('rejects a file used as an intermediate read component and a directory as the final component', async () => {
    const fileSystem = port({
      entries: [fileEntry('note.md')],
      noteStats: fileStats(7),
    });
    const adapter = new KnowledgeFilesystemAdapter(binding(), fileSystem);

    await expect(adapter.read('note.md/child.md')).rejects.toMatchObject({
      code: 'knowledge_not_found',
    });

    const directoryFileSystem = port({
      entries: [directoryEntry('folder.md')],
      noteStats: directoryStats,
    });
    await expect(
      new KnowledgeFilesystemAdapter(binding(), directoryFileSystem).read(
        'folder.md',
      ),
    ).rejects.toMatchObject({
      code: 'knowledge_not_found',
    });
  });

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

  it('maps missing target entries and filesystem failures to their scoped errors', async () => {
    const missing = port({
      lstatFailure: (filePath) =>
        filePath === NOTE
          ? Object.assign(new Error('missing'), { code: 'ENOENT' })
          : undefined,
    });
    await expect(
      new KnowledgeFilesystemAdapter(binding(), missing).read('note.md'),
    ).rejects.toMatchObject({ code: 'knowledge_not_found' });

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
