import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatReadRepository,
  type ChatReadMessage,
} from '../chats/chat-read-repository';
import {
  MAX_READ_LINES,
  MAX_RESULT_CODE_UNITS,
} from '@workspace/native-file-tools';
import { readChatMessage } from './chat-read-message';
import { measureToolResultForModel } from './model-text';

afterEach(() => vi.restoreAllMocks());

const CHAT_ID = '00000000-0000-0000-0000-000000000001';

const MESSAGE: ChatReadMessage = {
  chatId: CHAT_ID,
  seq: 7,
  role: 'assistant',
  parts: [],
  usage: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  previousMessageSeq: 6,
  nextMessageSeq: 8,
};

function fixture(parts: Array<unknown>) {
  const repository = new ChatReadRepository(drizzle.mock());

  const readMessage = vi.spyOn(repository, 'readMessage').mockResolvedValue({
    ...MESSAGE,
    parts,
  });

  vi.spyOn(repository, 'currentRunStatus').mockResolvedValue('idle');

  return { repository, readMessage };
}

function read(
  parts: Array<unknown>,
  selector?: string,
  path = `chat://${CHAT_ID}/7`,
) {
  const { repository, readMessage } = fixture(parts);

  return {
    readMessage,
    result: readChatMessage({
      repository,
      owner: 'owner',
      chatId: CHAT_ID,
      seq: 7,
      path,
      selector,
    }),
  };
}

describe('readChatMessage selector and result bounds', () => {
  it('uses numbered text by default and raw unnumbered source for the raw selector', async () => {
    const parts = [{ type: 'text', text: 'first\nsecond' }];
    const defaultRead = read(parts);
    await expect(defaultRead.result).resolves.toMatchObject({
      status: 'success',
      representation: 'text',
      content: '1: first\n2: second',
      lineCount: 2,
      shownRange: { startLine: 1, endLine: 2 },
      requestedRange: undefined,
      chatId: CHAT_ID,
      messageSeq: 7,
      role: 'assistant',
      previousMessageSeq: 6,
      nextMessageSeq: 8,
    });

    await expect(read(parts, 'raw').result).resolves.toMatchObject({
      status: 'success',
      representation: 'raw',
      content: 'first\nsecond',
      lineCount: 2,
      shownRange: { startLine: 1, endLine: 2 },
      requestedRange: undefined,
    });
    await expect(read(parts, 'raw:1').result).resolves.toMatchObject({
      status: 'success',
      representation: 'raw',
      content: 'first\n',
      requestedRange: { startLine: 1, endLine: 1 },
      requestedRanges: undefined,
    });
  });

  it('rejects an interleaved representation marker before reading', async () => {
    const { readMessage, result } = read(
      [{ type: 'text', text: 'one' }],
      'L1:raw:L2',
    );

    await expect(result).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_selector',
    });
    expect(readMessage).not.toHaveBeenCalled();
  });

  it('rejects the outline representation for an individual message', async () => {
    const { readMessage, result } = read(
      [{ type: 'text', text: 'one' }],
      'outline',
    );

    await expect(result).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_selector',
    });
    expect(readMessage).not.toHaveBeenCalled();
  });
  it('rejects a parsed multi-range window that starts at the message end', async () => {
    await expect(
      read([{ type: 'text', text: 'one\ntwo' }], 'raw:1,3').result,
    ).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_selector',
    });
  });

  it('keeps exact requested and shown windows for multiple finite raw ranges', async () => {
    await expect(
      read(
        [{ type: 'text', text: 'one\ntwo\nthree\nfour\nfive\nsix' }],
        'raw:2-3,5-5',
      ).result,
    ).resolves.toMatchObject({
      status: 'success',
      representation: 'raw',
      lineCount: 6,
      requestedRanges: [
        { startLine: 2, endLine: 3 },
        { startLine: 5, endLine: 5 },
      ],
      shownRanges: [
        { startLine: 2, endLine: 3 },
        { startLine: 5, endLine: 5 },
      ],
      content: 'two\nthree\nfive\n',
      truncated: false,
    });
  });

  it('caps raw output at whole logical lines and reports the following source offset', async () => {
    const text = Array.from({ length: MAX_READ_LINES + 2 }, () => 'x').join(
      '\n',
    );

    const result = await read([{ type: 'text', text }], 'raw').result;

    expect(result).toMatchObject({
      status: 'success',
      representation: 'raw',
      lineCount: MAX_READ_LINES + 2,
      shownRange: { startLine: 1, endLine: MAX_READ_LINES },
      truncated: true,
      nextOffset: MAX_READ_LINES,
      content: 'x\n'.repeat(MAX_READ_LINES),
    });
  });
  it('appends a complete attachment trailer after a newline-separated message body', async () => {
    const result = await read([
      { type: 'text', text: 'body\n' },
      {
        type: 'file',
        url: 'media://00000000-0000-0000-0000-000000000002',
        mediaType: 'image/png',
        filename: 'photo.png',
      },
    ]).result;

    expect(result).toMatchObject({
      status: 'success',
      content:
        '1: body\n[image media://00000000-0000-0000-0000-000000000002 photo.png]\n',
      truncated: false,
    });
  });
  it('inserts a separator before the attachment trailer when the source lacks a final newline', async () => {
    const result = await read([
      { type: 'text', text: 'body' },
      {
        type: 'file',
        url: 'media://00000000-0000-0000-0000-000000000002',
        mediaType: 'image/png',
        filename: 'photo.png',
      },
    ]).result;

    expect(result).toMatchObject({
      status: 'success',
      content:
        '1: body\n[image media://00000000-0000-0000-0000-000000000002 photo.png]\n',
      truncated: false,
    });
  });

  it('shrinks oversized results only at logical-line boundaries and omits end attachments on the cut prefix', async () => {
    const first = 'a'.repeat(12_000);
    const filename = 'f'.repeat(300);

    const parts = [
      { type: 'text', text: `${first}\n${first}\nlast` },
      {
        type: 'file',
        url: 'media://00000000-0000-0000-0000-000000000002',
        mediaType: 'image/png',
        filename,
      },
    ];

    const result = await read(parts).result;

    expect(result).toMatchObject({
      status: 'success',
      lineCount: 3,
      shownRange: { startLine: 1, endLine: 1 },
      truncated: true,
      nextOffset: 1,
      content: `1: ${first}\n`,
    });
    expect(result.status === 'success' && result.content).not.toContain(
      filename,
    );
    expect(measureToolResultForModel('read')(result)).toBeLessThanOrEqual(
      MAX_RESULT_CODE_UNITS,
    );
  });

  it('returns a bounded-result error when the first source line is oversized', async () => {
    await expect(
      read([{ type: 'text', text: 'x'.repeat(17_000) }]).result,
    ).resolves.toMatchObject({
      status: 'error',
      type: 'representation_too_large',
    });
  });
});
