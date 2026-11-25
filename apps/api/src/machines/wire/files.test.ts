import { PassThrough } from 'node:stream';
import { afterEach, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  EntryKind,
  GetEntryResponseSchema,
  ListDirectoryResponseSchema,
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
const entry = { name: path, kind: EntryKind.FILE, size: 15n };
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
    ({ startLine }) => {
      const firstLine = startLine ?? 1;

      return Promise.resolve(
        create(ReadLinesResponseSchema, {
          result: {
            case: 'lines',
            value: {
              lines: lines.slice(firstLine - 1),
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
    expect(fake.callOptionsSpy).toHaveBeenCalled();
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
});
