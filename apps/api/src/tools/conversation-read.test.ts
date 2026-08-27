import { drizzle } from 'drizzle-orm/postgres-js';

import {
  MessagesRepository,
  type ConversationMessageLookup,
} from '../chats/chats-repository';
import * as schema from '../db/schema';
import { truncateOversizedResult } from './result-truncation';
import {
  CONVERSATION_HISTORY_NOTICE,
  CONVERSATION_READ_RESULT_MAX_CODE_UNITS,
  conversationReadInputSchema,
  executeConversationRead,
  scanConversationLogicalLines,
} from './conversation-read';
import { conversationSourceCoordinatesSchema } from './conversation-source-coordinates';

const CHAT_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-000000000002';
const CREATED_AT = new Date('2026-08-27T12:00:00.000Z');

function lookup(
  text: string,
  overrides: Partial<ConversationMessageLookup> = {},
): ConversationMessageLookup {
  return {
    chatId: CHAT_ID,
    seq: 7,
    role: 'assistant',
    parts: [{ type: 'text', text }],
    usage: { status: 'completed' },
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function mockDb(result: ConversationMessageLookup | undefined) {
  const db = drizzle.mock({ schema });
  const find = vi
    .spyOn(MessagesRepository.prototype, 'findConversationMessage')
    .mockResolvedValue(result);
  return { db, find };
}

describe('conversation_read input', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts direct search coordinates and defaults offset without weakening them', () => {
    expect(
      conversationSourceCoordinatesSchema.parse({
        chatId: CHAT_ID,
        messageSeq: 7,
        offset: 3,
        limit: 12,
      }),
    ).toEqual({ chatId: CHAT_ID, messageSeq: 7, offset: 3, limit: 12 });
    expect(
      conversationReadInputSchema.parse({ chatId: CHAT_ID, messageSeq: 7 }),
    ).toEqual({ chatId: CHAT_ID, messageSeq: 7, offset: 0 });
    expect(
      conversationReadInputSchema.parse({
        chatId: CHAT_ID,
        messageSeq: 7,
        offset: 3,
        limit: 12,
      }),
    ).toEqual({ chatId: CHAT_ID, messageSeq: 7, offset: 3, limit: 12 });
  });

  it.each([
    ['malformed UUID', { chatId: 'not-a-uuid' }],
    ['unknown property', { source: 'projection' }],
    ['zero sequence', { messageSeq: 0 }],
    ['negative sequence', { messageSeq: -1 }],
    ['fractional sequence', { messageSeq: 1.5 }],
    ['unsafe sequence', { messageSeq: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative offset', { offset: -1 }],
    ['fractional offset', { offset: 1.5 }],
    ['unsafe offset', { offset: Number.MAX_SAFE_INTEGER + 1 }],
    ['zero limit', { limit: 0 }],
    ['limit above maximum', { limit: 2_001 }],
    ['fractional limit', { limit: 1.5 }],
    ['unsafe limit', { limit: Number.MAX_SAFE_INTEGER + 1 }],
  ])('rejects %s before source resolution', (_name, invalid) => {
    expect(() =>
      conversationReadInputSchema.parse({
        chatId: CHAT_ID,
        messageSeq: 7,
        ...invalid,
      }),
    ).toThrow();
  });

  it('rejects invalid runtime input before calling the repository', async () => {
    const { db, find } = mockDb(lookup('not read'));
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
      unknown: true,
    });

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_input',
      message: 'The conversation read arguments are invalid.',
    });
    expect(find).not.toHaveBeenCalled();
  });
});

describe('conversation logical lines', () => {
  it('uses LF delimiters, treats CRLF as one delimiter, and keeps lone CR text', () => {
    expect(
      scanConversationLogicalLines('first\r\nsecond\rthird\nlast'),
    ).toEqual([
      {
        line: 0,
        text: 'first',
        delimiter: '\r\n',
        startOffset: 0,
        endOffsetExclusive: 5,
      },
      {
        line: 1,
        text: 'second\rthird',
        delimiter: '\n',
        startOffset: 7,
        endOffsetExclusive: 19,
      },
      {
        line: 2,
        text: 'last',
        delimiter: '',
        startOffset: 20,
        endOffsetExclusive: 24,
      },
    ]);
  });

  it('counts blanks and does not create a phantom terminal line', () => {
    expect(scanConversationLogicalLines('\n\n')).toEqual([
      {
        line: 0,
        text: '',
        delimiter: '\n',
        startOffset: 0,
        endOffsetExclusive: 0,
      },
      {
        line: 1,
        text: '',
        delimiter: '\n',
        startOffset: 1,
        endOffsetExclusive: 1,
      },
    ]);
    expect(scanConversationLogicalLines('')).toEqual([]);
  });
});

describe('conversation_read execution', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns exact eligible visible text with navigation metadata and closed framing', async () => {
    const { db, find } = mockDb(
      lookup('unused', {
        role: 'user',
        parts: [
          { type: 'text', text: 'alpha' },
          { type: 'reasoning', text: 'excluded' },
          { type: 'text', text: 'beta' },
          { type: 'tool-result', output: 'excluded' },
        ],
        previousMessageSeq: 3,
        nextMessageSeq: 11,
      }),
    );

    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
    });

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(CHAT_ID, OWNER_ID, 7);
    expect(result).toEqual({
      status: 'success',
      chatId: CHAT_ID,
      messageSeq: 7,
      role: 'user',
      timestamp: CREATED_AT.toISOString(),
      offset: 0,
      lineCount: 3,
      content: '1: alpha\n2: \n3: beta',
      previousMessageSeq: 3,
      nextMessageSeq: 11,
      notice: CONVERSATION_HISTORY_NOTICE,
    });
    expect(JSON.stringify(result)).not.toContain('excluded');
  });

  it('uses the same closed source error for misses and empty owners', async () => {
    const missing = mockDb(undefined);
    await expect(
      executeConversationRead(missing.db, OWNER_ID, {
        chatId: CHAT_ID,
        messageSeq: 7,
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'conversation_source_not_found',
      message: 'The conversation source was not found.',
    });
    expect(missing.find).toHaveBeenCalledTimes(1);

    const emptyOwner = mockDb(lookup('must not read'));
    emptyOwner.find.mockClear();
    await expect(
      executeConversationRead(emptyOwner.db, '  ', {
        chatId: CHAT_ID,
        messageSeq: 7,
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'conversation_source_not_found',
      message: 'The conversation source was not found.',
    });
    expect(emptyOwner.find).not.toHaveBeenCalled();
  });

  it('supports direct search coordinates and explicit continuation without a cut reason', async () => {
    const { db } = mockDb(lookup('one\ntwo\nthree\nfour'));
    await expect(
      executeConversationRead(db, OWNER_ID, {
        chatId: CHAT_ID,
        messageSeq: 7,
        offset: 1,
        limit: 2,
      }),
    ).resolves.toMatchObject({
      status: 'success',
      offset: 1,
      lineCount: 2,
      content: '2: two\n3: three\n',
      nextOffset: 3,
    });
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
      offset: 1,
      limit: 2,
    });
    expect(result).not.toHaveProperty('cutReason');
  });

  it('requests the remainder by default and reports an output cut when the serialized bound wins', async () => {
    const text = '\n'.repeat(2_001);
    const { db } = mockDb(lookup(text));
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.lineCount).toBeLessThan(2_000);
    expect(result.nextOffset).toBe(result.lineCount);
    expect(result.cutReason).toBe('output_limit');
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      CONVERSATION_READ_RESULT_MAX_CODE_UNITS,
    );

    const explicit = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
      limit: 2_000,
    });
    expect(explicit.status).toBe('success');
    if (explicit.status !== 'success') return;
    expect(explicit.nextOffset).toBe(explicit.lineCount);
    expect(explicit.cutReason).toBe('output_limit');
  });

  it('uses the complete structured result budget and never generic-truncates success', async () => {
    const text = Array.from(
      { length: 400 },
      (_, index) => `${index.toString().padStart(3, '0')} ${'x'.repeat(70)}`,
    ).join('\n');
    const { db } = mockDb(lookup(text));
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
    });

    expect(result.status).toBe('success');
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      CONVERSATION_READ_RESULT_MAX_CODE_UNITS,
    );
    if (result.status !== 'success') return;
    expect(Number.isSafeInteger(result.nextOffset)).toBe(true);
    expect(result.cutReason).toBe('output_limit');
    expect(truncateOversizedResult(result)).toEqual(result);
  });

  it('rejects a first logical line that cannot fit instead of clipping it', async () => {
    const { db } = mockDb(lookup('😀'.repeat(8_000)));
    await expect(
      executeConversationRead(db, OWNER_ID, {
        chatId: CHAT_ID,
        messageSeq: 7,
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'conversation_limit_exceeded',
      message: 'The conversation read exceeded its output limit.',
    });
  });

  it.each([
    ['empty at zero', '', 0],
    ['CRLF and lone CR', 'first\r\nsecond\rthird\nlast', 0],
    ['stored whitespace', '  first  \n\nlast  ', 0],
  ])('reads %s with source delimiters intact', async (_name, text, offset) => {
    const { db } = mockDb(lookup(text));
    const result = await executeConversationRead(db, OWNER_ID, {
      chatId: CHAT_ID,
      messageSeq: 7,
      offset,
    });
    expect(result.status).toBe('success');
    if (text === 'first\r\nsecond\rthird\nlast') {
      expect(result).toMatchObject({
        content: '1: first\r\n2: second\rthird\n3: last',
      });
    }
  });

  it.each([0, 1, 2, 3])(
    'rejects offset %i when it is outside a three-line message',
    async (offset) => {
      const { db } = mockDb(lookup('a\nb\nc'));
      const result = await executeConversationRead(db, OWNER_ID, {
        chatId: CHAT_ID,
        messageSeq: 7,
        offset: offset === 0 ? 3 : offset,
      });
      if (offset === 0) {
        expect(result).toEqual({
          status: 'error',
          type: 'conversation_range_invalid',
          message: 'The conversation line range is invalid.',
        });
      } else if (offset === 3) {
        expect(result).toEqual({
          status: 'error',
          type: 'conversation_range_invalid',
          message: 'The conversation line range is invalid.',
        });
      } else {
        expect(result.status).toBe('success');
      }
    },
  );

  it('rejects offsets beyond an empty message while allowing its zero-line read', async () => {
    const { db } = mockDb(lookup('', { parts: [] }));
    await expect(
      executeConversationRead(db, OWNER_ID, {
        chatId: CHAT_ID,
        messageSeq: 7,
      }),
    ).resolves.toMatchObject({ status: 'success', lineCount: 0, content: '' });
    await expect(
      executeConversationRead(db, OWNER_ID, {
        chatId: CHAT_ID,
        messageSeq: 7,
        offset: 1,
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'conversation_range_invalid',
      message: 'The conversation line range is invalid.',
    });
  });
});
