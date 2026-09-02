import type {
  CanonicalLinePredicateEvaluator,
  CanonicalSearchMessage,
} from './canonical-search-matcher';
import {
  evaluateCanonicalLinePredicates,
  matchCanonicalSearchPreview,
  scanCanonicalLogicalLines,
} from './canonical-search-matcher';
import { is, SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { PgDialect } from 'drizzle-orm/pg-core';

import * as schema from '../../db/schema';
import type { Db } from '../../db/tenant-db.service';

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

describe('evaluateCanonicalLinePredicates', () => {
  it('returns no matches without executing SQL for an empty query or candidate list', async () => {
    const db: Db = drizzle.mock({ schema });
    const execute = vi.spyOn(db, 'execute');

    await expect(evaluateCanonicalLinePredicates(db, '', [])).resolves.toEqual(
      new Set(),
    );
    await expect(
      evaluateCanonicalLinePredicates(db, 'term', []),
    ).resolves.toEqual(new Set());
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes one owner-scoped predicate and keeps only safe candidate ids', async () => {
    const db: Db = drizzle.mock({ schema });
    const execute = vi.spyOn(db, 'execute').mockResolvedValue(
      Object.assign(
        [
          { line_id: 1 },
          { line_id: '2' },
          { line_id: '3' },
          { line_id: '9007199254740992' },
          { line_id: 'not-a-number' },
        ],
        {
          columns: [],
          count: 5,
          command: 'SELECT',
          statement: { name: '', string: '', types: [], columns: [] },
          state: { status: 'I', pid: 0, secret: 0 },
        },
      ),
    );

    await expect(
      evaluateCanonicalLinePredicates(db, String.raw`a\\b%_`, [
        { id: 1, normalizedText: 'first' },
        { id: 2, normalizedText: 'second' },
      ]),
    ).resolves.toEqual(new Set([1, 2]));

    expect(execute).toHaveBeenCalledTimes(1);
    const statement = execute.mock.calls[0]?.[0];
    if (!is(statement, SQL)) throw new Error('expected a SQL statement');
    const query = new PgDialect().sqlToQuery(statement);
    expect(query.sql).toContain('ILIKE');
    expect(query.params).toContain(String.raw`a\\b%_`);
    const slash = String.fromCharCode(92);
    expect(query.params).toContain(
      '%a' + slash.repeat(4) + 'b' + slash + '%' + slash + '_%',
    );
  });
});

describe('matchCanonicalSearchPreview', () => {
  it('returns null when the evaluator finds no candidate lines', async () => {
    const evaluate = matchingLines(() => false);

    await expect(
      matchCanonicalSearchPreview(
        { chatId: 'chat-1', messages: [message(10, 'source')] },
        'source',
        evaluate,
      ),
    ).resolves.toBeNull();
  });

  it('rejects non-finite and fractional source coordinates before evaluation', async () => {
    const evaluate = vi.fn<CanonicalLinePredicateEvaluator>();

    for (const sourceRange of [
      [Number.NaN, 3],
      [0, Number.POSITIVE_INFINITY],
      [0.5, 3],
    ] as const) {
      await expect(
        matchCanonicalSearchPreview(
          {
            chatId: 'chat-1',
            messages: [message(10, 'source', sourceRange[0], sourceRange[1])],
          },
          'source',
          evaluate,
        ),
      ).resolves.toBeNull();
    }

    expect(evaluate).not.toHaveBeenCalled();
  });

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

  it('maps a combining-mark normalization back to one raw source span', async () => {
    const text = 'before\ne\u0301lan\nafter';
    const start = text.indexOf('e\u0301');
    const result = await matchCanonicalSearchPreview(
      { chatId: 'chat-1', messages: [message(10, text)] },
      'élan',
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(result?.anchor).toEqual({
      line: 1,
      startOffset: start,
      endOffsetExclusive: start + 'e\u0301lan'.length,
      kind: 'exact',
    });
  });

  it('keeps an astral combining mark inside one raw mapping fragment', async () => {
    const mark = '\u{1D165}';
    const text = `before\na${mark}b\nafter`;
    const start = text.indexOf(`a${mark}`);
    const result = await matchCanonicalSearchPreview(
      { chatId: 'chat-1', messages: [message(10, text)] },
      `a${mark}`,
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(result?.anchor).toEqual({
      line: 1,
      startOffset: start,
      endOffsetExclusive: start + `a${mark}`.length,
      kind: 'exact',
    });
  });

  it('maps a collapsed whitespace match after trimming the raw line edges', async () => {
    const text = 'before\n  Alpha   Beta  \nafter';
    const start = text.indexOf('Alpha');
    const result = await matchCanonicalSearchPreview(
      { chatId: 'chat-1', messages: [message(10, text)] },
      'alpha beta',
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(result?.anchor).toEqual({
      line: 1,
      startOffset: start,
      endOffsetExclusive: start + 'Alpha   Beta'.length,
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

  it('starts a separate passage after a gap and selects the earliest offset on a sequence tie', async () => {
    const result = await matchCanonicalSearchPreview(
      {
        chatId: 'chat-1',
        messages: [
          message(10, 'far\nline\nline\nneedle'),
          message(10, 'needle'),
        ],
      },
      'needle',
      matchingLines((line, normalizedQuery) => line.includes(normalizedQuery)),
    );

    expect(result).toMatchObject({
      message: { messageSeq: 10 },
      offset: 0,
      limit: 1,
      lines: [{ line: 0, text: 'needle' }],
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

  it('returns null without evaluating a message whose source range is invalid', async () => {
    const evaluate = vi.fn<CanonicalLinePredicateEvaluator>();

    await expect(
      matchCanonicalSearchPreview(
        {
          chatId: 'chat-1',
          messages: [message(10, 'source', -1, 3)],
        },
        'source',
        evaluate,
      ),
    ).resolves.toBeNull();

    expect(evaluate).not.toHaveBeenCalled();
  });

  it('skips an empty source intersection while evaluating later non-empty lines', async () => {
    const calls: Array<{
      normalizedQuery: string;
      normalizedLines: ReadonlyArray<string>;
    }> = [];
    const text = '\nneedle';

    await expect(
      matchCanonicalSearchPreview(
        { chatId: 'chat-1', messages: [message(10, text, 1)] },
        'needle',
        matchingLines(
          (line, normalizedQuery) => line.includes(normalizedQuery),
          calls,
        ),
      ),
    ).resolves.toMatchObject({
      offset: 0,
      limit: 2,
      anchor: { line: 1, kind: 'exact' },
    });

    expect(calls[0]?.normalizedLines).toEqual(['needle']);
  });

  it('preserves input order when two messages have the same sequence', async () => {
    const first = message(10, 'first term');
    const second = message(10, 'second term');

    await expect(
      matchCanonicalSearchPreview(
        { chatId: 'chat-1', messages: [first, second] },
        'term',
        matchingLines(() => true),
      ),
    ).resolves.toMatchObject({
      message: { messageSeq: 10 },
      lines: [{ text: 'first term' }],
    });
  });
});
