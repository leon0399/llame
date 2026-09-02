import {
  closeDirectoryAndTranslateFailure,
  closeFileAndTranslateFailure,
  readKnowledgeFileLines,
  readWholeFileBytes,
  resolveLineSelectionBudget,
  resolveLineSelectionResult,
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

describe('Knowledge filesystem line-reading helpers', () => {
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

  it('rejects an impossible line-read byte count', async () => {
    const budget = resolveLineSelectionBudget({
      filePath: '/trusted/note.md',
      relativePath: 'note.md',
      offset: 0,
      requestedLimit: undefined,
      maxResultCodeUnits: 1000,
      fixedResultCodeUnits: 10,
    });
    const file = fileWith(fileStats(1), () =>
      Promise.resolve({ bytesRead: 2 }),
    );

    await expect(
      readKnowledgeFileLines(file, fileStats(1), budget, undefined),
    ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });
  });

  it('continues reading when a known file grows after its initial stat', async () => {
    let reads = 0;
    const file = fileWith(fileStats(1), (buffer) => {
      if (reads++ === 0) {
        buffer[0] = 97;
        return Promise.resolve({ bytesRead: 1 });
      }
      if (reads === 2) {
        buffer[0] = 10;
        return Promise.resolve({ bytesRead: 1 });
      }
      return Promise.resolve({ bytesRead: 0 });
    });
    const budget = resolveLineSelectionBudget({
      filePath: '/trusted/note.md',
      relativePath: 'note.md',
      offset: 0,
      requestedLimit: 1,
      maxResultCodeUnits: 1000,
      fixedResultCodeUnits: 10,
    });

    await expect(
      readKnowledgeFileLines(file, fileStats(1), budget, undefined),
    ).resolves.toMatchObject({ lineIndex: 1, selectedLines: ['1: a\n'] });
    expect(reads).toBe(3);
  });

  it('rejects an empty result that cannot fit its fixed envelope', () => {
    expect(() =>
      resolveLineSelectionResult(
        {
          lineIndex: 0,
          selectedLines: [],
          fragments: [],
          serializedContentCodeUnits: 0,
          selectionStorageFull: false,
        },
        {
          offset: 0,
          requestedLimit: undefined,
          maxLines: 2000,
          maxResultCodeUnits: 1,
          fixedResultCodeUnits: 100,
        },
        'note.md',
      ),
    ).toThrow(KnowledgeFilesystemError);
  });

  it('rejects an invalid UTF-8 sequence held for decoder flush', async () => {
    const file = fileWith(fileStats(1), (buffer) => {
      buffer[0] = 0xc3;
      return Promise.resolve({ bytesRead: 1 });
    });
    const budget = resolveLineSelectionBudget({
      filePath: '/trusted/note.md',
      relativePath: 'note.md',
      offset: 0,
      requestedLimit: 1,
      maxResultCodeUnits: 1000,
      fixedResultCodeUnits: 10,
    });

    await expect(
      readKnowledgeFileLines(file, fileStats(1), budget, undefined),
    ).rejects.toMatchObject({ code: 'knowledge_content_invalid' });
  });
});

describe('Knowledge filesystem cleanup translation', () => {
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
