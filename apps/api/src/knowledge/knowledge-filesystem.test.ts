import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  KnowledgeFilesystemAdapter,
  type KnowledgeFilesystemDirectory,
  type KnowledgeFilesystemDirent,
  type KnowledgeFilesystemFile,
  type KnowledgeFilesystemPort,
  type KnowledgeFilesystemStats,
  KNOWLEDGE_MAX_ENTRIES,
  KNOWLEDGE_MAX_FILES,
  KNOWLEDGE_MAX_READ_BYTES,
  KNOWLEDGE_MAX_PATH_BYTES,
  KNOWLEDGE_MAX_PATH_COMPONENTS,
  KNOWLEDGE_MAX_SEARCH_BYTES,
  KNOWLEDGE_MAX_SEARCH_FILE_BYTES,
} from './knowledge-filesystem';

const SPACE_ID = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'llame-knowledge-files-'));
  const directory = path.join(root, SPACE_ID);
  await mkdir(directory);
  return {
    root,
    directory,
    binding: { id: SPACE_ID, root, directory },
  };
}

async function withFixture<T>(
  callback: (value: Awaited<ReturnType<typeof fixture>>) => Promise<T>,
): Promise<T> {
  const value = await fixture();
  try {
    return await callback(value);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
}

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

const fileEntry = (name: string): KnowledgeFilesystemDirent => ({
  name,
  isDirectory: () => false,
  isFile: () => true,
  isSymbolicLink: () => false,
});

const directoryEntry = (name: string): KnowledgeFilesystemDirent => ({
  name,
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false,
});

function fakeFilesystem(
  entries: KnowledgeFilesystemDirent[],
  stats: KnowledgeFilesystemStats = fileStats(0),
  bytes = Buffer.alloc(stats.size),
  readLengths: number[] = [],
  fileClose: () => Promise<void> = () => Promise.resolve(),
): KnowledgeFilesystemPort {
  return {
    lstat: vi.fn((filePath: string) =>
      Promise.resolve(
        filePath === '/trusted/root' || filePath.endsWith(`/${SPACE_ID}`)
          ? directoryStats
          : stats,
      ),
    ),
    opendir: vi.fn(() => {
      let index = 0;
      const directory: KnowledgeFilesystemDirectory = {
        read: vi.fn(() => Promise.resolve(entries[index++] ?? null)),
        close: vi.fn(() => Promise.resolve()),
      };
      return Promise.resolve(directory);
    }),
    open: vi.fn(() => {
      const file: KnowledgeFilesystemFile = {
        stat: vi.fn(() => Promise.resolve(stats)),
        read: vi.fn(
          (
            buffer: Buffer,
            offset: number,
            length: number,
            position: number,
          ) => {
            readLengths.push(length);
            const bytesRead = Math.min(
              length,
              Math.max(0, bytes.length - position),
            );
            if (bytesRead > 0) {
              bytes.copy(buffer, offset, position, position + bytesRead);
            }
            return Promise.resolve({ bytesRead });
          },
        ),
        close: vi.fn(fileClose),
      };
      return Promise.resolve(file);
    }),
    realpath: vi.fn((filePath: string) => Promise.resolve(filePath)),
  };
}

describe('KnowledgeFilesystemAdapter', () => {
  it('searches only regular Markdown files in deterministic relative-path order', async () => {
    await withFixture(async ({ binding, directory }) => {
      await mkdir(path.join(directory, 'nested'));
      await writeFile(path.join(directory, 'z.md'), 'ignore\nNeedle here\n');
      await writeFile(path.join(directory, 'nested', 'a.MD'), 'NEEDLE first\n');
      await writeFile(path.join(directory, 'nested', 'a.txt'), 'NEEDLE\n');

      const result = await new KnowledgeFilesystemAdapter(binding).search(
        'needle',
        10,
      );

      expect(result.map((match) => match.path)).toEqual([
        'nested/a.MD',
        'z.md',
      ]);
      expect(result[0]).toMatchObject({
        path: 'nested/a.MD',
        line: 'NEEDLE first',
      });
      expect(result[0]?.snippet).toContain('NEEDLE first');
      expect(result[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    });
  });

  it('applies the result limit after deterministic relative-path ordering', async () => {
    await withFixture(async ({ binding, directory }) => {
      await mkdir(path.join(directory, 'a'));
      await writeFile(path.join(directory, 'z.md'), 'needle in root\n');
      await writeFile(path.join(directory, 'a', 'note.md'), 'needle nested\n');

      const result = await new KnowledgeFilesystemAdapter(binding).search(
        'needle',
        1,
      );

      expect(result.map((match) => match.path)).toEqual(['a/note.md']);
    });
  });

  it('returns one match per file and observes newly written bytes', async () => {
    await withFixture(async ({ binding, directory }) => {
      const file = path.join(directory, 'note.md');
      await writeFile(file, 'old text\n');
      expect(
        await new KnowledgeFilesystemAdapter(binding).search('new', 5),
      ).toEqual([]);
      await writeFile(file, 'new text\nnew again\n');

      const matches = await new KnowledgeFilesystemAdapter(binding).search(
        'NEW',
        5,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.line).toBe('new text');
      expect(matches[0]?.snippet).toContain('new again');
    });
  });

  it('keeps the matching line inside the bounded snippet after a long preceding line', async () => {
    await withFixture(async ({ binding, directory }) => {
      await writeFile(
        path.join(directory, 'note.md'),
        `${'x'.repeat(700)}\nneedle is here\n`,
      );

      const [match] = await new KnowledgeFilesystemAdapter(binding).search(
        'needle',
        5,
      );

      expect(match?.snippet).toContain('needle is here');
      expect(Array.from(match?.snippet ?? []).length).toBeLessThanOrEqual(500);
    });
  });

  it('uses code-point offsets when centering a snippet around non-BMP text', async () => {
    await withFixture(async ({ binding, directory }) => {
      await writeFile(
        path.join(directory, 'note.md'),
        `${'🧠'.repeat(400)}needle${'x'.repeat(400)}\n`,
      );

      const [match] = await new KnowledgeFilesystemAdapter(binding).search(
        'needle',
        5,
      );

      expect(match?.snippet).toContain('needle');
      expect(Array.from(match?.snippet ?? []).length).toBeLessThanOrEqual(500);
    });
  });

  it('accounts for case-fold expansion when centering the bounded snippet', async () => {
    await withFixture(async ({ binding, directory }) => {
      await writeFile(
        path.join(directory, 'note.md'),
        `${'İ'.repeat(400)}needle${'x'.repeat(400)}\n`,
      );

      const [match] = await new KnowledgeFilesystemAdapter(binding).search(
        'needle',
        5,
      );

      expect(match?.snippet).toContain('needle');
      expect(Array.from(match?.snippet ?? []).length).toBeLessThanOrEqual(500);
    });
  });

  it('reads exact current bytes and hashes those bytes', async () => {
    await withFixture(async ({ binding, directory }) => {
      const bytes = Buffer.from('café\n', 'utf8');
      await writeFile(path.join(directory, 'note.md'), bytes);

      const result = await new KnowledgeFilesystemAdapter(binding).read(
        'note.md',
      );

      expect(result).toEqual({
        path: 'note.md',
        content: 'café\n',
        contentHash:
          '7b49b9e063bd91a4f9252b413261f5557b9c570aa61516989499f64a62dbcdd6',
      });
    });
  });

  it('hashes search bytes exactly, not decoded text', async () => {
    await withFixture(async ({ binding, directory }) => {
      await writeFile(
        path.join(directory, 'note.md'),
        Buffer.from('café\n', 'utf8'),
      );

      const [match] = await new KnowledgeFilesystemAdapter(binding).search(
        'CAFÉ',
        5,
      );

      expect(match?.contentHash).toBe(
        '7b49b9e063bd91a4f9252b413261f5557b9c570aa61516989499f64a62dbcdd6',
      );
    });
  });

  it.each([
    '../escape.md',
    './note.md',
    'nested//note.md',
    '/tmp/note.md',
    'nested\\note.md',
    'nested/\u0085note.md',
    'nested/\u202E.md',
    'nested/\u2066.md',
    'nested/\u2028.md',
    'nested/\u2029.md',
    'note.txt',
    '',
  ])('rejects unsafe relative path %s', async (relativePath) => {
    await withFixture(async ({ binding }) => {
      await expect(
        new KnowledgeFilesystemAdapter(binding).read(relativePath),
      ).rejects.toMatchObject({ code: 'knowledge_path_invalid' });
    });
  });

  it('rejects control characters, excessive path depth, and excessive path bytes', async () => {
    await withFixture(async ({ binding }) => {
      const tooDeep = Array.from(
        { length: KNOWLEDGE_MAX_PATH_COMPONENTS + 1 },
        (_entry, index) => `part${index}`,
      ).join('/');
      const tooLong = `${'a'.repeat(KNOWLEDGE_MAX_PATH_BYTES)}.md`;

      await expect(
        new KnowledgeFilesystemAdapter(binding).read(`bad\u0000.md`),
      ).rejects.toMatchObject({ code: 'knowledge_path_invalid' });
      await expect(
        new KnowledgeFilesystemAdapter(binding).read(`${tooDeep}.md`),
      ).rejects.toMatchObject({ code: 'knowledge_limit_exceeded' });
      await expect(
        new KnowledgeFilesystemAdapter(binding).read(tooLong),
      ).rejects.toMatchObject({ code: 'knowledge_limit_exceeded' });
      await expect(
        new KnowledgeFilesystemAdapter(binding).read(`${'a'.repeat(1_020)}.md`),
      ).rejects.toMatchObject({ code: 'knowledge_not_found' });
    });
  });

  it('rejects a binding whose directory is not the direct stable-ID child', async () => {
    await withFixture(async ({ binding }) => {
      const mismatched = {
        ...binding,
        directory: path.join(binding.directory, 'nested'),
      };

      await expect(
        new KnowledgeFilesystemAdapter(mismatched).search('needle', 5),
      ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });
    });
  });

  it.each([
    [
      'entry bound',
      Array.from({ length: KNOWLEDGE_MAX_ENTRIES + 1 }, (_e, i) =>
        fileEntry(`f${i}.txt`),
      ),
    ],
    [
      'Markdown file bound',
      Array.from({ length: KNOWLEDGE_MAX_FILES + 1 }, (_e, i) =>
        fileEntry(`f${i}.md`),
      ),
    ],
  ])('rejects a search when the %s is exceeded', async (_label, entries) => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const adapter = new KnowledgeFilesystemAdapter(
      binding,
      fakeFilesystem(entries),
    );

    await expect(adapter.search('needle', 5)).rejects.toMatchObject({
      code: 'knowledge_limit_exceeded',
    });
  });

  it('stops reading a directory at the entry limit sentinel', async () => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    let nextEntry = 0;
    const reads = vi.fn(() => {
      nextEntry += 1;
      if (nextEntry > KNOWLEDGE_MAX_ENTRIES + 1) {
        throw new Error('directory was read past its bound');
      }
      return Promise.resolve(fileEntry(`f${nextEntry}.txt`));
    });
    const close = vi.fn(() => Promise.resolve());
    const fileSystem = fakeFilesystem([]);
    fileSystem.opendir = vi.fn(() =>
      Promise.resolve({
        read: reads,
        close,
      }),
    );

    await expect(
      new KnowledgeFilesystemAdapter(binding, fileSystem).search('needle', 5),
    ).rejects.toMatchObject({ code: 'knowledge_limit_exceeded' });
    expect(reads).toHaveBeenCalledTimes(KNOWLEDGE_MAX_ENTRIES + 1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('shares one entry budget across nested directories during read', async () => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const rootEntries = [
      directoryEntry('nested'),
      ...Array.from({ length: KNOWLEDGE_MAX_ENTRIES - 1 }, (_entry, index) =>
        fileEntry(`f${index}.txt`),
      ),
    ];
    const close = vi.fn(() => Promise.resolve());
    let openedDirectories = 0;
    let yieldedEntries = 0;
    const fileSystem = fakeFilesystem([]);
    const open = vi.fn(() =>
      Promise.reject(new Error('file open was not expected')),
    );
    fileSystem.open = open;
    fileSystem.lstat = vi.fn((filePath: string) =>
      Promise.resolve(
        filePath === '/trusted/root' ||
          filePath.endsWith(`/${SPACE_ID}`) ||
          filePath.endsWith('/nested')
          ? directoryStats
          : fileStats(0),
      ),
    );
    fileSystem.opendir = vi.fn(() => {
      const entries =
        openedDirectories++ === 0 ? rootEntries : [fileEntry('note.md')];
      let index = 0;
      return Promise.resolve({
        read: vi.fn(() => {
          const entry = entries[index++] ?? null;
          if (entry !== null) yieldedEntries += 1;
          return Promise.resolve(entry);
        }),
        close,
      });
    });

    await expect(
      new KnowledgeFilesystemAdapter(binding, fileSystem).read(
        'nested/note.md',
      ),
    ).rejects.toMatchObject({ code: 'knowledge_limit_exceeded' });
    expect(yieldedEntries).toBe(KNOWLEDGE_MAX_ENTRIES + 1);
    expect(close).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
  });

  it('closes a directory cursor when cancellation arrives during iteration', async () => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const controller = new AbortController();
    const close = vi.fn(() => Promise.resolve());
    const read = vi.fn(() => {
      controller.abort();
      return Promise.resolve(fileEntry('note.md'));
    });
    const fileSystem = fakeFilesystem([]);
    const open = vi.fn(() =>
      Promise.reject(new Error('file open was not expected')),
    );
    fileSystem.open = open;
    fileSystem.opendir = vi.fn(() => Promise.resolve({ read, close }));

    await expect(
      new KnowledgeFilesystemAdapter(binding, fileSystem).search('needle', 5, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects an individual oversized search file before reading it', async () => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const fileSystem = fakeFilesystem(
      [fileEntry('large.md')],
      fileStats(KNOWLEDGE_MAX_SEARCH_FILE_BYTES + 1),
    );

    await expect(
      new KnowledgeFilesystemAdapter(binding, fileSystem).search('needle', 5),
    ).rejects.toMatchObject({ code: 'knowledge_limit_exceeded' });
  });

  it('rejects search growth after an initially fitting file stat', async () => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const readLengths: number[] = [];
    const close = vi.fn(() => Promise.resolve());
    const fileSystem = fakeFilesystem(
      [fileEntry('large.md')],
      fileStats(0),
      Buffer.alloc(KNOWLEDGE_MAX_SEARCH_FILE_BYTES + 1),
      readLengths,
      close,
    );

    await expect(
      new KnowledgeFilesystemAdapter(binding, fileSystem).search('needle', 5),
    ).rejects.toMatchObject({ code: 'knowledge_limit_exceeded' });
    expect(readLengths.reduce((sum, length) => sum + length, 0)).toBe(
      KNOWLEDGE_MAX_SEARCH_FILE_BYTES + 1,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects aggregate search bytes without returning partial matches', async () => {
    const fileSize = KNOWLEDGE_MAX_SEARCH_FILE_BYTES;
    const entries = Array.from(
      { length: Math.floor(KNOWLEDGE_MAX_SEARCH_BYTES / fileSize) + 1 },
      (_entry, index) => fileEntry(`f${index}.md`),
    );
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const fileSystem = fakeFilesystem(entries, fileStats(fileSize));

    await expect(
      new KnowledgeFilesystemAdapter(binding, fileSystem).search('needle', 5),
    ).rejects.toMatchObject({ code: 'knowledge_limit_exceeded' });
  });

  it('rejects an oversized read before and after the byte read race', async () => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const entry = fileEntry('note.md');
    const tooLarge = Buffer.alloc(KNOWLEDGE_MAX_READ_BYTES + 1);
    const preReadFileSystem = fakeFilesystem(
      [entry],
      fileStats(KNOWLEDGE_MAX_READ_BYTES + 1),
    );

    await expect(
      new KnowledgeFilesystemAdapter(binding, preReadFileSystem).read(
        'note.md',
      ),
    ).rejects.toMatchObject({ code: 'knowledge_limit_exceeded' });

    const readLengths: number[] = [];
    const close = vi.fn(() => Promise.resolve());
    const statRace = fakeFilesystem(
      [entry],
      fileStats(0),
      tooLarge,
      readLengths,
      close,
    );
    statRace.lstat = vi
      .fn()
      .mockResolvedValueOnce(directoryStats)
      .mockResolvedValueOnce(directoryStats)
      .mockResolvedValueOnce(directoryStats)
      .mockResolvedValueOnce(fileStats(0))
      .mockResolvedValueOnce(fileStats(0));
    await expect(
      new KnowledgeFilesystemAdapter(binding, statRace).read('note.md'),
    ).rejects.toMatchObject({ code: 'knowledge_limit_exceeded' });
    expect(readLengths.reduce((sum, length) => sum + length, 0)).toBe(
      KNOWLEDGE_MAX_READ_BYTES + 1,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reads and hashes exactly the read cap with only one sentinel byte requested', async () => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const bytes = Buffer.alloc(KNOWLEDGE_MAX_READ_BYTES, 0x61);
    const readLengths: number[] = [];
    const close = vi.fn(() => Promise.resolve());
    const fileSystem = fakeFilesystem(
      [fileEntry('note.md')],
      fileStats(bytes.length),
      bytes,
      readLengths,
      close,
    );

    const result = await new KnowledgeFilesystemAdapter(
      binding,
      fileSystem,
    ).read('note.md');

    expect(Buffer.byteLength(result.content, 'utf8')).toBe(
      KNOWLEDGE_MAX_READ_BYTES,
    );
    expect(result.contentHash).toBe(
      'bf718b6f653bebc184e1479f1935b8da974d701b893afcf49e701f3e2f9f9c5a',
    );
    expect(readLengths.reduce((sum, length) => sum + length, 0)).toBe(
      KNOWLEDGE_MAX_READ_BYTES + 1,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the file handle when cancellation arrives during a chunk read', async () => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const controller = new AbortController();
    const close = vi.fn(() => Promise.resolve());
    const read = vi.fn(() => {
      controller.abort();
      return Promise.resolve({ bytesRead: 1 });
    });
    const fileSystem = fakeFilesystem([fileEntry('note.md')], fileStats(1));
    fileSystem.open = vi.fn(() =>
      Promise.resolve({
        stat: () => Promise.resolve(fileStats(1)),
        read,
        close,
      }),
    );

    await expect(
      new KnowledgeFilesystemAdapter(binding, fileSystem).read('note.md', {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('maps an O_NOFOLLOW symlink race to a safe invalid-path failure', async () => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const fileSystem = fakeFilesystem([fileEntry('note.md')], fileStats(1));
    fileSystem.open = vi.fn(() =>
      Promise.reject(Object.assign(new Error('symlink'), { code: 'ELOOP' })),
    );

    await expect(
      new KnowledgeFilesystemAdapter(binding, fileSystem).read('note.md'),
    ).rejects.toMatchObject({ code: 'knowledge_path_invalid' });
  });

  it.each(['root symlink', 'child symlink', 'root file', 'child file'])(
    'rejects a %s binding',
    async (kind) => {
      const root = await mkdtemp(
        path.join(tmpdir(), 'llame-knowledge-binding-'),
      );
      const child = path.join(root, SPACE_ID);
      const outside = await mkdtemp(
        path.join(tmpdir(), 'llame-knowledge-target-'),
      );
      try {
        await mkdir(child);
        let binding = { id: SPACE_ID, root, directory: child };
        if (kind === 'root symlink') {
          const link = `${root}-link`;
          await symlink(root, link, 'dir');
          binding = {
            id: SPACE_ID,
            root: link,
            directory: path.join(link, SPACE_ID),
          };
        } else if (kind === 'child symlink') {
          await rm(child, { recursive: true, force: true });
          await symlink(outside, child, 'dir');
        } else if (kind === 'root file') {
          await rm(root, { recursive: true, force: true });
          await writeFile(root, 'not a directory');
          binding = { id: SPACE_ID, root, directory: child };
        } else {
          await rm(child, { recursive: true, force: true });
          await writeFile(child, 'not a directory');
        }

        await expect(
          new KnowledgeFilesystemAdapter(binding).search('needle', 5),
        ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(`${root}-link`, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    },
  );

  it.each(['directory', 'entry'])(
    'fails closed when a %s disappears during search',
    async (kind) => {
      const binding = {
        id: SPACE_ID,
        root: '/trusted/root',
        directory: `/trusted/root/${SPACE_ID}`,
      };
      const fileSystem = fakeFilesystem([fileEntry('note.md')]);
      if (kind === 'directory') {
        fileSystem.opendir = vi.fn(() =>
          Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' })),
        );
      } else {
        fileSystem.lstat = vi.fn((filePath: string) =>
          filePath === '/trusted/root' || filePath.endsWith(`/${SPACE_ID}`)
            ? Promise.resolve(directoryStats)
            : filePath.endsWith(`/${SPACE_ID}/`)
              ? Promise.resolve(directoryStats)
              : Promise.reject(
                  Object.assign(new Error('gone'), { code: 'ENOENT' }),
                ),
        );
      }

      await expect(
        new KnowledgeFilesystemAdapter(binding, fileSystem).search('needle', 5),
      ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });
    },
  );

  it('rejects invalid UTF-8 found during search', async () => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const fileSystem = fakeFilesystem(
      [fileEntry('invalid.md')],
      fileStats(2),
      Buffer.from([0xc3, 0x28]),
    );

    await expect(
      new KnowledgeFilesystemAdapter(binding, fileSystem).search('needle', 5),
    ).rejects.toMatchObject({ code: 'knowledge_content_invalid' });
  });

  it('honors timeout signals while a filesystem call is pending', async () => {
    const binding = {
      id: SPACE_ID,
      root: '/trusted/root',
      directory: `/trusted/root/${SPACE_ID}`,
    };
    const fileSystem = fakeFilesystem([]);
    fileSystem.opendir = vi.fn(
      () => new Promise<KnowledgeFilesystemDirectory>(() => undefined),
    );

    await expect(
      new KnowledgeFilesystemAdapter(binding, fileSystem).search('needle', 5, {
        signal: AbortSignal.timeout(5),
      }),
    ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
  });

  it('refuses symlink components and entries without following them', async () => {
    await withFixture(async ({ binding, directory }) => {
      const outside = await mkdtemp(
        path.join(tmpdir(), 'llame-knowledge-outside-'),
      );
      await writeFile(path.join(outside, 'secret.md'), 'do not read');
      await symlink(outside, path.join(directory, 'linked'), 'dir');
      await symlink(
        path.join(outside, 'secret.md'),
        path.join(directory, 'secret.md'),
      );

      await expect(
        new KnowledgeFilesystemAdapter(binding).read('secret.md'),
      ).rejects.toMatchObject({ code: 'knowledge_path_invalid' });
      await expect(
        new KnowledgeFilesystemAdapter(binding).read('linked/secret.md'),
      ).rejects.toMatchObject({ code: 'knowledge_path_invalid' });
      await expect(
        new KnowledgeFilesystemAdapter(binding).search('secret', 5),
      ).rejects.toMatchObject({ code: 'knowledge_path_invalid' });
      await rm(outside, { recursive: true, force: true });
    });
  });

  it('rejects invalid UTF-8 and missing files without exposing host paths', async () => {
    await withFixture(async ({ binding, directory }) => {
      await writeFile(
        path.join(directory, 'invalid.md'),
        Buffer.from([0xc3, 0x28]),
      );

      await expect(
        new KnowledgeFilesystemAdapter(binding).read('invalid.md'),
      ).rejects.toMatchObject({ code: 'knowledge_content_invalid' });
      await expect(
        new KnowledgeFilesystemAdapter(binding).read('missing.md'),
      ).rejects.toMatchObject({
        code: 'knowledge_not_found',
        message: 'The Knowledge note was not found.',
      });
    });
  });

  it('honors abort signals while traversing', async () => {
    await withFixture(async ({ binding, directory }) => {
      await writeFile(path.join(directory, 'note.md'), 'needle');
      const controller = new AbortController();
      controller.abort();

      await expect(
        new KnowledgeFilesystemAdapter(binding).search('needle', 5, {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
    });
  });

  it('does not require Git metadata', async () => {
    await withFixture(async ({ binding, directory }) => {
      await writeFile(path.join(directory, 'note.md'), 'needle');
      await expect(
        readFile(path.join(directory, 'note.md'), 'utf8'),
      ).resolves.toBe('needle');
      await expect(
        new KnowledgeFilesystemAdapter(binding).search('needle', 5),
      ).resolves.toHaveLength(1);
      await expect(unlink(path.join(directory, '.git'))).rejects.toBeDefined();
    });
  });
});
