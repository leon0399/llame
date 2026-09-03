import { ZodError } from 'zod';

import { parseConversationSourceCoordinates } from './conversation-source-coordinates';

const CHAT_ID = '00000000-0000-4000-8000-000000000001';

describe('conversation source coordinates', () => {
  it('parses the exact line-read coordinate shape unchanged', () => {
    const coordinates = {
      chatId: CHAT_ID,
      messageSeq: 7,
      offset: 3,
      limit: 12,
    };

    expect(parseConversationSourceCoordinates(coordinates)).toEqual(
      coordinates,
    );
  });

  it.each([
    ['malformed chat id', { chatId: 'not-a-uuid' }],
    ['zero message sequence', { messageSeq: 0 }],
    ['negative message sequence', { messageSeq: -1 }],
    ['fractional message sequence', { messageSeq: 1.5 }],
    ['unsafe message sequence', { messageSeq: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative offset', { offset: -1 }],
    ['fractional offset', { offset: 1.5 }],
    ['unsafe offset', { offset: Number.MAX_SAFE_INTEGER + 1 }],
    ['zero limit', { limit: 0 }],
    ['limit above reader maximum', { limit: 2001 }],
    ['fractional limit', { limit: 1.5 }],
    ['unknown property', { source: 'projection' }],
  ])('rejects %s before a source can be read', (_label, invalid) => {
    expect(() =>
      parseConversationSourceCoordinates({
        chatId: CHAT_ID,
        messageSeq: 7,
        offset: 0,
        limit: 1,
        ...invalid,
      }),
    ).toThrow(ZodError);
  });
});
