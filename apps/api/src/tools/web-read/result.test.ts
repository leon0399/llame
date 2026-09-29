import {
  measureNativeModelOutput,
  OUTLINE_UNSUPPORTED_MESSAGE,
  renderCollectedDirectory,
  type DirectoryListingEntry,
} from '@workspace/native-file-tools';
import { RESULT_TRUNCATE_CHARS } from '@workspace/runtime-safety';

import { type WebRender } from './pipeline';
import { buildWebReadResult } from './result';

const GUIDE_URL = 'https://example.test/guide';
const RANGED_MARKDOWN = [
  '# Root',
  'Root body',
  '## First',
  'First body',
  '',
  '## Second',
  'Second body',
  '',
  '## Third',
  'Third body',
].join('\n');

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
  it('assembles the native read result with the web envelope', async () => {
    const result = await buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, {
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

  it('matches the native directory renderer, including a selector', async () => {
    const directory = {
      displayPath: DIRECTORY_URL,
      entries: directoryEntries,
    };
    const full = await buildWebReadResult(
      { url: DIRECTORY_URL },
      DIRECTORY_URL,
      {
        method: 'adapter',
        content: '',
        directory,
      },
    );
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

    const selected = await buildWebReadResult(
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

  it('rejects selectors unsupported for directory results', async () => {
    const directory = {
      displayPath: DIRECTORY_URL,
      entries: directoryEntries,
    };
    expect(
      await buildWebReadResult(
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
      await buildWebReadResult(
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

  it('counts directory lines when a selector is malformed', async () => {
    const result = await buildWebReadResult(
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

  it('applies a positive offset to a directory selector', async () => {
    const directory = {
      displayPath: DIRECTORY_URL,
      entries: ['a', 'b', 'c'].map((name) => ({
        name,
        kind: 'file' as const,
      })),
    };
    const result = await buildWebReadResult(
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

  it('applies a limit to the first directory selector', async () => {
    const directory = {
      displayPath: DIRECTORY_URL,
      entries: ['a', 'b', 'c'].map((name) => ({
        name,
        kind: 'file' as const,
      })),
    };
    const result = await buildWebReadResult(
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

  it('returns an oversized directory failure without the web envelope', async () => {
    expect(
      await buildWebReadResult({ url: DIRECTORY_URL }, DIRECTORY_URL, {
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

  it('reports no rendered text when a large directory selector cannot render', async () => {
    expect(
      await buildWebReadResult(
        { url: DIRECTORY_URL, selector: '0' },
        DIRECTORY_URL,
        {
          method: 'adapter',
          content: '',
          directory: oversizedDirectory(),
        },
      ),
    ).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message:
        'The selector :0 selected no line of this page, which rendered no text.',
    });
  });
  it('includes adapter provenance in the web envelope', async () => {
    const result = await buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, {
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
  it('outlines Markdown while retaining web provenance', async () => {
    const result = await buildWebReadResult(
      { url: GUIDE_URL, selector: 'outline' },
      'https://cdn.example.test/guide.md',
      {
        method: 'alternate',
        content: '# Guide\n\nIntro\n\n## Details\n\nBody\n',
        mediaType: 'text/markdown',
        adapter: {
          id: 'reader',
          route: 'rewrite',
          origin: 'https://reader.example.test',
        },
        notes: ['from adapter'],
      },
    );

    expect(result).toMatchObject({
      status: 'success',
      representation: 'outline',
      finalUrl: 'https://cdn.example.test/guide.md',
      method: 'alternate',
      adapter: {
        id: 'reader',
        route: 'rewrite',
        origin: 'https://reader.example.test',
      },
      notes: ['from adapter'],
    });
    expect(result).toHaveProperty(
      'content',
      '1: # Guide\n3: Intro\n5: ## Details\n7: Body\n',
    );
    expect(result).not.toHaveProperty('mediaType');
    expect(result).not.toHaveProperty('contentType');
  });

  it('rejects outline for unsupported web media', async () => {
    const result = await buildWebReadResult(
      { url: GUIDE_URL, selector: 'outline' },
      GUIDE_URL,
      {
        method: 'text',
        content: '{"key":"value"}\n',
        mediaType: 'application/json',
      },
    );

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message: OUTLINE_UNSUPPORTED_MESSAGE,
    });
  });

  it('rejects outline for a raw web render', async () => {
    const result = await buildWebReadResult(
      { url: GUIDE_URL, selector: 'outline' },
      GUIDE_URL,
      { method: 'raw', content: '<h1>Guide</h1>\n' },
    );

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message: OUTLINE_UNSUPPORTED_MESSAGE,
    });
  });

  it('rejects outline for an unlabelled adapter JSON without changing plain reads', async () => {
    const render: WebRender = {
      method: 'adapter',
      content: '{"key":"value"}\n',
      adapter: { id: 'github', route: 'native' },
    };
    const outline = await buildWebReadResult(
      { url: GUIDE_URL, selector: 'outline' },
      GUIDE_URL,
      render,
    );
    const plain = await buildWebReadResult(
      { url: GUIDE_URL },
      GUIDE_URL,
      render,
    );

    expect(outline).toEqual({
      status: 'error',
      type: 'invalid_selector',
      message: OUTLINE_UNSUPPORTED_MESSAGE,
    });
    expect(plain).toMatchObject({
      status: 'success',
      representation: 'text',
      content: '1: {"key":"value"}\n',
      method: 'adapter',
    });
  });

  it('rejects outline for web directories', async () => {
    const result = await buildWebReadResult(
      { url: DIRECTORY_URL, selector: 'outline' },
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
      message: 'The :outline member is not supported for directory reads.',
    });
  });

  it('rejects outline of a truncated adapter but keeps plain reads', async () => {
    const render = {
      method: 'adapter' as const,
      content: '# Guide\n\nBody\n',
      mediaType: 'text/markdown',
      truncated: true,
    };
    const outline = await buildWebReadResult(
      { url: GUIDE_URL, selector: 'outline' },
      GUIDE_URL,
      render,
    );
    const plain = await buildWebReadResult(
      { url: GUIDE_URL },
      GUIDE_URL,
      render,
    );

    expect(outline).toEqual({
      status: 'error',
      type: 'representation_too_large',
      message:
        "The adapter document was cut at the web read's document bound, so an outline would omit structure; read it without :outline.",
    });
    expect(plain).toMatchObject({
      status: 'success',
      content: '1: # Guide\n2: \n3: Body\n',
      method: 'adapter',
    });
  });

  it('reports the locator as path and the response as finalUrl', async () => {
    const result = await buildWebReadResult(
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

  it('reports a winning probe’s finalUrl instead of the page’s', async () => {
    const probeUrl = 'https://cdn.example.test/guide.md';
    const result = await buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, {
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

  it('applies a line selector to the rendered text', async () => {
    const result = await buildWebReadResult(
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

  it('prepends Markdown ancestors and retains the web envelope', async () => {
    const result = await buildWebReadResult(
      { url: GUIDE_URL, selector: '4-4' },
      GUIDE_URL,
      {
        method: 'adapter',
        content: RANGED_MARKDOWN,
        mediaType: 'text/markdown',
        finalUrl: 'https://cdn.example.test/guide.md',
        adapter: {
          id: 'reader',
          route: 'rewrite',
          origin: 'https://reader.example.test',
        },
        notes: ['from adapter'],
      },
    );

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      path: GUIDE_URL,
      representation: 'text',
      content: '1: # Root\n3: ## First\n4: First body\n5: \n',
      requestedRanges: [{ startLine: 4, endLine: 4 }],
      shownRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 5 },
      ],
      truncated: false,
      nextOffset: 4,
      finalUrl: 'https://cdn.example.test/guide.md',
      method: 'adapter',
      adapter: {
        id: 'reader',
        route: 'rewrite',
        origin: 'https://reader.example.test',
      },
      notes: ['from adapter'],
    });
    expect(result).not.toHaveProperty('requestedRange');
    expect(result).not.toHaveProperty('shownRange');
  });

  it('keeps plain-text and raw ranged renders unchanged', async () => {
    const plain = await buildWebReadResult(
      { url: GUIDE_URL, selector: '4-4' },
      GUIDE_URL,
      {
        method: 'text',
        content: RANGED_MARKDOWN,
        mediaType: 'text/plain',
      },
    );
    expect(plain).toEqual({
      status: 'success',
      kind: 'file',
      path: GUIDE_URL,
      representation: 'text',
      content: '3: ## First\n4: First body\n5: \n',
      requestedRange: { startLine: 4, endLine: 4 },
      shownRange: { startLine: 3, endLine: 5 },
      nextOffset: 4,
      truncated: false,
      finalUrl: GUIDE_URL,
      method: 'text',
    });

    const raw = await buildWebReadResult(
      { url: GUIDE_URL, selector: 'raw:2-2' },
      GUIDE_URL,
      {
        method: 'raw',
        content: RANGED_MARKDOWN,
        mediaType: 'text/markdown',
      },
    );
    expect(raw).toEqual({
      status: 'success',
      kind: 'file',
      path: GUIDE_URL,
      representation: 'raw',
      content: 'Root body\n',
      requestedRange: { startLine: 2, endLine: 2 },
      shownRange: { startLine: 2, endLine: 2 },
      nextOffset: 2,
      truncated: false,
      finalUrl: GUIDE_URL,
      method: 'raw',
    });
  });

  it('adds a Markdown ancestor chain to every comma passage', async () => {
    const result = await buildWebReadResult(
      { url: GUIDE_URL, selector: '4-4,10-10' },
      GUIDE_URL,
      {
        method: 'negotiated',
        content: RANGED_MARKDOWN,
        mediaType: 'text/markdown',
      },
    );

    expect(result).toEqual({
      status: 'success',
      kind: 'file',
      path: GUIDE_URL,
      representation: 'text',
      content:
        '1: # Root\n3: ## First\n4: First body\n5: \n9: ## Third\n10: Third body',
      requestedRanges: [
        { startLine: 4, endLine: 4 },
        { startLine: 10, endLine: 10 },
      ],
      shownRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 5 },
        { startLine: 9, endLine: 10 },
      ],
      truncated: false,
      finalUrl: GUIDE_URL,
      method: 'negotiated',
    });
  });

  it('applies a comma selector to the rendered text', async () => {
    const result = await buildWebReadResult(
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

  it('merges touching comma ranges into one requested range and block', async () => {
    const result = await buildWebReadResult(
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

  it('clips a comma selector whose later range starts past EOF', async () => {
    const result = await buildWebReadResult(
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

  it('rolls a later comma range back when the render exhausts the bound', async () => {
    const result = await buildWebReadResult(
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

  it('returns raw comma ranges verbatim', async () => {
    const result = await buildWebReadResult(
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

  it('returns the raw body untouched for a :raw locator', async () => {
    const result = await buildWebReadResult(
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

  it('reserves the envelope before the shared bound truncates the render', async () => {
    const notes = ['The page could not be converted.'];
    const result = await buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, {
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

  it('omits notes when the render reports none', async () => {
    const result = await buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, {
      method: 'text',
      content: '{}\n',
      notes: [],
    });
    expect(result).not.toHaveProperty('notes');
  });

  it('tells the model how long the render was when the selector missed', async () => {
    // A page's length is unknown until it is read, so the bare error type
    // left the model guessing at a second selector. The count it must select
    // within is the one fact the failure can supply.
    const result = await buildWebReadResult(
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

  it('propagates a failure that is not the reader’s own', async () => {
    // The catch maps the reader's own refusals and nothing else: a defect
    // raised while the render is read must surface, not be dressed as a read
    // failure the model would report as the page's answer.
    const failing = {
      method: 'text',
      get content(): string {
        throw new Error('the render never produced text');
      },
    } satisfies WebRender;
    await expect(
      buildWebReadResult({ url: GUIDE_URL }, GUIDE_URL, failing),
    ).rejects.toThrow('the render never produced text');
  });

  it('names no range when the render has no lines', async () => {
    const result = await buildWebReadResult(
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
