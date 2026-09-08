import {
  closeDirectoryAndTranslateFailure,
  closeFileAndTranslateFailure,
  readAllDirectoryEntries,
  readWholeFileBytes,
} from './knowledge-filesystem-read';
import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';
import type {
  KnowledgeFilesystemDirectory,
  KnowledgeFilesystemFile,
  KnowledgeFilesystemStats,
} from './knowledge-filesystem';

function fileWith(
  stats: KnowledgeFilesystemStats,
  read: KnowledgeFilesystemFile['read'],
  close: KnowledgeFilesystemFile['close'] = vi.fn(() => Promise.resolve()),
): KnowledgeFilesystemFile {
  return {
    stat: vi.fn(() => Promise.resolve(stats)),
    read,
    close,
  };
}

const fileStats = (size: number): KnowledgeFilesystemStats => ({
  size,
  isDirectory: () => false,
  isFile: () => true,
  isSymbolicLink: () => false,
});

describe('Knowledge filesystem whole-file reading', () => {
  it('rejects an impossible whole-file byte count and an over-cap read', async () => {
    const invalidCount = fileWith(fileStats(1), () =>
      Promise.resolve({ bytesRead: 3 }),
    );
    await expect(
      readWholeFileBytes(invalidCount, 1, undefined),
    ).rejects.toMatchObject({
      code: 'knowledge_space_unavailable',
    });

    const overflow = fileWith(fileStats(2), (buffer) =>
      Promise.resolve({
        bytesRead: buffer.length,
      }),
    );
    await expect(
      readWholeFileBytes(overflow, 1, undefined),
    ).rejects.toMatchObject({
      code: 'knowledge_limit_exceeded',
    });
  });

  it('reads a whole file through the sentinel byte at an exact cap', async () => {
    const chunks = [Buffer.from('ab'), Buffer.from('c'), Buffer.alloc(0)];
    const reads: Array<{ length: number; position: number }> = [];
    const file = fileWith(fileStats(0), (buffer, _offset, length, position) => {
      reads.push({ length, position });
      const chunk = chunks.shift()!;
      chunk.copy(buffer);
      return Promise.resolve({ bytesRead: chunk.length });
    });

    await expect(readWholeFileBytes(file, 3, undefined)).resolves.toEqual(
      Buffer.from('abc'),
    );
    expect(reads).toEqual([
      { length: 4, position: 0 },
      { length: 2, position: 2 },
      { length: 1, position: 3 },
    ]);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 65_537])(
    'rejects an impossible whole-file byte count %s',
    async (bytesRead) => {
      const file = fileWith(fileStats(0), () => Promise.resolve({ bytesRead }));
      await expect(
        readWholeFileBytes(file, 65_536, undefined),
      ).rejects.toMatchObject({
        code: 'knowledge_space_unavailable',
      });
    },
  );
});

describe('Knowledge filesystem cleanup translation', () => {
  it('leaves a successful cleanup with no file or error alone', async () => {
    await expect(
      closeFileAndTranslateFailure(undefined, undefined, undefined),
    ).resolves.toBeUndefined();
    await expect(
      closeDirectoryAndTranslateFailure(undefined, undefined, undefined),
    ).resolves.toBeUndefined();
  });

  it('preserves typed failures when closing a file or directory', async () => {
    const typed = new KnowledgeFilesystemError('knowledge_path_invalid');
    const file = fileWith(
      fileStats(0),
      () => Promise.resolve({ bytesRead: 0 }),
      vi.fn(() => Promise.reject(new Error('close failed'))),
    );
    await expect(
      closeFileAndTranslateFailure(file, typed, undefined),
    ).rejects.toBe(typed);

    const directory: KnowledgeFilesystemDirectory = {
      read: vi.fn(() => Promise.resolve(null)),
      close: vi.fn(() => Promise.reject(new Error('close failed'))),
    };
    await expect(
      closeDirectoryAndTranslateFailure(directory, typed, undefined),
    ).rejects.toBe(typed);
  });

  it('enumerates directory entries up to the exact remaining budget', async () => {
    const first = {
      name: 'a.md',
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const second = {
      name: 'b.md',
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const entries = [first, second, null];
    const directory: KnowledgeFilesystemDirectory = {
      read: vi.fn(() => Promise.resolve(entries.shift() ?? null)),
      close: vi.fn(() => Promise.resolve()),
    };
    await expect(
      readAllDirectoryEntries(directory, 2, undefined),
    ).resolves.toEqual([first, second]);
  });

  it.each([
    ['ENOENT', 'knowledge_not_found'],
    ['ELOOP', 'knowledge_path_invalid'],
    ['EACCES', 'knowledge_space_unavailable'],
  ] as const)('maps file errno %s to %s', async (code, expected) => {
    const file = fileWith(fileStats(0), () =>
      Promise.resolve({ bytesRead: 0 }),
    );
    await expect(
      closeFileAndTranslateFailure(
        file,
        Object.assign(new Error('failure'), { code }),
        undefined,
      ),
    ).rejects.toMatchObject({ code: expected });
  });

  it('uses a close failure when the original file error is absent', async () => {
    const file = fileWith(
      fileStats(0),
      () => Promise.resolve({ bytesRead: 0 }),
      vi.fn(() => Promise.reject(new Error('close failed'))),
    );
    await expect(
      closeFileAndTranslateFailure(file, undefined, undefined),
    ).rejects.toMatchObject({
      code: 'knowledge_space_unavailable',
    });
  });

  it('uses a close failure when the original directory error is absent', async () => {
    const directory: KnowledgeFilesystemDirectory = {
      read: vi.fn(() => Promise.resolve(null)),
      close: vi.fn(() => Promise.reject(new Error('close failed'))),
    };
    await expect(
      closeDirectoryAndTranslateFailure(directory, undefined, undefined),
    ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });
  });

  it('maps a directory failure to the closed unavailable error', async () => {
    const directory: KnowledgeFilesystemDirectory = {
      read: vi.fn(() => Promise.resolve(null)),
      close: vi.fn(() => Promise.resolve()),
    };
    await expect(
      closeDirectoryAndTranslateFailure(
        directory,
        Object.assign(new Error('directory vanished'), { code: 'ENOENT' }),
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });
    await expect(
      closeDirectoryAndTranslateFailure(
        directory,
        new Error('unknown'),
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });
  });
});
