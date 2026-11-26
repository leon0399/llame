import { Code, ConnectError } from '@connectrpc/connect';

import { PassThrough } from 'node:stream';
import { afterEach, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  EntryKind,
  GetEntryResponseSchema,
  ListDirectoryResponseSchema,
  MEDIA_MAX_BYTES,
  ReadBytesResponseSchema,
  ReadLinesResponseSchema,
  ReplaceTextResponseSchema,
  WriteFileResponseSchema,
} from '@workspace/machine-protocol';
import {
  renderEditText,
  renderReadText,
  renderWriteText,
} from '@workspace/native-file-tools';
import { MachineSession } from '../machine-session.js';
import {
  bytesHandler,
  editHandler,
  listHandler,
  readHandler,
  statHandler,
  writeHandler,
} from './files.js';

const path = '/work/notes.md';

const entry = {
  name: path,
  kind: EntryKind.FILE,
  size: 15n,
  canonicalPath: path,
};

const lines = ['# Title', 'first', 'second', 'third'];

const sessions: Array<MachineSession> = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
});

const session = () => {
  const connection = new PassThrough();

  const session = new MachineSession({
    name: 'files-test',
    hubVersion: 'test',
    transport: {
      input: connection,
      output: connection,
      close: () => connection.end(),
      ended: new Promise(() => undefined),
    },
  });

  sessions.push(session);

  vi.spyOn(session.clients.files, 'getEntry').mockResolvedValue(
    create(GetEntryResponseSchema, { result: { case: 'entry', value: entry } }),
  );
  vi.spyOn(session.clients.files, 'listDirectory').mockResolvedValue(
    create(ListDirectoryResponseSchema, {
      result: {
        case: 'directory',
        value: {
          entries: [{ name: 'notes.md', kind: EntryKind.FILE }],
          total: 1,
        },
      },
    }),
  );
  vi.spyOn(session.clients.files, 'readLines').mockImplementation(
    ({ startLine, limit }) => {
      const firstLine = startLine ?? 1;

      return Promise.resolve(
        create(ReadLinesResponseSchema, {
          result: {
            case: 'lines',
            value: {
              lines: lines.slice(firstLine - 1, firstLine - 1 + (limit ?? 0)),
              startLine: firstLine,
              lineCount: lines.length,
              lineEnding: '\n',
              truncated: false,
            },
          },
        }),
      );
    },
  );

  vi.spyOn(session.clients.files, 'replaceText').mockResolvedValue(
    create(ReplaceTextResponseSchema, {
      result: {
        case: 'replaced',
        value: { startLine: 3, lineCount: 4 },
      },
    }),
  );
  vi.spyOn(session.clients.files, 'writeFile').mockResolvedValue(
    create(WriteFileResponseSchema, {
      result: { case: 'written', value: { created: true, size: 4n } },
    }),
  );
  vi.spyOn(session.clients.files, 'readBytes').mockImplementation(() =>
    (async function* () {
      await Promise.resolve();
      yield create(ReadBytesResponseSchema, {
        result: { case: 'size', value: 12n },
      });
      yield create(ReadBytesResponseSchema, {
        result: {
          case: 'chunk',
          value: new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          ]),
        },
      });
    })(),
  );

  const callOptionsSpy = vi.spyOn(session, 'callOptions');

  return Object.assign(session, { callOptionsSpy });
};

const envelope = { budgetMs: 1000 };
const display = { displayPrefix: 'machine://test' };

describe('wire file handlers', () => {
  it('maps stat and list primitives', async () => {
    const fake = session();
    await expect(statHandler(fake, { envelope, path })).resolves.toEqual({
      kind: 'file',
      size: 15,
      realPath: path,
      isLink: false,
    });
    await expect(
      listHandler(fake, { envelope, path: '/work' }),
    ).resolves.toEqual({
      entries: [{ name: 'notes.md', kind: 'file' }],
      totalCount: 1,
      truncated: false,
    });
  });
  it('reads a directory tree and preserves entry and symlink kinds', async () => {
    const fake = session();
    vi.mocked(fake.clients.files.getEntry).mockResolvedValue(
      create(GetEntryResponseSchema, {
        result: {
          case: 'entry',
          value: { name: '/work', kind: EntryKind.DIRECTORY },
        },
      }),
    );
    vi.mocked(fake.clients.files.listDirectory).mockImplementation(
      ({ path: directory }) =>
        Promise.resolve(
          create(ListDirectoryResponseSchema, {
            result: {
              case: 'directory',
              value:
                directory === '/work'
                  ? {
                      entries: [
                        { name: 'notes.md', kind: EntryKind.FILE },
                        { name: 'nested', kind: EntryKind.DIRECTORY },
                        {
                          name: 'linked',
                          kind: EntryKind.SYMLINK,
                          linkTarget: 'notes.md',
                          targetKind: EntryKind.FILE,
                        },
                        { name: 'socket', kind: EntryKind.OTHER },
                      ],
                      total: 4,
                    }
                  : {
                      entries: [{ name: 'child.md', kind: EntryKind.FILE }],
                      total: 1,
                    },
            },
          }),
        ),
    );

    const result = await readHandler(fake, {
      envelope,
      path: '/work',
      options: display,
    });

    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      path: 'machine://test/work',
      entryCount: 4,
    });

    if (result.status === 'success' && result.kind === 'directory') {
      expect(result.content).toContain('notes.md');
      expect(result.content).toContain('nested/');
      expect(result.content).toContain('linked@ -> notes.md');
      expect(result.content).toContain('socket');
      expect(result.content).toContain('child.md');
    }

    expect(fake.clients.files.listDirectory).toHaveBeenCalledWith(
      { path: '/work/nested', offset: 0, limit: 1 },
      expect.anything(),
    );
  });

  it('reports the daemon canonical target for a symlink stat', async () => {
    const fake = session();
    vi.mocked(fake.clients.files.getEntry).mockResolvedValue(
      create(GetEntryResponseSchema, {
        result: {
          case: 'entry',
          value: {
            name: '/work/link.md',
            kind: EntryKind.SYMLINK,
            canonicalPath: '/work/target.md',
          },
        },
      }),
    );

    await expect(
      statHandler(fake, { envelope, path: '/work/link.md' }),
    ).resolves.toEqual({
      kind: 'other',
      realPath: '/work/target.md',
      isLink: true,
    });
  });

  it('bounds a selected line read to the selector window', async () => {
    const fake = session();

    await readHandler(fake, {
      envelope,
      path,
      options: { ...display, selector: 'L1-20' },
    });

    expect(fake.clients.files.readLines).toHaveBeenCalledTimes(1);
    const request = vi.mocked(fake.clients.files.readLines).mock.calls[0]?.[0];
    expect(request).toMatchObject({ startLine: 1 });
    expect(request?.limit).toBeLessThanOrEqual(22);
  });
  it('reads a later absolute selector window with source line numbers', async () => {
    const fake = session();
    vi.mocked(fake.clients.files.readLines).mockImplementation(
      ({ startLine, limit }) =>
        Promise.resolve(
          create(ReadLinesResponseSchema, {
            result: {
              case: 'lines',
              value: {
                lines: Array.from(
                  { length: limit ?? 0 },
                  (_, index) => `line ${(startLine ?? 1) + index}`,
                ),
                startLine: startLine ?? 1,
                lineCount: 500,
                lineEnding: '\n',
                truncated: false,
              },
            },
          }),
        ),
    );

    const result = await readHandler(fake, {
      envelope,
      path,
      options: { ...display, selector: 'L300-302' },
    });

    expect(fake.clients.files.readLines).toHaveBeenCalledWith(
      expect.objectContaining({ startLine: 299, limit: 5 }),
      expect.anything(),
    );
    expect(renderReadText(result)).toContain(
      'machine://test/work/notes.md:L299-303 of 500 lines\n299: line 299\n300: line 300\n301: line 301\n302: line 302\n303: line 303',
    );
  });

  it('renders a selected markdown window using the native read renderer', async () => {
    const result = await readHandler(session(), {
      envelope,
      path,
      options: { ...display, selector: 'L2-3' },
    });

    expect(renderReadText(result)).toBe(
      'machine://test/work/notes.md:L1-4 of 4 lines\n1: # Title\n2: first\n3: second\n4: third',
    );
  });

  it('renders multi-range and outline reads with native engine output', async () => {
    const fake = session();

    const multi = await readHandler(fake, {
      envelope,
      path,
      options: { ...display, selector: '1,3' },
    });

    expect(renderReadText(multi)).toBe(
      'machine://test/work/notes.md:L1-4 of 4 lines\n1: # Title\n2: first\n3: second\n4: third',
    );

    const outline = await readHandler(fake, {
      envelope,
      path,
      options: { ...display, selector: 'outline' },
    });

    expect(outline).toMatchObject({
      status: 'success',
      representation: 'outline',
    });
  });

  it('renders edit and write results with the native mutation renderers', async () => {
    const fake = session();

    const edited = await editHandler(fake, {
      envelope,
      path,
      options: display,
      oldText: 'second',
      newText: 'changed',
    });

    expect(renderEditText(edited)).toBe(
      'edited machine://test/work/notes.md: line 3, 1 -> 1 line (4 lines total)\n1: # Title\n2: first\n3: second\n4: third',
    );

    const written = await writeHandler(fake, {
      envelope,
      path,
      options: display,
      content: 'new\n',
    });

    expect(renderWriteText(written)).toBe(
      'created machine://test/work/notes.md (1 line)',
    );
    expect(fake.clients.files.writeFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ createParents: true }),
      expect.anything(),
    );

    await writeHandler(fake, {
      envelope,
      path,
      options: display,
      content: 'replacement\n',
      replace: true,
    });

    expect(fake.clients.files.writeFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ createParents: false }),
      expect.anything(),
    );
    expect(fake.callOptionsSpy).toHaveBeenCalled();
  });
  it('marks a lost write reply as an uncertain dispatched mutation', async () => {
    const fake = session();
    vi.mocked(fake.clients.files.writeFile).mockRejectedValue(
      new ConnectError('connection lost', Code.Unavailable),
    );

    await expect(
      writeHandler(fake, {
        envelope,
        path,
        options: display,
        content: 'possibly written\n',
      }),
    ).rejects.toMatchObject({ name: 'MachineUnavailableError', sent: true });
  });

  it('streams and sniffs fs.bytes chunks', async () => {
    const onNotification = vi.fn();
    await expect(
      bytesHandler(session(), { envelope, path }, { onNotification }),
    ).resolves.toEqual({ size: 12, mediaType: 'image/png' });
    expect(onNotification).toHaveBeenCalledWith({
      method: 'bytes',
      params: { seq: 0, data: 'iVBORw0KGgo=' },
    });
  });
  it('refuses a large non-media byte stream before transferring its body', async () => {
    const fake = session();
    const transferred: Array<number> = [];
    const readBytes = vi.mocked(fake.clients.files.readBytes);
    readBytes.mockImplementation(({ limit }) =>
      (async function* () {
        await Promise.resolve();
        expect(limit).toBe(BigInt(MEDIA_MAX_BYTES));
        yield create(ReadBytesResponseSchema, {
          result: { case: 'size', value: 100n * 1024n * 1024n },
        });
        transferred.push(1);
        yield create(ReadBytesResponseSchema, {
          result: { case: 'chunk', value: new Uint8Array(8192).fill(0x41) },
        });
        transferred.push(2);
        yield create(ReadBytesResponseSchema, {
          result: { case: 'chunk', value: new Uint8Array(8192).fill(0x42) },
        });
      })(),
    );

    const onNotification = vi.fn();
    await expect(
      bytesHandler(fake, { envelope, path }, { onNotification }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'unsupported_media_type',
    });
    expect(transferred).toEqual([1]);
    expect(onNotification).not.toHaveBeenCalled();
    expect(readBytes).toHaveBeenCalledWith(
      expect.objectContaining({ limit: BigInt(MEDIA_MAX_BYTES) }),
      expect.anything(),
    );
  });
});
