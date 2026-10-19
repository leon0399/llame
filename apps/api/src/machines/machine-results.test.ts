import {
  isNativeFailure,
  readFsBytesResult,
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
  it('accepts a file read', () => {
    expect(
      readFsReadResult({
        status: 'success',
        kind: 'file',
        path: 'machine://devl/a',
        content: 'hello',
        truncated: false,
        nextOffset: 0,
      }),
    ).toEqual({
      status: 'success',
      kind: 'file',
      path: 'machine://devl/a',
      content: 'hello',
      truncated: false,
      nextOffset: 0,
    });
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
