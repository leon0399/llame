import {
  measureNativeModelOutput,
  renderCollectedDirectory,
  type DirectoryListingEntry,
} from '@workspace/native-file-tools';
import { RESULT_TRUNCATE_CHARS } from '@workspace/runtime-safety';

import { type WebRender } from './pipeline';
import { buildWebReadResult } from './result';

const GUIDE_URL = 'https://example.test/guide';

/** A rendered text of `count` lines, wide enough to exceed the shared bound. */
function renderedLines(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `line ${index + 1} ${'x'.repeat(60)}`,
  ).join('\n');
}

/** Lines `first` through `last` exactly as the reader emits them: numbered,
 *  or verbatim for a `:raw` read, each with its source line delimiter. */
function readWindow(first: number, last: number, raw = false): string {
  return Array.from(
    { length: last - first + 1 },
    (_, index) =>
      `${raw ? '' : `${first + index}: `}line ${first + index} ${'x'.repeat(60)}\n`,
  ).join('');
}

const DIRECTORY_URL = 'https://github.com/o/r/tree/main/apps';
const directoryEntries: ReadonlyArray<DirectoryListingEntry> = [
  {
    name: 'src',
    kind: 'directory',
    children: 'abcdefghijklmnopqrstu'.split('').map((name) => ({
      name: `file-${name}`,
      kind: 'file' as const,
    })),
  },
  { name: 'README.md', kind: 'file' },
];

function oversizedDirectory() {
  return {
    displayPath: DIRECTORY_URL,
    entries: Array.from({ length: 10_001 }, (_, index) => ({
      name: `file-${index}`,
      kind: 'file' as const,
    })),
  };
}

describe('buildWebReadResult', () => {
  it('assembles the native read result with the web envelope', () => {
    const result = buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, {
      method: 'negotiated',
      content: '# Guide\n\nBody text\n',
    });
    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      path: GUIDE_URL,
      representation: 'text',
      content: '1: # Guide\n2: \n3: Body text\n',
      finalUrl: GUIDE_URL,
      method: 'negotiated',
      truncated: false,
      shownRange: { startLine: 1, endLine: 3 },
    });
    expect(result).not.toHaveProperty('notes');
    expect(result).not.toHaveProperty('adapter');
    expect(result).not.toHaveProperty('realPath');
    expect(result).not.toHaveProperty('url');
    expect(result).not.toHaveProperty('contentType');
    expect(result).not.toHaveProperty('markdownTokens');
    expect(JSON.stringify(result)).not.toContain('text/markdown');
  });

  it('matches the native directory renderer, including a selector', () => {
    const directory = {
      displayPath: DIRECTORY_URL,
      entries: directoryEntries,
    };
    const full = buildWebReadResult({ url: DIRECTORY_URL }, DIRECTORY_URL, {
      method: 'adapter',
      content: '',
      directory,
    });
    expect(full).toEqual({
      status: 'success',
      kind: 'directory',
      path: DIRECTORY_URL,
      content: `${DIRECTORY_URL}
  - src/
    - file-a
    - file-b
    - file-c
    - file-d
    - file-e
    - file-f
    - file-g
    - file-h
    - file-i
    - file-j
    - file-k
    - file-l
    - file-m
    - file-n
    - file-o
    - file-p
    - file-q
    - file-r
    - file-s
    - file-t
    … 1 more
  - README.md
`,
      truncated: false,
      finalUrl: DIRECTORY_URL,
      method: 'adapter',
    });
    if (full.status !== 'success' || full.kind !== 'directory') {
      throw new Error('expected a full directory result');
    }
    expect(full.content).toContain('… 1 more');

    const selected = buildWebReadResult(
      { url: DIRECTORY_URL, selector: '1-1' },
      DIRECTORY_URL,
      { method: 'adapter', content: '', directory },
    );
    expect(selected).toEqual({
      status: 'success',
      kind: 'directory',
      path: DIRECTORY_URL,
      content: `${DIRECTORY_URL}
  - src/
`,
      truncated: true,
      nextOffset: 1,
      finalUrl: DIRECTORY_URL,
      method: 'adapter',
    });
  });

  it('reports collected directories beyond the host traversal budget', () => {
    const rootEntries = Array.from({ length: 10_001 }, (_, index) => ({
      name: `file-${index}`,
      kind: 'file' as const,
    }));
    expect(renderCollectedDirectory(DIRECTORY_URL, rootEntries)).toEqual({
      status: 'error',
      type: 'directory_too_large',
      message:
        'Directory contains 10001 entries, exceeding the 10000 entry budget.',
      count: 10_001,
    });

    const childEntries = Array.from({ length: 10_001 }, (_, index) => ({
      name: `file-${index}`,
      kind: 'file' as const,
    }));
    const child = renderCollectedDirectory(DIRECTORY_URL, [
      { name: 'big', kind: 'directory', children: childEntries },
    ]);
    expect(child).toMatchObject({
      status: 'success',
      content: `${DIRECTORY_URL}\n  - big/\n    … 10001 entries\n`,
    });
  });

  it('rejects selectors unsupported for directory results', () => {
    const directory = {
      displayPath: DIRECTORY_URL,
      entries: directoryEntries,
    };
    expect(
      buildWebReadResult(
        { url: DIRECTORY_URL, selector: 'raw' },
        DIRECTORY_URL,
        { method: 'adapter', content: '', directory },
      ),
    ).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message: 'The :raw selector is not supported for directory reads.',
    });
    expect(
      buildWebReadResult(
        { url: DIRECTORY_URL, selector: '1-2,4-5' },
        DIRECTORY_URL,
        { method: 'adapter', content: '', directory },
      ),
    ).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message:
        'Comma-separated selectors are not supported for directory reads.',
    });
  });

  it('counts directory lines when a selector is malformed', () => {
    const result = buildWebReadResult(
      { url: DIRECTORY_URL, selector: '0' },
      DIRECTORY_URL,
      {
        method: 'adapter',
        content: '',
        directory: {
          displayPath: DIRECTORY_URL,
          entries: directoryEntries,
        },
      },
    );
    expect(result).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message:
        'The selector :0 selected no line of this page, which rendered 24 lines numbered from 1. Write :N, :N-M, or :N+K within 1-24, or omit the selector to read from the start.',
    });
  });

  it('applies a positive offset to a directory selector', () => {
    const directory = {
      displayPath: DIRECTORY_URL,
      entries: ['a', 'b', 'c'].map((name) => ({
        name,
        kind: 'file' as const,
      })),
    };
    const result = buildWebReadResult(
      { url: DIRECTORY_URL, selector: '2-2' },
      DIRECTORY_URL,
      { method: 'adapter', content: '', directory },
    );
    expect(result).toMatchObject({
      status: 'success',
      content: `${DIRECTORY_URL}\n  - b\n`,
      truncated: true,
      nextOffset: 2,
    });
  });

  it('applies a limit to the first directory selector', () => {
    const directory = {
      displayPath: DIRECTORY_URL,
      entries: ['a', 'b', 'c'].map((name) => ({
        name,
        kind: 'file' as const,
      })),
    };
    const result = buildWebReadResult(
      { url: DIRECTORY_URL, selector: '1-1' },
      DIRECTORY_URL,
      { method: 'adapter', content: '', directory },
    );
    expect(result).toMatchObject({
      status: 'success',
      content: `${DIRECTORY_URL}\n  - a\n`,
      truncated: true,
      nextOffset: 1,
    });
  });

  it('returns an oversized directory failure without the web envelope', () => {
    expect(
      buildWebReadResult({ url: DIRECTORY_URL }, DIRECTORY_URL, {
        method: 'adapter',
        content: '',
        directory: oversizedDirectory(),
      }),
    ).toEqual({
      status: 'error',
      type: 'directory_too_large',
      message:
        'Directory contains 10001 entries, exceeding the 10000 entry budget.',
    });
  });

  it('reports no rendered text when a large directory selector cannot render', () => {
    expect(
      buildWebReadResult({ url: DIRECTORY_URL, selector: '0' }, DIRECTORY_URL, {
        method: 'adapter',
        content: '',
        directory: oversizedDirectory(),
      }),
    ).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message:
        'The selector :0 selected no line of this page, which rendered no text.',
    });
  });
  it('includes adapter provenance in the web envelope', () => {
    const result = buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, {
      method: 'adapter',
      content: 'adapter body\n',
      adapter: {
        id: 'reader',
        route: 'rewrite',
        origin: 'https://reader.example.test',
      },
    });

    expect(result).toMatchObject({
      status: 'success',
      adapter: {
        id: 'reader',
        route: 'rewrite',
        origin: 'https://reader.example.test',
      },
    });
  });

  it('reports the locator as path and the response as finalUrl', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL },
      'https://cdn.example.test/guide',
      { method: 'text', content: 'hello\n' },
    );
    expect(result).toMatchObject({
      path: GUIDE_URL,
      finalUrl: 'https://cdn.example.test/guide',
      method: 'text',
    });
  });

  it('reports a winning probe’s finalUrl instead of the page’s', () => {
    const probeUrl = 'https://cdn.example.test/guide.md';
    const result = buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, {
      method: 'alternate',
      content: '# Guide\n\nFrom the probe.\n',
      finalUrl: probeUrl,
    });
    // `path` stays the locator the model asked for; `finalUrl` is where the
    // content actually came from.
    expect(result).toMatchObject({
      path: GUIDE_URL,
      finalUrl: probeUrl,
      method: 'alternate',
    });
  });

  it('applies a line selector to the rendered text', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '10-20' },
      GUIDE_URL,
      { method: 'readability', content: renderedLines(30) },
    );
    expect(result).toMatchObject({
      path: GUIDE_URL,
      representation: 'text',
      requestedRange: { startLine: 10, endLine: 20 },
      shownRange: { startLine: 9, endLine: 21 },
      truncated: false,
      nextOffset: 20,
      method: 'readability',
    });
    expect(result).toHaveProperty(
      'content',
      expect.stringContaining('10: line 10'),
    );
    expect(result).toHaveProperty(
      'content',
      expect.not.stringContaining('line 30'),
    );
  });

  it('applies a comma selector to the rendered text', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '4-5,7-8' },
      GUIDE_URL,
      { method: 'readability', content: renderedLines(12) },
    );
    expect(result).toMatchObject({
      path: GUIDE_URL,
      representation: 'text',
      requestedRanges: [
        { startLine: 4, endLine: 5 },
        { startLine: 7, endLine: 8 },
      ],
      shownRanges: [{ startLine: 3, endLine: 9 }],
      truncated: false,
      finalUrl: GUIDE_URL,
      method: 'readability',
    });
    expect(result).toHaveProperty('content', readWindow(3, 9));
    expect(result).not.toHaveProperty('nextOffset');
    expect(result).not.toHaveProperty('requestedRange');
    expect(result).not.toHaveProperty('shownRange');
  });

  it('merges touching comma ranges into one requested range and block', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '4-5,6-7' },
      GUIDE_URL,
      { method: 'readability', content: renderedLines(12) },
    );
    expect(result).toMatchObject({
      requestedRanges: [{ startLine: 4, endLine: 7 }],
      shownRanges: [{ startLine: 3, endLine: 8 }],
      truncated: false,
    });
    expect(result).toHaveProperty('content', readWindow(3, 8));
  });

  it('clips a comma selector whose later range starts past EOF', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '2-3,99-100' },
      GUIDE_URL,
      { method: 'readability', content: renderedLines(12) },
    );
    expect(result).toMatchObject({
      requestedRanges: [
        { startLine: 2, endLine: 3 },
        { startLine: 99, endLine: 100 },
      ],
      shownRanges: [{ startLine: 1, endLine: 4 }],
      truncated: false,
    });
    expect(result).toHaveProperty('content', readWindow(1, 4));
    expect(result).not.toHaveProperty('nextOffset');
  });

  it('rolls a later comma range back when the render exhausts the bound', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '1-200,400-500' },
      GUIDE_URL,
      { method: 'readability', content: renderedLines(600) },
    );
    expect(result).toMatchObject({
      shownRanges: [{ startLine: 1, endLine: 201 }],
      truncated: true,
      nextOffset: 398,
    });
    expect(result).toHaveProperty('content', readWindow(1, 201));
    expect(measureNativeModelOutput(result)).toBeLessThanOrEqual(
      RESULT_TRUNCATE_CHARS,
    );
  });

  it('returns raw comma ranges verbatim', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: 'raw:4-5,7-8' },
      GUIDE_URL,
      { method: 'readability', content: renderedLines(12) },
    );
    expect(result).toMatchObject({
      representation: 'raw',
      requestedRanges: [
        { startLine: 4, endLine: 5 },
        { startLine: 7, endLine: 8 },
      ],
      shownRanges: [
        { startLine: 4, endLine: 5 },
        { startLine: 7, endLine: 8 },
      ],
      truncated: false,
    });
    expect(result).toHaveProperty(
      'content',
      readWindow(4, 5, true) + readWindow(7, 8, true),
    );
  });

  it('returns the raw body untouched for a :raw locator', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: 'raw' },
      GUIDE_URL,
      { method: 'raw', content: '<p>a</p>\nmore\n' },
    );
    expect(result).toMatchObject({
      representation: 'raw',
      content: '<p>a</p>\nmore\n',
      method: 'raw',
      truncated: false,
      shownRange: { startLine: 1, endLine: 2 },
    });
  });

  it('reserves the envelope before the shared bound truncates the render', () => {
    const notes = ['The page could not be converted.'];
    const result = buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, {
      method: 'readability',
      content: renderedLines(1200),
      notes,
    });
    expect(result).toMatchObject({
      path: GUIDE_URL,
      finalUrl: GUIDE_URL,
      method: 'readability',
      notes,
      truncated: true,
    });
    expect(result).toHaveProperty('nextOffset', expect.any(Number));
    expect(result).toHaveProperty(
      'content',
      expect.not.stringContaining('line 1200'),
    );
    expect(measureNativeModelOutput(result)).toBeLessThanOrEqual(
      RESULT_TRUNCATE_CHARS,
    );
  });

  it('omits notes when the render reports none', () => {
    const result = buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, {
      method: 'text',
      content: '{}\n',
      notes: [],
    });
    expect(result).not.toHaveProperty('notes');
  });

  it('tells the model how long the render was when the selector missed', () => {
    // A page's length is unknown until it is read, so the bare error type
    // left the model guessing at a second selector. The count it must select
    // within is the one fact the failure can supply.
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '5000-5010' },
      GUIDE_URL,
      { method: 'text', content: 'only one line\n' },
    );
    expect(result).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message:
        'The selector :5000-5010 selected no line of this page, which rendered 1 line numbered from 1. Write :N, :N-M, or :N+K within 1-1, or omit the selector to read from the start.',
    });
  });

  it('propagates a failure that is not the reader’s own', () => {
    // The catch maps the reader's own refusals and nothing else: a defect
    // raised while the render is read must surface, not be dressed as a read
    // failure the model would report as the page's answer.
    const failing = {
      method: 'text',
      get content(): string {
        throw new Error('the render never produced text');
      },
    } satisfies WebRender;
    expect(() =>
      buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, failing),
    ).toThrow('the render never produced text');
  });

  it('names no range when the render has no lines', () => {
    const result = buildWebReadResult(
      { url: GUIDE_URL, selector: '2-3' },
      GUIDE_URL,
      { method: 'text', content: '' },
    );
    expect(result).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message:
        'The selector :2-3 selected no line of this page, which rendered no text.',
    });
  });
});
