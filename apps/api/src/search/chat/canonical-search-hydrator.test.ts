import {
  hydrateCanonicalSearchRows,
  type CanonicalHydrationRow,
} from './canonical-search-hydrator';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const FIRST_MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const EMPTY_MESSAGE_ID = '55555555-5555-4555-8555-555555555555';
const LAST_MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';

function row(
  overrides: Partial<CanonicalHydrationRow> = {},
): CanonicalHydrationRow {
  return {
    message_id: FIRST_MESSAGE_ID,
    message_chat_id: CHAT_ID,
    message_seq: '7',
    message_role: 'user',
    message_parts: [{ type: 'text', text: 'before 😀 after' }],
    message_usage: null,
    message_created_at: new Date('2026-08-27T12:00:00.000Z'),
    first_message_id: FIRST_MESSAGE_ID,
    last_message_id: LAST_MESSAGE_ID,
    first_seq: '7',
    last_seq: '11',
    first_message_text_offset: 7,
    last_message_text_offset_exclusive: 8,
    ...overrides,
  };
}

describe('hydrateCanonicalSearchRows', () => {
  it('maps a bounded source interval to complete canonical message records', () => {
    const result = hydrateCanonicalSearchRows(
      [
        row(),
        row({
          message_id: LAST_MESSAGE_ID,
          message_seq: '11',
          message_role: 'assistant',
          message_parts: [
            { type: 'reasoning', text: 'hidden' },
            { type: 'text', text: 'answer\r\nwith source' },
            { type: 'tool-search', output: 'hidden' },
            { type: 'text', text: 'tail' },
          ],
          message_usage: { status: 'completed' },
        }),
      ],
      { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
    );

    expect(result).toEqual({
      chatId: CHAT_ID,
      messages: [
        {
          messageSeq: 7,
          role: 'user',
          timestamp: new Date('2026-08-27T12:00:00.000Z'),
          visibleText: 'before 😀 after',
          sourceStart: 7,
          sourceEndExclusive: 'before 😀 after'.length,
        },
        {
          messageSeq: 11,
          role: 'assistant',
          timestamp: new Date('2026-08-27T12:00:00.000Z'),
          visibleText: 'answer\r\nwith source\n\ntail',
          sourceStart: 0,
          sourceEndExclusive: 8,
        },
      ],
    });
  });

  it('returns a closed miss when the source rows are not eligible evidence', () => {
    expect(
      hydrateCanonicalSearchRows([row({ message_role: 'tool' })], {
        chatId: CHAT_ID,
        bestDocumentId: DOCUMENT_ID,
      }),
    ).toBeNull();
  });

  it('omits eligible empty intermediate messages while preserving source boundaries', () => {
    const result = hydrateCanonicalSearchRows(
      [
        row(),
        row({
          message_id: EMPTY_MESSAGE_ID,
          message_seq: '9',
          message_parts: [{ type: 'reasoning', text: 'hidden only' }],
        }),
        row({
          message_id: LAST_MESSAGE_ID,
          message_seq: '11',
          message_parts: [{ type: 'text', text: 'last source' }],
        }),
      ],
      { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
    );

    expect(result?.messages).toEqual([
      expect.objectContaining({
        messageSeq: 7,
        sourceStart: 7,
        sourceEndExclusive: 'before 😀 after'.length,
      }),
      expect.objectContaining({
        messageSeq: 11,
        visibleText: 'last source',
        sourceStart: 0,
        sourceEndExclusive: 8,
      }),
    ]);
  });

  it('omits ineligible interior tool and system rows while preserving sequence order', () => {
    const result = hydrateCanonicalSearchRows(
      [
        row(),
        row({
          message_id: EMPTY_MESSAGE_ID,
          message_seq: '9',
          message_role: 'tool',
        }),
        row({
          message_id: '66666666-6666-4666-8666-666666666666',
          message_seq: '10',
          message_role: 'system',
        }),
        row({
          message_id: LAST_MESSAGE_ID,
          message_seq: '11',
          message_role: 'assistant',
          message_usage: { status: 'completed' },
        }),
      ],
      { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
    );

    expect(result?.messages).toEqual([
      expect.objectContaining({ messageSeq: 7 }),
      expect.objectContaining({ messageSeq: 11 }),
    ]);
  });

  it('rejects a zero-visible first or last boundary', () => {
    const empty = {
      message_parts: [{ type: 'reasoning', text: 'hidden only' }],
    };
    expect(
      hydrateCanonicalSearchRows(
        [
          row({
            last_message_id: FIRST_MESSAGE_ID,
            first_seq: '7',
            last_seq: '7',
            message_seq: '7',
            ...empty,
          }),
        ],
        { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
      ),
    ).toBeNull();
    expect(
      hydrateCanonicalSearchRows(
        [
          row(),
          row({
            message_id: LAST_MESSAGE_ID,
            message_seq: '11',
            ...empty,
          }),
        ],
        { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
      ),
    ).toBeNull();
  });

  it('rejects zero-width first, last, and same-message source ranges', () => {
    const textLength = 'before 😀 after'.length;
    expect(
      hydrateCanonicalSearchRows(
        [
          row({ first_message_text_offset: textLength }),
          row({
            message_id: LAST_MESSAGE_ID,
            message_seq: '11',
          }),
        ],
        { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
      ),
    ).toBeNull();
    expect(
      hydrateCanonicalSearchRows(
        [
          row(),
          row({
            message_id: LAST_MESSAGE_ID,
            message_seq: '11',
            last_message_text_offset_exclusive: 0,
          }),
        ],
        { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
      ),
    ).toBeNull();
    expect(
      hydrateCanonicalSearchRows(
        [
          row({
            last_message_id: FIRST_MESSAGE_ID,
            first_seq: '7',
            last_seq: '7',
            message_seq: '7',
            first_message_text_offset: 7,
            last_message_text_offset_exclusive: 7,
          }),
        ],
        { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
      ),
    ).toBeNull();
  });

  it('rejects ineligible tool or system boundary rows', () => {
    expect(
      hydrateCanonicalSearchRows(
        [
          row({ message_role: 'tool' }),
          row({
            message_id: LAST_MESSAGE_ID,
            message_seq: '11',
            message_role: 'assistant',
            message_usage: { status: 'completed' },
          }),
        ],
        { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
      ),
    ).toBeNull();
    expect(
      hydrateCanonicalSearchRows(
        [
          row(),
          row({
            message_id: LAST_MESSAGE_ID,
            message_seq: '11',
            message_role: 'system',
          }),
        ],
        { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
      ),
    ).toBeNull();
  });

  it('rejects a retryable user or assistant interior instead of skipping it', () => {
    expect(
      hydrateCanonicalSearchRows(
        [
          row(),
          row({
            message_id: EMPTY_MESSAGE_ID,
            message_seq: '9',
            message_role: 'assistant',
            message_usage: { status: 'error' },
          }),
          row({
            message_id: LAST_MESSAGE_ID,
            message_seq: '11',
            message_role: 'assistant',
            message_usage: { status: 'completed' },
          }),
        ],
        { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
      ),
    ).toBeNull();
  });

  it('keeps a same-message UTF-16 range and accepts a large safe local sequence', () => {
    const result = hydrateCanonicalSearchRows(
      [
        row({
          last_message_id: FIRST_MESSAGE_ID,
          first_seq: '9007199254740990',
          last_seq: '9007199254740990',
          message_seq: '9007199254740990',
          first_message_text_offset: 7,
          last_message_text_offset_exclusive: 9,
        }),
      ],
      { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
    );

    expect(result?.messages[0]).toMatchObject({
      messageSeq: 9_007_199_254_740_990,
      sourceStart: 7,
      sourceEndExclusive: 9,
    });
  });

  it.each([
    ['missing start offset', { first_message_text_offset: null }],
    ['missing end offset', { last_message_text_offset_exclusive: null }],
    ['negative start offset', { first_message_text_offset: -1 }],
    ['end offset past source', { last_message_text_offset_exclusive: 999 }],
    ['unsafe sequence', { message_seq: '9007199254740992' }],
    ['message out of interval', { message_seq: '3' }],
  ])('returns a closed miss for %s', (_name, overrides) => {
    expect(
      hydrateCanonicalSearchRows([row(overrides)], {
        chatId: CHAT_ID,
        bestDocumentId: DOCUMENT_ID,
      }),
    ).toBeNull();
  });

  it('rejects a reversed same-message range and a non-monotonic interval', () => {
    expect(
      hydrateCanonicalSearchRows(
        [
          row({
            last_message_id: FIRST_MESSAGE_ID,
            first_seq: '7',
            last_seq: '7',
            message_seq: '7',
            first_message_text_offset: 9,
            last_message_text_offset_exclusive: 7,
          }),
        ],
        { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
      ),
    ).toBeNull();

    expect(
      hydrateCanonicalSearchRows(
        [row(), row({ message_id: LAST_MESSAGE_ID, message_seq: '6' })],
        { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
      ),
    ).toBeNull();
  });

  it('rejects malformed parts and metadata from another chat', () => {
    expect(
      hydrateCanonicalSearchRows([row({ message_parts: null })], {
        chatId: CHAT_ID,
        bestDocumentId: DOCUMENT_ID,
      }),
    ).toBeNull();
    expect(
      hydrateCanonicalSearchRows(
        [row({ message_chat_id: '55555555-5555-4555-8555-555555555555' })],
        { chatId: CHAT_ID, bestDocumentId: DOCUMENT_ID },
      ),
    ).toBeNull();
  });
});
