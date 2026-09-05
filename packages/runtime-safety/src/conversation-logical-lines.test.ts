import { scanConversationLogicalLines } from './conversation-logical-lines';

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

