import type {
  CanonicalLinePredicateEvaluator,
  CanonicalSearchMessage,
} from './canonical-search-matcher';
import {
  matchCanonicalSearchPreview,
  scanCanonicalLogicalLines,
} from './canonical-search-matcher';

const timestamp = new Date('2026-08-27T12:00:00.000Z');

// No test varies the role — every fixture is an assistant message.
function message(
  messageSeq: number,
  visibleText: string,
  sourceStart = 0,
  sourceEndExclusive = visibleText.length,
): CanonicalSearchMessage {
  return {
    messageSeq,
    role: 'assistant',
    timestamp,
    visibleText,
    sourceStart,
    sourceEndExclusive,
  };
}

function matchingLines(
  predicate: (normalizedText: string, normalizedQuery: string) => boolean,
  calls: Array<{
    normalizedQuery: string;
    normalizedLines: ReadonlyArray<string>;
  }> = [],
): CanonicalLinePredicateEvaluator {
  return (normalizedQuery, lines) => {
    calls.push({
      normalizedQuery,
      normalizedLines: lines.map((line) => line.normalizedText),
    });
    return Promise.resolve(
      new Set(
        lines
          .filter((line) => predicate(line.normalizedText, normalizedQuery))
          .map((line) => line.id),
      ),
    );
  };
}

describe('scanCanonicalLogicalLines', () => {
  it('uses LF delimiters, treats CRLF as one delimiter, and keeps lone CR text', () => {
    expect(scanCanonicalLogicalLines('first\r\nsecond\rthird\nlast')).toEqual([
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

  it('counts blank lines and does not create a phantom terminal line', () => {
    expect(scanCanonicalLogicalLines('\n\n')).toEqual([
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
    expect(scanCanonicalLogicalLines('')).toEqual([]);
  });
});

describe('matchCanonicalSearchPreview', () => {
  it.each([
    ['exact', 'Needle', 'needle'],
    ['case-only', 'NEEDLE', 'needle'],
    ['NFKC', 'Ｆｕｌｌｗｉｄｔｈ', 'fullwidth'],
    ['whitespace collapse', 'alpha   beta', 'alpha beta'],
  ])(
    'matches %s text and returns original raw lines',
    async (_name, text, query) => {
      const result = await matchCanonicalSearchPreview(
        {
          chatId: 'chat-1',
          messages: [message(10, `before\n${text}\nafter`)],
        },
        query,
        matchingLines((line, normalizedQuery) =>
          line.includes(normalizedQuery),
        ),
      );

      expect(result).toMatchObject({
        message: { messageSeq: 10, role: 'assistant', timestamp },
        offset: 0,
        limit: 3,
        anchor: { line: 1, kind: 'exact' },
        lines: [
          { line: 0, text: 'before' },
          { line: 1, text },
          { line: 2, text: 'after' },
        ],
      });
      expect(result?.lines.map((line) => line.delimiter)).toEqual([
        '\n',
        '\n',
        '',
      ]);
    },
  );

  it('normalizes the query and each source intersection once while preserving raw source', async () => {
    const calls: Array<{
      normalizedQuery: string;
      normalizedLines: ReadonlyArray<string>;
    }> = [];
    await matchCanonicalSearchPreview(
      {
        chatId: 'chat-1',
        messages: [message(10, 'before\n  Raw   Text  \nafter')],
      },
      ' RAW text ',
      matchingLines(
        (line, normalizedQuery) => line.includes(normalizedQuery),
        calls,
      ),
    );

    expect(calls).toEqual([
      {
        normalizedQuery: 'raw text',
        normalizedLines: ['before', 'raw text', 'after'],
      },
    ]);
  });

  it('maps the first repeated normalized occurrence to the raw source span', async () => {
    const text = 'prefix\nNeedle and needle\nsuffix';
    const result = await matchCanonicalSearchPreview(
      { chatId: 'chat-1', messages: [message(10, text)] },
      'needle',
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(result?.anchor).toEqual({
      line: 1,
      startOffset: text.indexOf('Needle'),
      endOffsetExclusive: text.indexOf('Needle') + 'Needle'.length,
      kind: 'exact',
    });
  });

  it('maps NFKC and collapsed-whitespace matches only when the raw span verifies', async () => {
    const text = 'before\nＦｏｏ   bar\nafter';
    const start = text.indexOf('Ｆ');
    const result = await matchCanonicalSearchPreview(
      { chatId: 'chat-1', messages: [message(10, text)] },
      'foo bar',
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(result?.anchor).toEqual({
      line: 1,
      startOffset: start,
      endOffsetExclusive: start + 'Ｆｏｏ   bar'.length,
      kind: 'exact',
    });
  });

  it('uses the first raw code point of the qualifying source intersection for fuzzy/FTS matches', async () => {
    const text = 'prefix\n😀 typo candidate\nsuffix';
    const sourceStart = text.indexOf('😀');
    const result = await matchCanonicalSearchPreview(
      {
        chatId: 'chat-1',
        messages: [
          message(10, text, sourceStart, text.length - 'suffix'.length),
        ],
      },
      'different query',
      matchingLines(() => true),
    );

    expect(result?.anchor).toEqual({
      line: 1,
      startOffset: sourceStart,
      endOffsetExclusive: sourceStart + 2,
      kind: 'fallback',
    });
  });

  it('falls back when a normalized occurrence cannot represent an exact raw span', async () => {
    const text = 'start\nİstanbul\nsuffix';
    const result = await matchCanonicalSearchPreview(
      { chatId: 'chat-1', messages: [message(10, text)] },
      'i',
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(result?.anchor).toEqual({
      line: 1,
      startOffset: text.indexOf('İ'),
      endOffsetExclusive: text.indexOf('İ') + 1,
      kind: 'fallback',
    });
  });

  it('tries later normalized occurrences when an earlier raw span cannot verify', async () => {
    const text = 'start\nİ i\nend';
    const laterOccurrence = text.indexOf('i', text.indexOf('İ') + 1);
    const result = await matchCanonicalSearchPreview(
      { chatId: 'chat-1', messages: [message(10, text)] },
      'i',
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(result?.anchor).toEqual({
      line: 1,
      startOffset: laterOccurrence,
      endOffsetExclusive: laterOccurrence + 1,
      kind: 'exact',
    });
  });

  it('maps context-sensitive Greek final sigma using whole-string lowercasing', async () => {
    const text = 'start\nΟΣ\nend';
    const start = text.indexOf('ΟΣ');
    const result = await matchCanonicalSearchPreview(
      { chatId: 'chat-1', messages: [message(10, text)] },
      'ος',
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(result?.anchor).toEqual({
      line: 1,
      startOffset: start,
      endOffsetExclusive: start + 'ΟΣ'.length,
      kind: 'exact',
    });
  });

  it('keeps source boundaries line-local while retaining whole context lines', async () => {
    const text = 'before needle after\nother';
    const sourceStart = text.indexOf('needle');
    const sourceEndExclusive = sourceStart + 'needle'.length;
    const result = await matchCanonicalSearchPreview(
      {
        chatId: 'chat-1',
        messages: [message(10, text, sourceStart, sourceEndExclusive)],
      },
      'needle',
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(result?.lines).toEqual([
      {
        line: 0,
        text: 'before needle after',
        delimiter: '\n',
        startOffset: 0,
        endOffsetExclusive: 'before needle after'.length,
      },
      {
        line: 1,
        text: 'other',
        delimiter: '',
        startOffset: text.indexOf('other'),
        endOffsetExclusive: text.length,
      },
    ]);
    expect(result?.anchor).toMatchObject({
      startOffset: sourceStart,
      endOffsetExclusive: sourceEndExclusive,
      kind: 'exact',
    });
  });

  it('omits matches that exist only across logical lines or messages', async () => {
    const evaluate = matchingLines((line, normalizedQuery) =>
      line.includes(normalizedQuery),
    );
    await expect(
      matchCanonicalSearchPreview(
        {
          chatId: 'chat-1',
          messages: [message(10, 'alpha\nbeta'), message(20, 'gamma')],
        },
        'alpha beta',
        evaluate,
      ),
    ).resolves.toBeNull();
  });

  it('omits query terms split across separate messages', async () => {
    await expect(
      matchCanonicalSearchPreview(
        {
          chatId: 'chat-1',
          messages: [message(10, 'alpha'), message(20, 'beta')],
        },
        'alpha beta',
        matchingLines((line, normalizedQuery) =>
          line.includes(normalizedQuery),
        ),
      ),
    ).resolves.toBeNull();
  });

  it('merges touching one-line windows and chooses the earliest message/offset independent of ranking order', async () => {
    const result = await matchCanonicalSearchPreview(
      {
        chatId: 'chat-1',
        messages: [
          message(20, 'later\nneedle\nlater'),
          message(10, 'needle\nnear\nneedle\nfar'),
        ],
      },
      'needle',
      (_query, lines) =>
        Promise.resolve(
          new Set(
            lines
              .slice()
              .reverse()
              .map((line) => line.id),
          ),
        ),
    );

    expect(result).toMatchObject({
      message: { messageSeq: 10 },
      offset: 0,
      limit: 4,
      lines: [
        { line: 0, text: 'needle' },
        { line: 1, text: 'near' },
        { line: 2, text: 'needle' },
        { line: 3, text: 'far' },
      ],
    });
  });

  it('partitions a long merged interval into adjacent bounded passages retaining matches and selects the earliest', async () => {
    const lines = Array.from({ length: 2501 }, (_value, index) =>
      index % 2 === 0 ? `needle ${index}` : `line ${index}`,
    );
    const passages = await matchCanonicalSearchPreview(
      { chatId: 'chat-1', messages: [message(10, lines.join('\n'))] },
      'needle',
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(passages).toMatchObject({ offset: 0, limit: 2000 });
    expect(passages?.lines).toHaveLength(2000);
    expect(passages?.lines[0]).toMatchObject({ line: 0, text: 'needle 0' });
    expect(passages?.lines.at(-1)?.text).toBe('line 1999');
    expect(passages?.anchor.line).toBe(0);
  });

  it('moves the final qualifying match into the tail partition when context would otherwise be lost', async () => {
    const lines = Array.from({ length: 2001 }, (_value, index) =>
      index % 3 === 1 ? `needle ${index}` : `line ${index}`,
    );
    const result = await matchCanonicalSearchPreview(
      { chatId: 'chat-1', messages: [message(10, lines.join('\n'))] },
      'needle',
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(result).toMatchObject({ offset: 0, limit: 1999 });
    expect(result?.lines).toHaveLength(1999);
    expect(result?.lines.at(-1)?.text).toBe('line 1998');
  });

  it('handles Unicode code units and code points in line offsets and fallback anchors', async () => {
    const text = '😀 first\nsecond';
    const result = await matchCanonicalSearchPreview(
      { chatId: 'chat-1', messages: [message(10, text)] },
      'typo',
      matchingLines(() => true),
    );

    expect(result?.lines[0]).toEqual({
      line: 0,
      text: '😀 first',
      delimiter: '\n',
      startOffset: 0,
      endOffsetExclusive: '😀 first'.length,
    });
    expect(result?.anchor).toEqual({
      line: 0,
      startOffset: 0,
      endOffsetExclusive: 2,
      kind: 'fallback',
    });
  });

  it('returns null for an empty normalized query without invoking the database predicate', async () => {
    const evaluate = vi.fn<CanonicalLinePredicateEvaluator>();
    await expect(
      matchCanonicalSearchPreview(
        { chatId: 'chat-1', messages: [message(10, 'source')] },
        '   ',
        evaluate,
      ),
    ).resolves.toBeNull();
    expect(evaluate).not.toHaveBeenCalled();
  });
});
