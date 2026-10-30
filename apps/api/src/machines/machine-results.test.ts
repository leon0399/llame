import {
  type JsonValue,
  type SerializableRecord,
  type SerializableValue,
} from '@workspace/machine-protocol';

import { renderToolResultText } from '../tools/model-text';
import {
  isNativeFailure,
  readFsBytesResult,
  readFsGrepResult,
  readFsListResult,
  readFsReadResult,
  readFsStatResult,
  readHelloResult,
  readMcpOpenResult,
  readMcpServersResult,
  readNativeFailure,
  readRootsListResult,
} from './machine-results';

describe('readHelloResult', () => {
  it('accepts the daemon answer', () => {
    expect(
      readHelloResult({
        protocolVersion: 1,
        daemonVersion: '0.0.1',
        roots: ['/srv/app', '/home/me'],
      }),
    ).toEqual({
      protocolVersion: 1,
      daemonVersion: '0.0.1',
      roots: ['/srv/app', '/home/me'],
    });
  });

  it.each([
    [null],
    ['hello'],
    [[]],
    [{}],
    [{ protocolVersion: 1 }],
    [{ protocolVersion: 1, daemonVersion: 'x' }],
    [{ protocolVersion: 1, daemonVersion: 'x', roots: 'not-an-array' }],
    [{ protocolVersion: 1, daemonVersion: 'x', roots: ['/a', 7] }],
    [{ protocolVersion: '1', daemonVersion: 'x', roots: [] }],
    [{ protocolVersion: 1.5, daemonVersion: 'x', roots: [] }],
    [{ protocolVersion: -1, daemonVersion: 'x', roots: [] }],
  ])('refuses %j', (value) => {
    expect(readHelloResult(value)).toBeUndefined();
  });

  it('accepts a handshake that lists no methods, as an older daemon answers', () => {
    expect(
      readHelloResult({
        protocolVersion: 1,
        daemonVersion: '0.0.1',
        roots: ['/srv/app'],
      }),
    ).toEqual({
      protocolVersion: 1,
      daemonVersion: '0.0.1',
      roots: ['/srv/app'],
    });
  });

  it('carries the git methods a daemon lists', () => {
    expect(
      readHelloResult({
        protocolVersion: 1,
        daemonVersion: '0.0.1',
        roots: [],
        methods: ['git.status', 'git.inspect'],
      }),
    ).toEqual({
      protocolVersion: 1,
      daemonVersion: '0.0.1',
      roots: [],
      // Rebuilt from the protocol's own vocabulary, so an unknown method a
      // daemon names cannot reach a hub-side check.
      methods: ['git.inspect', 'git.status'],
    });
  });

  it.each([[['fs.read', 'git']], [[7]], ['git.inspect'], [null]])(
    'reads a malformed method list as absent, keeping the handshake usable',
    (methods) => {
      expect(
        readHelloResult({
          protocolVersion: 1,
          daemonVersion: '0.0.1',
          roots: [],
          methods,
        }),
      ).toEqual({ protocolVersion: 1, daemonVersion: '0.0.1', roots: [] });
    },
  );
});

describe('readRootsListResult', () => {
  it('accepts and copies the list', () => {
    expect(readRootsListResult({ roots: ['/a'] })).toEqual({ roots: ['/a'] });
  });

  it.each([[{}], [{ roots: [1] }], [{ roots: null }], ['/a']])(
    'refuses %j',
    (value) => {
      expect(readRootsListResult(value)).toBeUndefined();
    },
  );
});

describe('readNativeFailure', () => {
  it('accepts the fence vocabulary with and without a count', () => {
    expect(
      readNativeFailure({ status: 'error', type: 'not_found', message: 'no' }),
    ).toEqual({ status: 'error', type: 'not_found', message: 'no' });
    expect(
      readNativeFailure({
        status: 'error',
        type: 'old_text_ambiguous',
        message: 'many',
        count: 3,
      }),
    ).toEqual({
      status: 'error',
      type: 'old_text_ambiguous',
      message: 'many',
      count: 3,
    });
  });

  it.each([
    [{ status: 'error', type: 'nope', message: 'x' }],
    [{ status: 'error', type: 'not_found' }],
    [{ status: 'error', message: 'x' }],
    [{ status: 'success', type: 'not_found', message: 'x' }],
  ])('refuses %j', (value) => {
    expect(readNativeFailure(value)).toBeUndefined();
    expect(isNativeFailure(value)).toBe(false);
  });

  it.each([
    [{ status: 'error', type: 'not_found', message: 'x', count: -1 }],
    [{ status: 'error', type: 'not_found', message: 'x', count: '2' }],
    [{ status: 'error', type: 'not_found', message: 'x', count: 1.5 }],
  ])('drops an unusable optional count from %j', (value) => {
    expect(readNativeFailure(value)).toEqual({
      status: 'error',
      type: 'not_found',
      message: 'x',
    });
  });
});

describe('readFsStatResult', () => {
  it('accepts each kind with optional size and real path', () => {
    expect(readFsStatResult({ kind: 'directory', isLink: false })).toEqual({
      kind: 'directory',
      isLink: false,
    });
    expect(
      readFsStatResult({
        kind: 'file',
        isLink: true,
        size: 12,
        realPath: '/srv/app/a',
      }),
    ).toEqual({ kind: 'file', isLink: true, size: 12, realPath: '/srv/app/a' });
    expect(readFsStatResult({ kind: 'missing', isLink: false })).toMatchObject({
      kind: 'missing',
    });
    expect(readFsStatResult({ kind: 'other', isLink: false })).toMatchObject({
      kind: 'other',
    });
  });

  it.each([
    [{}],
    [{ kind: 'file' }],
    [{ kind: 'link', isLink: true }],
    [{ kind: 'file', isLink: 'no' }],
  ])('refuses %j', (value) => {
    expect(readFsStatResult(value)).toBeUndefined();
  });

  it.each([
    [{ kind: 'file', isLink: false, size: -2 }],
    [{ kind: 'file', isLink: false, realPath: 7 }],
  ])('drops unusable optional fields from %j', (value) => {
    expect(readFsStatResult(value)).toEqual({ kind: 'file', isLink: false });
  });
});

describe('readFsListResult', () => {
  it('accepts a listing and its truncation head', () => {
    expect(
      readFsListResult({
        entries: [
          { name: 'a', kind: 'file' },
          { name: 'b', kind: 'link' },
        ],
        totalCount: 9,
        truncated: true,
      }),
    ).toEqual({
      entries: [
        { name: 'a', kind: 'file' },
        { name: 'b', kind: 'link' },
      ],
      totalCount: 9,
      truncated: true,
    });
  });

  it('reads the entries field whatever position the daemon wrote it in', () => {
    expect(
      readFsListResult({
        totalCount: 2,
        truncated: false,
        entries: [
          { name: 'a', kind: 'file' },
          { name: 'b', kind: 'directory' },
        ],
      }),
    ).toEqual({
      entries: [
        { name: 'a', kind: 'file' },
        { name: 'b', kind: 'directory' },
      ],
      totalCount: 2,
      truncated: false,
    });
  });

  it('returns a native failure result unchanged in meaning', () => {
    expect(
      readFsListResult({ status: 'error', type: 'not_found', message: 'no' }),
    ).toEqual({ status: 'error', type: 'not_found', message: 'no' });
  });

  it.each([
    [{ entries: [] }],
    [{ entries: [], totalCount: 0 }],
    [
      {
        entries: [{ name: 'a', kind: 'nope' }],
        totalCount: 1,
        truncated: false,
      },
    ],
    [{ entries: [{ name: 'a' }], totalCount: 1, truncated: false }],
    [{ entries: ['a'], totalCount: 1, truncated: false }],
    [{ entries: [], totalCount: 1.5, truncated: false }],
  ])('refuses %j', (value) => {
    expect(readFsListResult(value)).toBeUndefined();
  });
});

describe('readFsReadResult', () => {
  it('accepts a file read unchanged', () => {
    const file = {
      status: 'success' as const,
      kind: 'file' as const,
      path: 'machine://devl/a',
      content: 'hello',
      truncated: false,
      nextOffset: 0,
    };
    expect(readFsReadResult(file)).toEqual(file);
  });

  it('accepts a directory read and a media read', () => {
    expect(
      readFsReadResult({
        status: 'success',
        kind: 'directory',
        path: 'machine://devl/a',
        content: 'a\n',
        truncated: true,
      }),
    ).toMatchObject({ kind: 'directory', truncated: true });
    expect(
      readFsReadResult({
        status: 'success',
        kind: 'image',
        mediaType: 'image/png',
        path: 'machine://devl/a.png',
      }),
    ).toEqual({
      status: 'success',
      kind: 'image',
      mediaType: 'image/png',
      path: 'machine://devl/a.png',
    });
  });

  it('forwards the counts a newer daemon reports', () => {
    expect(
      readFsReadResult({
        status: 'success',
        kind: 'file',
        path: 'machine://devl/a',
        content: '1: hello\n',
        truncated: true,
        nextOffset: 1,
        lineCount: 216,
      }),
    ).toEqual({
      status: 'success',
      kind: 'file',
      path: 'machine://devl/a',
      content: '1: hello\n',
      truncated: true,
      nextOffset: 1,
      lineCount: 216,
    });
    expect(
      readFsReadResult({
        status: 'success',
        kind: 'directory',
        path: 'machine://devl/a',
        content: 'machine://devl/a\n  - b\n',
        truncated: false,
        entryCount: 3,
      }),
    ).toEqual({
      status: 'success',
      kind: 'directory',
      path: 'machine://devl/a',
      content: 'machine://devl/a\n  - b\n',
      truncated: false,
      entryCount: 3,
    });
  });

  it('forwards the representation and shown ranges a daemon reports', () => {
    const answer = {
      status: 'success' as const,
      kind: 'file' as const,
      path: 'machine://devl/a',
      representation: 'raw' as const,
      content: 'a\nb\n',
      truncated: true,
      nextOffset: 2,
      lineCount: 40,
      requestedRange: null,
      shownRange: { startLine: 3, endLine: 4 },
    };
    expect(readFsReadResult(answer)).toEqual(answer);
  });

  it('renders a Machine read from the daemon answer it received', () => {
    // The daemon reports the native result as-is, so the hub must forward the
    // ranges the header is built from; dropping them renders `: empty`.
    const result = readFsReadResult({
      status: 'success',
      kind: 'file',
      path: 'machine://devl/a',
      representation: 'text',
      content: '12: a\n40: b\n41: c\n',
      truncated: true,
      nextOffset: 41,
      lineCount: 216,
      requestedRange: { startLine: 12, endLine: 40 },
      shownRange: { startLine: 11, endLine: 41 },
    });
    if (result === undefined) throw new Error('Expected a Machine file read');
    expect(renderToolResultText('read', result)).toBe(
      'machine://devl/a:11-41 of 216 lines\n12: a\n40: b\n41: c\n' +
        '[175 more lines. Use machine://devl/a:42- to continue]',
    );
  });

  it.each([
    [{ status: 'success', kind: 'file', path: 'p' }],
    [
      {
        status: 'success',
        kind: 'file',
        path: 'p',
        content: 'x',
        truncated: 'no',
      },
    ],
    [{ status: 'success', kind: 'pdf', path: 'p' }],
    [
      {
        status: 'success',
        kind: 'socket',
        path: 'p',
        content: 'x',
        truncated: false,
      },
    ],
  ])('refuses %j', (value) => {
    expect(readFsReadResult(value)).toBeUndefined();
  });

  it('reads a pdf read as media, like an image', () => {
    expect(
      readFsReadResult({
        status: 'success',
        kind: 'pdf',
        mediaType: 'application/pdf',
        path: 'machine://devl/a.pdf',
      }),
    ).toEqual({
      status: 'success',
      kind: 'pdf',
      mediaType: 'application/pdf',
      path: 'machine://devl/a.pdf',
    });
  });

  it('refuses an envelope that is neither a success nor a refusal', () => {
    expect(
      readFsReadResult({
        status: 'pending',
        kind: 'file',
        path: 'machine://devl/a',
        content: 'hello',
        truncated: false,
      }),
    ).toBeUndefined();
  });

  it('returns a refusal carried alongside extra fields', () => {
    expect(
      readFsReadResult({
        status: 'error',
        type: 'not_found',
        message: 'no',
        path: 'p',
      }),
    ).toEqual({ status: 'error', type: 'not_found', message: 'no' });
  });
});

describe('readFsBytesResult', () => {
  it('accepts metadata and a refusal', () => {
    expect(readFsBytesResult({ size: 5, mediaType: 'image/png' })).toEqual({
      size: 5,
      mediaType: 'image/png',
    });
    expect(
      readFsBytesResult({
        status: 'error',
        type: 'media_too_large',
        message: 'big',
      }),
    ).toEqual({ status: 'error', type: 'media_too_large', message: 'big' });
  });

  it.each([
    [{ size: 5 }],
    [{ mediaType: 'image/png' }],
    [{ size: -5, mediaType: 'x' }],
  ])('refuses %j', (value) => {
    expect(readFsBytesResult(value)).toBeUndefined();
  });
});

describe('readMcpServersResult', () => {
  it('accepts entries with and without a transport, and diagnostics', () => {
    expect(
      readMcpServersResult({
        servers: [
          { name: 'storybook', transport: 'http', state: 'available' },
          { name: 'repo', state: 'unavailable', diagnostic: 'unset {env:X}' },
        ],
      }),
    ).toEqual({
      servers: [
        { name: 'storybook', transport: 'http', state: 'available' },
        { name: 'repo', state: 'unavailable', diagnostic: 'unset {env:X}' },
      ],
    });
  });

  it.each([
    [{}],
    [{ servers: 'x' }],
    [{ servers: [{ name: 'a', state: 'maybe' }] }],
    [{ servers: [{ state: 'available' }] }],
  ])('refuses %j', (value) => {
    expect(readMcpServersResult(value)).toBeUndefined();
  });

  it('drops a transport outside the closed set, keeping the entry', () => {
    expect(
      readMcpServersResult({
        servers: [{ name: 'a', state: 'available', transport: 'socket' }],
      }),
    ).toEqual({ servers: [{ name: 'a', state: 'available' }] });
  });
});

describe('readMcpOpenResult', () => {
  it('accepts the protected values of the started definition', () => {
    expect(readMcpOpenResult({ protectedValues: ['token'] })).toEqual({
      protectedValues: ['token'],
    });
    expect(readMcpOpenResult({ protectedValues: [] })).toEqual({
      protectedValues: [],
    });
  });

  it.each([[{}], [{ protectedValues: 'token' }], [{ protectedValues: [1] }]])(
    'refuses %j',
    (value) => {
      expect(readMcpOpenResult(value)).toBeUndefined();
    },
  );
});

describe('readFsGrepResult', () => {
  /** One daemon passage, with any field a test needs to break. */
  function passageBody(overrides: SerializableRecord = {}): SerializableRecord {
    return {
      path: 'nested/a.go',
      startLine: 2,
      endLine: 3,
      content: '2: needle\n3: needle',
      matches: [2, 3],
      ...overrides,
    };
  }

  /** One daemon answer that is valid unless `overrides` breaks it. */
  function pageBody(
    results: ReadonlyArray<SerializableValue>,
    overrides: SerializableRecord = {},
  ): JsonValue {
    return {
      ok: true,
      results,
      complete: true,
      warnings: [],
      consumed: { files: results.length, entries: results.length, bytes: 40 },
      ...overrides,
    };
  }

  it('accepts a page, its passages, and its optional fields', () => {
    expect(
      readFsGrepResult(
        pageBody(
          [passageBody({ truncated: true }), passageBody({ path: '' })],
          {
            complete: false,
            warnings: [{ kind: 'deadline', count: 2 }],
            cursor: 'daemon-cursor',
          },
        ),
      ),
    ).toEqual({
      ok: true,
      results: [
        {
          path: 'nested/a.go',
          startLine: 2,
          endLine: 3,
          content: '2: needle\n3: needle',
          matches: [2, 3],
          truncated: true,
        },
        {
          path: '',
          startLine: 2,
          endLine: 3,
          content: '2: needle\n3: needle',
          matches: [2, 3],
        },
      ],
      complete: false,
      warnings: [{ kind: 'deadline', count: 2 }],
      consumed: { files: 2, entries: 2, bytes: 40 },
      cursor: 'daemon-cursor',
    });
  });

  it('keeps an absent truncation flag absent', () => {
    expect(readFsGrepResult(pageBody([passageBody()]))).toStrictEqual({
      ok: true,
      results: [
        {
          path: 'nested/a.go',
          startLine: 2,
          endLine: 3,
          content: '2: needle\n3: needle',
          matches: [2, 3],
        },
      ],
      complete: true,
      warnings: [],
      consumed: { files: 1, entries: 1, bytes: 40 },
    });
  });

  it('keeps the capped and cut flags apart', () => {
    expect(
      readFsGrepResult(
        pageBody([passageBody({ truncated: true, capped: true, cut: true })]),
      ),
    ).toMatchObject({
      ok: true,
      results: [
        {
          path: 'nested/a.go',
          startLine: 2,
          endLine: 3,
          matches: [2, 3],
          truncated: true,
          capped: true,
          cut: true,
        },
      ],
    });
    // A twentieth passage is marked even when the page did not cut it.
    expect(
      readFsGrepResult(pageBody([passageBody({ capped: true })])),
    ).toMatchObject({
      ok: true,
      results: [{ capped: true }],
    });
    expect(
      readFsGrepResult(pageBody([passageBody({ cut: true })])),
    ).toMatchObject({ ok: true, results: [{ cut: true }] });
  });

  it.each([
    ['a NUL in the path', { path: 'a\u0000b' }],
    ['an empty middle segment', { path: 'a//b' }],
    ['a dot segment', { path: 'a/./b' }],
    ['a parent segment', { path: 'a/../b' }],
    ['a start line below one', { startLine: 0, matches: [0] }],
    ['an end line before the start', { startLine: 2, endLine: 1, matches: [] }],
    ['a match before the window', { matches: [1] }],
    ['a match after the window', { matches: [4] }],
    ['a truncation flag that is not true', { truncated: false }],
    ['a capped flag that is not true', { capped: false }],
    ['a cut flag that is not true', { cut: false }],
    ['content that is not text', { content: 7 }],
  ])('refuses a passage with %s', (_case, overrides) => {
    expect(
      readFsGrepResult(pageBody([passageBody(overrides)])),
    ).toBeUndefined();
  });

  it.each([
    ['a kind outside the closed set', [{ kind: 'bogus', count: 1 }]],
    ['an entry that is not a record', [7]],
    ['a count that is not a whole number', [{ kind: 'deadline', count: 1.5 }]],
  ])('refuses a warning with %s', (_case, warnings) => {
    expect(readFsGrepResult(pageBody([], { warnings }))).toBeUndefined();
  });

  it('returns a native refusal unchanged', () => {
    const refusal = {
      status: 'error',
      type: 'not_found',
      message: 'File not found.',
    };
    expect(readFsGrepResult(refusal)).toEqual(refusal);
  });

  it('refuses a body without the success flag', () => {
    expect(readFsGrepResult(pageBody([], { ok: false }))).toBeUndefined();
  });

  it('refuses a cursor that is not text', () => {
    expect(readFsGrepResult(pageBody([], { cursor: 7 }))).toBeUndefined();
  });
});
