import {
  closeDirectoryAndTranslateFailure,
  closeFileAndTranslateFailure,
  readAllDirectoryEntries,
  readKnowledgeFileLines,
  readWholeFileBytes,
  resolveLineSelectionBudget,
  resolveLineSelectionResult,
  serializedFixedReadResultLength,
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
  it('resolves requested and default line caps', () => {
    const request = {
      filePath: '/trusted/note.md',
      relativePath: 'note.md',
      offset: 4,
      requestedLimit: 3,
      maxResultCodeUnits: 1000,
      fixedResultCodeUnits: 10,
    };
    expect(resolveLineSelectionBudget(request)).toEqual({
      offset: request.offset,
      requestedLimit: request.requestedLimit,
      maxResultCodeUnits: request.maxResultCodeUnits,
      fixedResultCodeUnits: request.fixedResultCodeUnits,
      maxLines: 3,
    });
    expect(
      resolveLineSelectionBudget({ ...request, requestedLimit: undefined })
        .maxLines,
    ).toBe(2000);
    expect(
      resolveLineSelectionBudget({ ...request, requestedLimit: 3000 }).maxLines,
    ).toBe(2000);
  });

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

  it('carries CRLF and a trailing partial line across decode chunks', async () => {
    const chunks = [Buffer.from('first\r'), Buffer.from('\nsecond\nthird')];
    const file = fileWith(fileStats(0), (buffer) => {
      const chunk = chunks.shift() ?? Buffer.alloc(0);
      chunk.copy(buffer);
      return Promise.resolve({ bytesRead: chunk.length });
    });
    const budget = resolveLineSelectionBudget({
      filePath: '/trusted/note.md',
      relativePath: 'note.md',
      offset: 1,
      requestedLimit: 1,
      maxResultCodeUnits: 1000,
      fixedResultCodeUnits: 10,
    });

    await expect(
      readKnowledgeFileLines(file, fileStats(0), budget, undefined),
    ).resolves.toMatchObject({
      lineIndex: 3,
      selectedLines: ['2: second\n'],
      fragments: ['third'],
    });
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

  it('returns an empty result when the fixed envelope fits', () => {
    expect(
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
          maxResultCodeUnits: 1000,
          fixedResultCodeUnits: 0,
        },
        'note.md',
      ),
    ).toEqual({ path: 'note.md', offset: 0, lineCount: 0, content: '' });
  });

  it('rejects an offset at or beyond the decoded line count', () => {
    expect(() =>
      resolveLineSelectionResult(
        {
          lineIndex: 2,
          selectedLines: [],
          fragments: [],
          serializedContentCodeUnits: 0,
          selectionStorageFull: false,
        },
        {
          offset: 2,
          requestedLimit: undefined,
          maxLines: 2000,
          maxResultCodeUnits: 1000,
          fixedResultCodeUnits: 0,
        },
        'note.md',
      ),
    ).toThrow(expect.objectContaining({ code: 'knowledge_range_invalid' }));
  });

  it('returns line-limit and output-limit continuation metadata', () => {
    const selectedLines = [
      '1: a\n',
      '2: b\n',
      '3: c\n',
      `4: ${'d'.repeat(30)}\n`,
    ];
    expect(
      resolveLineSelectionResult(
        {
          lineIndex: 5,
          selectedLines,
          fragments: [],
          serializedContentCodeUnits: 0,
          selectionStorageFull: false,
        },
        {
          offset: 0,
          requestedLimit: undefined,
          maxLines: 2,
          maxResultCodeUnits: 1000,
          fixedResultCodeUnits: 0,
        },
        'note.md',
      ),
    ).toEqual({
      path: 'note.md',
      offset: 0,
      lineCount: 2,
      content: '1: a\n2: b\n',
      nextOffset: 2,
      cutReason: 'line_limit',
    });

    const lineCount = 3;
    const content = '1: a\n2: b\n3: c\n';
    const nextOffset = 3;
    const maxResultCodeUnits =
      1 +
      JSON.stringify('lineCount').length +
      1 +
      JSON.stringify(lineCount).length +
      (1 +
        JSON.stringify('content').length +
        1 +
        JSON.stringify(content).length) +
      (1 +
        JSON.stringify('nextOffset').length +
        1 +
        JSON.stringify(nextOffset).length) +
      (1 +
        JSON.stringify('cutReason').length +
        1 +
        JSON.stringify('output_limit').length);
    expect(
      resolveLineSelectionResult(
        {
          lineIndex: 5,
          selectedLines,
          fragments: [],
          serializedContentCodeUnits: 0,
          selectionStorageFull: false,
        },
        {
          offset: 0,
          requestedLimit: 4,
          maxLines: 4,
          maxResultCodeUnits,
          fixedResultCodeUnits: 0,
        },
        'note.md',
      ),
    ).toEqual({
      path: 'note.md',
      offset: 0,
      lineCount,
      content,
      nextOffset,
      cutReason: 'output_limit',
    });
  });

  it('serializes the fixed result envelope with escaped content', () => {
    expect(serializedFixedReadResultLength({ path: 'a"😀', offset: 2 })).toBe(
      JSON.stringify({ path: 'a"😀', offset: 2 }).length,
    );
  });

  it('rejects an invalid UTF-8 sequence held for decoder flush', async () => {
    let read = false;
    const file = fileWith(fileStats(1), (buffer) => {
      if (read) return Promise.resolve({ bytesRead: 0 });
      read = true;
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

  it('stops selecting lines once the serialized content budget is spent', async () => {
    const source = Buffer.from('a\nb\nc\nd\n');
    let delivered = false;
    const file = fileWith(fileStats(source.length), (buffer) => {
      if (delivered) return Promise.resolve({ bytesRead: 0 });
      delivered = true;
      source.copy(buffer);
      return Promise.resolve({ bytesRead: source.length });
    });
    const budget = resolveLineSelectionBudget({
      filePath: '/trusted/note.md',
      relativePath: 'note.md',
      offset: 0,
      requestedLimit: undefined,
      // Each rendered line costs 6 serialized code units, so exactly two fit.
      maxResultCodeUnits: 112,
      fixedResultCodeUnits: 100,
    });

    await expect(
      readKnowledgeFileLines(file, fileStats(source.length), budget, undefined),
    ).resolves.toMatchObject({
      lineIndex: 4,
      selectedLines: ['1: a\n', '2: b\n'],
      serializedContentCodeUnits: 12,
      selectionStorageFull: true,
    });
  });

  it('renders CRLF, LF, and an embedded carriage return distinctly', async () => {
    const source = Buffer.from('first\r\nsecond\n\rx\n');
    let delivered = false;
    const file = fileWith(fileStats(source.length), (buffer) => {
      if (delivered) return Promise.resolve({ bytesRead: 0 });
      delivered = true;
      source.copy(buffer);
      return Promise.resolve({ bytesRead: source.length });
    });
    const budget = resolveLineSelectionBudget({
      filePath: '/trusted/note.md',
      relativePath: 'note.md',
      offset: 0,
      requestedLimit: 3,
      maxResultCodeUnits: 1000,
      fixedResultCodeUnits: 10,
    });

    await expect(
      readKnowledgeFileLines(file, fileStats(source.length), budget, undefined),
    ).resolves.toMatchObject({
      lineIndex: 3,
      selectedLines: ['1: first\r\n', '2: second\n', '3: \rx\n'],
    });
  });

  it.each([-1, Number.NaN])(
    'rejects a line-read byte count of %s',
    async (bytesRead) => {
      let reported = false;
      const file = fileWith(fileStats(4), (buffer) => {
        if (reported) return Promise.resolve({ bytesRead: 0 });
        reported = true;
        buffer.fill(97);
        return Promise.resolve({ bytesRead });
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
        readKnowledgeFileLines(file, fileStats(4), budget, undefined),
      ).rejects.toMatchObject({ code: 'knowledge_space_unavailable' });
    },
  );

  it('rejects a file that keeps growing past the read-byte cap', async () => {
    const file = fileWith(fileStats(1), (buffer) => {
      buffer.fill(97);
      return Promise.resolve({ bytesRead: buffer.length });
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
    ).rejects.toMatchObject({ code: 'knowledge_limit_exceeded' });
  });

  it('carries a split multi-byte sequence across decode chunks', async () => {
    const chunks = [Buffer.from([0xc3]), Buffer.from([0xa9, 0x0a])];
    const file = fileWith(fileStats(0), (buffer) => {
      const chunk = chunks.shift() ?? Buffer.alloc(0);
      chunk.copy(buffer);
      return Promise.resolve({ bytesRead: chunk.length });
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
      readKnowledgeFileLines(file, fileStats(0), budget, undefined),
    ).resolves.toMatchObject({ lineIndex: 1, selectedLines: ['1: é\n'] });
  });

  it('rejects a non-zero offset into a file with no decoded lines', () => {
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
          offset: 5,
          requestedLimit: undefined,
          maxLines: 2000,
          maxResultCodeUnits: 1000,
          fixedResultCodeUnits: 0,
        },
        'note.md',
      ),
    ).toThrow(expect.objectContaining({ code: 'knowledge_range_invalid' }));
  });

  it('accepts an empty result that exactly fills its budget', () => {
    const emptyResultCodeUnits =
      1 +
      JSON.stringify('lineCount').length +
      1 +
      JSON.stringify(0).length +
      (1 + JSON.stringify('content').length + 1 + JSON.stringify('').length);

    expect(
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
          maxResultCodeUnits: emptyResultCodeUnits,
          fixedResultCodeUnits: 0,
        },
        'note.md',
      ),
    ).toEqual({ path: 'note.md', offset: 0, lineCount: 0, content: '' });
  });

  it('measures the remaining lines from the requested offset', () => {
    expect(
      resolveLineSelectionResult(
        {
          lineIndex: 5,
          selectedLines: ['3: c\n', '4: d\n', '5: e\n'],
          fragments: [],
          serializedContentCodeUnits: 0,
          selectionStorageFull: false,
        },
        {
          offset: 2,
          requestedLimit: 3,
          maxLines: 3,
          maxResultCodeUnits: 1000,
          fixedResultCodeUnits: 0,
        },
        'note.md',
      ),
    ).toEqual({
      path: 'note.md',
      offset: 2,
      lineCount: 3,
      content: '3: c\n4: d\n5: e\n',
    });
  });

  it('drops another line when the continuation metadata overruns by one', () => {
    const selectedLines = [
      '1: a\n',
      '2: b\n',
      '3: c\n',
      `4: ${'d'.repeat(30)}\n`,
    ];
    const threeLineCodeUnits =
      1 +
      JSON.stringify('lineCount').length +
      1 +
      JSON.stringify(3).length +
      (1 +
        JSON.stringify('content').length +
        1 +
        JSON.stringify('1: a\n2: b\n3: c\n').length) +
      (1 + JSON.stringify('nextOffset').length + 1 + JSON.stringify(3).length) +
      (1 +
        JSON.stringify('cutReason').length +
        1 +
        JSON.stringify('output_limit').length);

    expect(
      resolveLineSelectionResult(
        {
          lineIndex: 5,
          selectedLines,
          fragments: [],
          serializedContentCodeUnits: 0,
          selectionStorageFull: false,
        },
        {
          offset: 0,
          requestedLimit: 4,
          maxLines: 4,
          maxResultCodeUnits: threeLineCodeUnits - 1,
          fixedResultCodeUnits: 0,
        },
        'note.md',
      ),
    ).toEqual({
      path: 'note.md',
      offset: 0,
      lineCount: 2,
      content: '1: a\n2: b\n',
      nextOffset: 2,
      cutReason: 'output_limit',
    });
  });
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
