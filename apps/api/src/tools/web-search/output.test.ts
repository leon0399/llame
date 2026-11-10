import { parseWebLocator } from '../web-read/locator';
import {
  canonicalUrl as canonicalizeSearchUrl,
  normalizeFullOutput,
  normalizeOutput as normalizeSearchOutput,
  type WebSearchSuccess,
} from './output';
import { renderWebSearchOutput } from './text';

function renderedLength(output: WebSearchSuccess): number {
  return renderWebSearchOutput(output)?.text.length ?? 0;
}

import {
  type RawCitation,
  type RawResult,
  type SearchChainSuccess,
} from './chain';

type ResultSource = Extract<SearchChainSuccess, { kind: 'results' }>;

type AnswerSource = Extract<SearchChainSuccess, { kind: 'answer' }>;

const resultsSource = (
  results: ReadonlyArray<RawResult>,
  notes?: ReadonlyArray<string>,
  query = 'query',
): ResultSource => {
  const source: ResultSource = {
    kind: 'results',
    engine: 'brave',
    query,
    results,
  };

  return notes === undefined ? source : { ...source, notes };
};

const answerSource = (
  answer: string,
  citations: ReadonlyArray<RawCitation>,
  query = 'query',
  notes?: ReadonlyArray<string>,
): AnswerSource => {
  const source: AnswerSource = {
    kind: 'answer',
    engine: 'hosted',
    query,
    answer,
    citations,
  };

  return notes === undefined ? source : { ...source, notes };
};

const result = (url: string, index = 0): RawResult => ({
  title: `Title ${index}`,
  url,
});

it('drops unsafe URLs and canonicalizes fragments and hosts', () => {
  const output = normalizeSearchOutput(
    resultsSource([
      result('javascript:alert(1)'),
      result('https://user:pw@example.com/a'),
      result('https://Example.com/a#top'),
    ]),
    10,
  );

  expect(output).toMatchObject({
    kind: 'results',
    results: [{ title: 'Title 0', url: 'https://example.com/a' }],
  });
  expect(output).not.toHaveProperty('notes');
});

it('keeps HTTP URLs and drops either kind of URL userinfo', () => {
  expect(canonicalizeSearchUrl('http://Example.com/a')).toBe(
    'http://example.com/a',
  );
  expect(canonicalizeSearchUrl('https://user@example.com/a')).toBeUndefined();
  expect(
    canonicalizeSearchUrl('https://:password@example.com/a'),
  ).toBeUndefined();
  expect(canonicalizeSearchUrl('not a url')).toBeUndefined();
  expect(canonicalizeSearchUrl('')).toBeUndefined();
});

it('does not encode a colon when a URL has a query', () => {
  expect(
    canonicalizeSearchUrl(
      'https://en.wikipedia.org/wiki/Category:Search_engines?source=web',
    ),
  ).toBe('https://en.wikipedia.org/wiki/Category:Search_engines?source=web');
});

it('drops URLs longer than the locator bound but keeps the exact bound', () => {
  const prefix = 'https://example.test/';
  const exact = `${prefix}${'x'.repeat(2048 - prefix.length)}`;
  expect(exact).toHaveLength(2048);
  expect(canonicalizeSearchUrl(exact)).toBe(exact);
  expect(canonicalizeSearchUrl(`${exact}x`)).toBeUndefined();
});

it('encodes a literal colon in a query-free last path segment', () => {
  const url = canonicalizeSearchUrl(
    'https://en.wikipedia.org/wiki/Category:Search_engines',
  );

  expect(url).toBe('https://en.wikipedia.org/wiki/Category%3ASearch_engines');

  if (url === undefined) throw new Error('expected a canonical URL');
  expect(parseWebLocator(url)).toEqual({ url });
});

it('cuts snippets at the UTF-16 bound and keeps valid dates only', () => {
  const output = normalizeSearchOutput(
    resultsSource([
      {
        title: 'Title',
        url: 'https://example.test/a',
        snippet: 'x'.repeat(2000),
        published: 'not-a-date',
      },
      {
        title: 'Title',
        url: 'https://example.test/b',
        published: '2026-01-01T00:00:00Z',
      },
    ]),
    10,
  );

  expect(output).toMatchObject({
    results: [
      { snippet: 'x'.repeat(300) },
      { published: '2026-01-01T00:00:00Z' },
    ],
  });

  if (output.status !== 'success' || output.kind !== 'results')
    throw new Error('expected results output');
  expect(output.results[0]).not.toHaveProperty('published');
});

it('accepts only fully matched ISO date forms', () => {
  const valid = [
    '2026-01-01',
    '2026-01-01T00:00Z',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00.12Z',
    '2026-01-01T00:00:00',
    '2026-01-01T00:00:00+01:00',
    '2026-01-01T00:00:00+0100',
  ];

  const invalid = ['foo 2026-01-01', '2026-01-01 00:00:00'];

  const output = normalizeSearchOutput(
    resultsSource(
      [...valid, ...invalid].map((published, index) => ({
        ...result(`https://example.test/${index}`, index),
        published,
      })),
    ),
    20,
  );

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(output.results.map((item) => item.published)).toEqual([
    ...valid,
    undefined,
    undefined,
  ]);
});

it('keeps exactly ten notes without summarizing them', () => {
  const notes = Array.from({ length: 10 }, (_, index) => `engine-${index}`);

  const output = normalizeSearchOutput(
    resultsSource([result('https://example.test/a')], notes),
    10,
  );

  expect(output.notes).toEqual(notes);
});

it('limits results and titles before applying the serialized budget', () => {
  const output = normalizeSearchOutput(
    resultsSource(
      Array.from({ length: 5 }, (_, index) => ({
        ...result(`https://example.test/${index}`, index),
        title: 't'.repeat(250),
      })),
    ),
    3,
  );

  expect(output).toMatchObject({
    kind: 'results',
    results: Array.from({ length: 3 }, () => ({
      title: 't'.repeat(200),
    })),
  });
});

it('caps citations at twenty entries', () => {
  const output = normalizeSearchOutput(
    answerSource(
      'answer',
      Array.from({ length: 25 }, (_, index) => ({
        url: `https://example.test/${index}`,
      })),
    ),
    10,
  );

  if (output.kind !== 'answer') throw new Error('expected answer output');
  expect(output.citations).toHaveLength(20);
});

it('keeps and caps citation titles', () => {
  const output = normalizeSearchOutput(
    answerSource('answer', [
      {
        url: 'https://example.test/a',
        title: 't'.repeat(250),
      },
    ]),
    10,
  );

  if (output.kind !== 'answer') throw new Error('expected answer output');
  expect(output.citations).toEqual([
    {
      url: 'https://example.test/a',
      title: 't'.repeat(200),
    },
  ]);
});

it('cuts a long answer and records the truncation', () => {
  const output = normalizeSearchOutput(
    answerSource('a'.repeat(12_000), [
      { url: 'https://example.test/a', title: 'A' },
      { url: 'https://example.test/b', title: 'B' },
      { url: 'https://example.test/c', title: 'C' },
    ]),
    10,
  );

  expect(output).toMatchObject({
    kind: 'answer',
    answer: 'a'.repeat(8000),
    citations: [
      { url: 'https://example.test/a' },
      { url: 'https://example.test/b' },
      { url: 'https://example.test/c' },
    ],
  });
  expect(JSON.stringify(output)).toContain('answer truncated');
  expect(JSON.stringify(output)).not.toContain('answer cut to fit');
});

it('puts the removal count before the answer truncation note', () => {
  const output = normalizeSearchOutput(
    {
      ...answerSource('a'.repeat(12_000), [{ url: 'https://example.test/a' }]),
      removed: 2,
    },
    10,
  );

  expect(output).toMatchObject({
    kind: 'answer',
    notes: ['removed 2 entries', 'answer truncated to 8000 characters'],
  });
});

it('puts the removal count before the results dropped note', () => {
  const output = normalizeSearchOutput(
    {
      ...resultsSource(
        Array.from({ length: 20 }, (_, index) => ({
          title: 't'.repeat(200),
          url: `https://example.test/${'u'.repeat(1950)}${index}`,
          snippet: 's'.repeat(300),
        })),
      ),
      removed: 1,
    },
    20,
  );

  expect(output.notes?.[0]).toBe('removed 1 entry');
  expect(output.notes?.some((note) => /^\d+ results dropped/u.test(note))).toBe(
    true,
  );
});

it('does not note answers that are already within the answer cap', () => {
  for (const answer of ['short', 'a'.repeat(8000)]) {
    const output = normalizeSearchOutput(
      answerSource(answer, [{ url: 'https://example.test/a' }]),
      10,
    );

    expect(output).not.toHaveProperty('notes');
  }
});

it('drops trailing results to stay within the serialized budget', () => {
  const output = normalizeSearchOutput(
    resultsSource(
      Array.from({ length: 20 }, (_, index) => ({
        title: 't'.repeat(200),
        url: `https://example.test/${'u'.repeat(1950)}${index}`,
        snippet: 's'.repeat(300),
      })),
    ),
    20,
  );

  expect(JSON.stringify(output).length).toBeLessThanOrEqual(15_000);
  expect(output).toMatchObject({ kind: 'results' });
  expect(JSON.stringify(output)).toContain('results dropped to fit');

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(output.results.length).toBeGreaterThan(1);
  expect(output.notes?.some((note) => /^\d+ results dropped/u.test(note))).toBe(
    true,
  );
  expect(output.notes).not.toContain('answer cut to fit the output limit');
});

it('keeps the first citation while dropping oversized answer citations', () => {
  const output = normalizeSearchOutput(
    answerSource(
      'a'.repeat(8000),
      Array.from({ length: 20 }, (_, index) => ({
        url: `https://example.test/${'u'.repeat(1950)}${index}`,
      })),
      'q'.repeat(1000),
    ),
    10,
  );

  expect(JSON.stringify(output).length).toBeLessThanOrEqual(15_000);

  if (output.status !== 'success' || output.kind !== 'answer')
    throw new Error('expected answer output');
  expect(output.citations.length).toBeGreaterThan(1);
  expect(output.citations[0]?.url).toContain('/u');
  expect(output.notes).toContain(
    '18 citations dropped to fit the output limit',
  );
  expect(output.notes).not.toContain('answer cut to fit the output limit');
});

it('keeps a maximal answer when its one citation and the text fit', () => {
  const output = normalizeSearchOutput(
    answerSource(
      'a'.repeat(8000),
      [{ url: `https://example.test/${'u'.repeat(2020)}` }],
      '"'.repeat(1000),
      Array.from({ length: 10 }, () => '\u0000'.repeat(200)),
    ),
    10,
  );

  if (output.kind !== 'answer') throw new Error('expected answer output');
  // The rendered text is the bound, and this shape fits it whole.
  expect(
    (renderWebSearchOutput(output)?.text ?? '').length,
  ).toBeLessThanOrEqual(15_000);
  expect(output.answer).toBe('a'.repeat(8000));
  expect(output.notes).not.toContain('answer cut to fit the output limit');
});

it('measures the escape-free answer length, not its JSON spelling', () => {
  const output = normalizeSearchOutput(
    answerSource(
      'a'.repeat(8000),
      [{ url: 'https://example.test/a' }],
      'q'.repeat(100),
      Array.from({ length: 10 }, () => '\u0000'.repeat(200)),
    ),
    10,
  );

  if (output.kind !== 'answer') throw new Error('expected answer output');
  expect(output.answer).toBe('a'.repeat(8000));
  // The NUL notes escape to six units each in JSON, so the text is the bound.
  expect(JSON.stringify(output).length).toBeGreaterThan(15_000);
  expect(
    (renderWebSearchOutput(output)?.text ?? '').length,
  ).toBeLessThanOrEqual(15_000);
  expect(output.notes).not.toContain('answer cut to fit the output limit');
});

it('does not add an answer-cut note at the exact output limit', () => {
  const output = normalizeSearchOutput(
    answerSource(
      'a'.repeat(1836),
      [{ url: 'https://example.test/a' }],
      'q'.repeat(1000),
      Array.from({ length: 10 }, () => '\u0000'.repeat(200)),
    ),
    10,
  );

  if (output.kind !== 'answer') throw new Error('expected answer output');
  expect(output.answer).toHaveLength(1836);
  expect(JSON.stringify(output).length).toBe(15_000);
  expect(output.notes).not.toContain('answer cut to fit the output limit');
});

it('keeps one result at the exact serialized output limit', () => {
  const output = normalizeSearchOutput(
    resultsSource(
      [
        {
          title: 't'.repeat(200),
          url: `https://example.test/${'u'.repeat(1327)}`,
          snippet: 's'.repeat(300),
        },
      ],
      Array.from({ length: 10 }, () => '\u0000'.repeat(200)),
      'q'.repeat(1000),
    ),
    20,
  );

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(output.results).toHaveLength(1);
  expect(JSON.stringify(output).length).toBe(15_000);
  expect(output.notes).not.toContain('results dropped to fit the output limit');
});

it('summarizes notes beyond the tenth entry', () => {
  const output = normalizeSearchOutput(
    resultsSource(
      [result('https://example.test/a')],
      Array.from({ length: 14 }, (_, index) => `engine-${index}`),
    ),
    10,
  );

  expect(output).toMatchObject({
    notes: [
      'engine-0',
      'engine-1',
      'engine-2',
      'engine-3',
      'engine-4',
      'engine-5',
      'engine-6',
      'engine-7',
      'engine-8',
      '5 more engines',
    ],
  });
});

const attachedAnswer = (
  engine: string,
  answer: string,
  citations: ReadonlyArray<RawCitation>,
) => ({ engine, answer, citations });

it('caps each attached answer and its citations', () => {
  const output = normalizeSearchOutput(
    {
      ...resultsSource([result('https://example.test/r')]),
      answers: [
        attachedAnswer(
          'claude',
          'a'.repeat(9000),
          Array.from({ length: 25 }, (_, index) => ({
            url: `https://example.test/a${index}`,
          })),
        ),
      ],
    },
    10,
  );

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(output.answers).toHaveLength(1);
  expect(output.answers?.[0]?.answer).toHaveLength(8000);
  expect(output.answers?.[0]?.citations).toHaveLength(20);
});

it('leaves a results output without answers unchanged', () => {
  const output = normalizeSearchOutput(
    resultsSource([result('https://example.test/a')]),
    10,
  );

  expect(Object.hasOwn(output, 'answers')).toBe(false);
});

it('drops results before the text of an attached answer', () => {
  const output = normalizeSearchOutput(
    {
      ...resultsSource(
        Array.from({ length: 20 }, (_, index) => ({
          title: 't'.repeat(200),
          url: `https://example.test/${'u'.repeat(1950)}${index}`,
          snippet: 's'.repeat(300),
        })),
      ),
      answers: [
        attachedAnswer('claude', 'a'.repeat(8000), [
          { url: 'https://example.test/cited' },
        ]),
      ],
    },
    20,
  );

  expect(JSON.stringify(output).length).toBeLessThanOrEqual(15_000);

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(output.results.length).toBeGreaterThan(0);
  expect(output.results.length).toBeLessThan(20);
  expect(output.answers?.[0]?.answer).toHaveLength(8000);
  expect(output.notes?.some((note) => /^\d+ results dropped/u.test(note))).toBe(
    true,
  );
  expect(output.notes).not.toContain('1 answer cut to fit the output limit');
  expect(output.notes?.some((note) => /answers? dropped/u.test(note))).toBe(
    false,
  );
});

it('keeps the first citation of each attached answer', () => {
  const answerOf = (engine: string) =>
    attachedAnswer(
      engine,
      'a'.repeat(8000),
      Array.from({ length: 20 }, (_, index) => ({
        url: `https://example.test/${engine}/${'u'.repeat(1980)}${index}`,
      })),
    );

  const output = normalizeSearchOutput(
    { ...resultsSource([]), answers: [answerOf('one'), answerOf('two')] },
    10,
  );

  expect(JSON.stringify(output).length).toBeLessThanOrEqual(15_000);

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(output.answers?.map((entry) => entry.citations.length)).toEqual([
    1, 1,
  ]);
  expect(output.answers?.[1]?.citations[0]?.url).toContain('/two/');
  expect(output.notes).toContain(
    '38 citations dropped to fit the output limit',
  );
  expect(output.notes).toContain('1 answer cut to fit the output limit');
});

it('drops whole attached answers from the end last', () => {
  const url = `https://example.test/${'u'.repeat(2048 - 'https://example.test/'.length)}`;
  const engines = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  const output = normalizeSearchOutput(
    {
      ...resultsSource([]),
      answers: engines.map((engine) =>
        attachedAnswer(engine, 'Answer.', [{ url }]),
      ),
    },
    10,
  );

  expect(JSON.stringify(output).length).toBeLessThanOrEqual(15_000);

  if (output.kind !== 'results') throw new Error('expected results output');
  const kept = output.answers ?? [];
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.length).toBeLessThan(engines.length);
  // The end goes first, so the kept answers are the leading child order.
  expect(kept.map((entry) => entry.engine)).toEqual(
    engines.slice(0, kept.length),
  );
  const dropped = engines.length - kept.length;
  expect(output.notes).toEqual([
    `${dropped} ${dropped === 1 ? 'answer' : 'answers'} dropped to fit the output limit`,
  ]);
});

it('measures the rendered text, not the JSON escaping of two answers', () => {
  const output = normalizeSearchOutput(
    {
      ...resultsSource([]),
      answers: ['one', 'two'].map((engine) =>
        attachedAnswer(engine, '"'.repeat(8000), [
          { url: 'https://example.test/cited' },
        ]),
      ),
    },
    10,
  );

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(
    (renderWebSearchOutput(output)?.text ?? '').length,
  ).toBeLessThanOrEqual(15_000);
  // Quotes are escaped in JSON, so this output fits as text only.
  expect(JSON.stringify(output).length).toBeGreaterThan(15_000);
  expect(output.answers).toHaveLength(2);
  expect(output.notes).toContain('1 answer cut to fit the output limit');
});

const longUrl = (stem: string, length: number): string =>
  `https://example.test/${stem}${'u'.repeat(length - 'https://example.test/'.length - stem.length)}`;

const attachedAnswers = (
  ...entries: ReadonlyArray<{
    engine: string;
    answer: string;
    citations: ReadonlyArray<RawCitation>;
  }>
) => ({ ...resultsSource([]), answers: entries });

it('cuts only the last answer’s text', () => {
  const output = normalizeSearchOutput(
    attachedAnswers(
      attachedAnswer('a', 'a'.repeat(8000), [
        { url: 'https://example.test/short' },
      ]),
      attachedAnswer('b', 'b'.repeat(3000), [{ url: longUrl('b', 2048) }]),
      attachedAnswer('c', 'c'.repeat(3000), [{ url: longUrl('c', 1000) }]),
    ),
    10,
  );

  expect(JSON.stringify(output).length).toBeLessThanOrEqual(15_000);

  if (output.kind !== 'results') throw new Error('expected results output');
  const answers = output.answers ?? [];
  expect(answers.map((entry) => entry.engine)).toEqual(['a', 'b', 'c']);
  // The earlier answers keep their whole text; only the last one is cut.
  expect(answers[0].answer).toHaveLength(8000);
  expect(answers[1].answer).toHaveLength(3000);
  expect(answers[2].answer.length).toBeGreaterThan(0);
  expect(answers[2].answer.length).toBeLessThan(3000);
  expect(output.notes).toEqual(['1 answer cut to fit the output limit']);
});

it('stops the text step when the last answer cannot fit emptied', () => {
  const output = normalizeSearchOutput(
    attachedAnswers(
      attachedAnswer('a', 'a'.repeat(8000), [
        { url: 'https://example.test/short' },
      ]),
      attachedAnswer('b', 'b'.repeat(3000), [{ url: longUrl('b', 2048) }]),
      attachedAnswer('c', 'c'.repeat(3000), [{ url: longUrl('c', 2048) }]),
    ),
    10,
  );

  expect(JSON.stringify(output).length).toBeLessThanOrEqual(15_000);

  if (output.kind !== 'results') throw new Error('expected results output');
  const answers = output.answers ?? [];
  // The whole last answer goes instead of cutting an earlier one.
  expect(answers.map((entry) => entry.engine)).toEqual(['a', 'b']);
  expect(answers[0].answer).toHaveLength(8000);
  expect(answers[1].answer).toHaveLength(3000);
  expect(output.notes).toEqual(['1 answer dropped to fit the output limit']);
});

it('does not cut an attached answer inside a bare URL', () => {
  const filler = 'a'.repeat(7900);

  const output = normalizeSearchOutput(
    attachedAnswers(
      attachedAnswer(
        'a',
        `${filler} https://example.test/${'u'.repeat(300)} tail`,
        [{ url: 'https://example.test/short' }],
      ),
    ),
    10,
  );

  if (output.kind !== 'results') throw new Error('expected results output');
  // 8,000 units falls inside the URL, so the bound moves back to before it.
  expect(output.answers?.[0]?.answer).toBe(`${filler} `);
});

it('does not cut an attached answer inside a Markdown link', () => {
  const filler = 'a'.repeat(7900);

  const output = normalizeSearchOutput(
    attachedAnswers(
      attachedAnswer(
        'a',
        `${filler} [Docs](https://example.test/${'u'.repeat(300)}) tail`,
        [{ url: 'https://example.test/short' }],
      ),
    ),
    10,
  );

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(output.answers?.[0]?.answer).toBe(`${filler} `);
});

it('notes each attached answer cut to the answer bound', () => {
  const output = normalizeSearchOutput(
    attachedAnswers(
      attachedAnswer('a', 'a'.repeat(9000), [
        { url: 'https://example.test/a' },
      ]),
    ),
    10,
  );

  expect(output).toMatchObject({
    notes: ['answer truncated to 8000 characters'],
  });

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(output.answers?.[0]?.answer).toHaveLength(8000);
});

it('counts the attached answers cut to the answer bound', () => {
  const output = normalizeSearchOutput(
    attachedAnswers(
      attachedAnswer('a', 'a'.repeat(9000), [
        { url: 'https://example.test/a' },
      ]),
      attachedAnswer('b', 'b'.repeat(9000), [
        { url: 'https://example.test/b' },
      ]),
    ),
    10,
  );

  expect(output.notes).toContain('2 answers truncated to 8000 characters');
  expect(
    output.notes?.filter((note) => note.includes('truncated')),
  ).toHaveLength(1);
});

it('canonicalizes and bounds the citations of an attached answer', () => {
  const output = normalizeSearchOutput(
    attachedAnswers(
      attachedAnswer('a', 'text', [
        { url: 'https://Example.com/A#top', title: 'A' },
        { url: 'javascript:alert(1)' },
        { url: 'https://example.com/A' },
      ]),
    ),
    10,
  );

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(output.answers?.[0]?.citations).toEqual([
    { url: 'https://example.com/A', title: 'A' },
  ]);
});

it('cuts the last answer outside a bare URL', () => {
  const source = (lastAnswer: string) => ({
    ...resultsSource([]),
    answers: [
      attachedAnswer('a', 'a'.repeat(8000), [
        { url: 'https://example.test/short' },
      ]),
      attachedAnswer('b', 'b'.repeat(3000), [{ url: longUrl('b', 2048) }]),
      attachedAnswer('c', lastAnswer, [{ url: longUrl('c', 1000) }]),
    ],
  });

  const plain = normalizeSearchOutput(source('c'.repeat(8000)), 10);

  if (plain.kind !== 'results') throw new Error('expected results output');
  const budget = plain.answers?.[2]?.answer.length;

  if (budget === undefined) throw new Error('expected a third answer');
  const filler = 'a'.repeat(budget - 10);
  // The URL starts just before the calibrated cut and ends after it.
  const text = `${filler} ${longUrl('u', 300)} ${'z'.repeat(2000)}`;
  expect(text.length).toBeGreaterThan(budget);

  const output = normalizeSearchOutput(source(text), 10);

  if (output.kind !== 'results') throw new Error('expected results output');
  // The cut at `budget` falls inside the URL, so it moves back before it.
  expect(output.answers?.[2]?.answer).toBe(`${filler} `);
  expect(output.notes).toEqual(['1 answer cut to fit the output limit']);
});

it('cuts the last attached answer outside a Markdown link', () => {
  const source = (lastAnswer: string) => ({
    ...resultsSource([]),
    answers: [
      attachedAnswer('a', 'a'.repeat(8000), [
        { url: 'https://example.test/short' },
      ]),
      attachedAnswer('b', 'b'.repeat(3000), [{ url: longUrl('b', 2048) }]),
      attachedAnswer('c', lastAnswer, [{ url: longUrl('c', 1000) }]),
    ],
  });

  const plain = normalizeSearchOutput(source('c'.repeat(8000)), 10);

  if (plain.kind !== 'results') throw new Error('expected results output');
  const budget = plain.answers?.[2]?.answer.length;

  if (budget === undefined) throw new Error('expected a third answer');
  const filler = 'a'.repeat(budget - 10);
  const link = '[Docs](https://example.test/x)';

  const output = normalizeSearchOutput(
    source(`${filler} ${link} ${'z'.repeat(2000)}`),
    10,
  );

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(output.answers?.[2]?.answer).toBe(`${filler} `);
  expect(output.notes).toContain('1 answer cut to fit the output limit');
});

it('keeps every fetched result in the full output up to the fetch size', () => {
  const output = normalizeFullOutput(
    resultsSource(
      Array.from({ length: 25 }, (_unused, index) =>
        result(`https://example.test/${index}`, index),
      ),
    ),
    20,
  );

  if (output.kind !== 'results') throw new Error('expected a results output');
  expect(output.results).toHaveLength(20);
  expect(output.results.at(-1)?.url).toBe('https://example.test/19');
});

it('keeps the whole serialized output that the inline fit would shorten', () => {
  const results = Array.from({ length: 20 }, (_unused, index) => ({
    ...result(`https://example.test/${index}/${'u'.repeat(500)}`, index),
    title: 't'.repeat(200),
    snippet: 's'.repeat(300),
  }));

  const full = normalizeFullOutput(resultsSource(results), 20);
  const inline = normalizeSearchOutput(resultsSource(results), 20);

  if (full.kind !== 'results' || inline.kind !== 'results')
    throw new Error('expected results outputs');
  expect(full.results).toHaveLength(20);
  expect(inline.results.length).toBeLessThan(20);
});

it('keeps a results output at exactly the inline limit', () => {
  const results = Array.from({ length: 20 }, (_unused, index) => ({
    title: 't'.repeat(200),
    url: `https://example.test/${index}/${'u'.repeat(1)}`,
    snippet: 's'.repeat(300),
  }));

  const notes = Array.from({ length: 10 }, () => 'n'.repeat(200));
  const query = 'q'.repeat(1000);

  const build = (extra: number) =>
    resultsSource(
      results.map((result, index) =>
        index === 0
          ? { ...result, url: `${result.url}${'u'.repeat(extra)}` }
          : result,
      ),
      notes,
      query,
    );

  const extra = 15_000 - renderedLength(normalizeSearchOutput(build(0), 20));
  expect(extra).toBeGreaterThanOrEqual(0);
  expect(extra).toBeLessThanOrEqual(2000);
  const output = normalizeSearchOutput(build(extra), 20);

  expect(renderedLength(output)).toBe(15_000);

  if (output.kind !== 'results') throw new Error('expected results output');
  expect(output.results).toHaveLength(20);
  expect(output.notes).toEqual(notes);
});

it('keeps an answer output at exactly the inline limit', () => {
  const notes = Array.from({ length: 10 }, () => 'n'.repeat(200));
  const query = 'q'.repeat(1000);
  const minimal = { url: 'https://example.test/c' };

  const build = (thirdUrlLength: number) =>
    answerSource(
      'a'.repeat(8000),
      [
        { url: longUrl('a', 2048) },
        { url: 'https://example.test/b' },
        thirdUrlLength === minimal.url.length
          ? minimal
          : { url: longUrl('c', thirdUrlLength) },
      ],
      query,
      notes,
    );

  const base = normalizeSearchOutput(build(minimal.url.length), 10);
  const extra = 15_000 - renderedLength(base);
  const thirdUrlLength = minimal.url.length + extra;
  expect(thirdUrlLength).toBeLessThanOrEqual(2048);
  const output = normalizeSearchOutput(build(thirdUrlLength), 10);

  expect(renderedLength(output)).toBe(15_000);

  if (output.kind !== 'answer') throw new Error('expected an answer output');
  expect(output.citations).toHaveLength(3);
  expect(output.notes).toEqual(notes);
});

it('stops dropping results exactly at the notice-reserved limit', () => {
  const notes = Array.from({ length: 10 }, () => 'n'.repeat(200));
  const query = 'q'.repeat(1000);

  const maxResult = (index: number) => ({
    title: 't'.repeat(200),
    url: `https://example.test/${index}/${'u'.repeat(1)}`,
    snippet: 's'.repeat(300),
  });

  const tunable = (pad: number) => ({
    title: 'sixth',
    url: `https://example.test/tunable/${'u'.repeat(pad)}`,
    snippet: 's'.repeat(300),
  });

  const small = {
    title: 'small',
    url: 'https://example.test/small',
    snippet: 's'.repeat(300),
  };

  const build = (pad: number, withSmall: boolean) =>
    resultsSource(
      [
        ...Array.from({ length: 18 }, (_unused, index) => maxResult(index)),
        tunable(pad),
        ...(withSmall ? [small] : []),
      ],
      notes,
      query,
    );

  const measure = (pad: number) =>
    renderedLength(normalizeSearchOutput(build(pad, true), 20));

  // Start already over the inline limit, so the small result leaves; in that
  // regime the padded URL moves the remaining text one unit per unit.
  const pad = 1700 + (14_744 - measure(1700));
  expect(pad).toBeGreaterThanOrEqual(0);
  expect(pad).toBeLessThanOrEqual(2000);
  const output = normalizeSearchOutput(build(pad, true), 20);

  if (output.kind !== 'results') throw new Error('expected results output');
  // The small result leaves, and the exact reserved boundary keeps the rest.
  expect(output.results).toHaveLength(19);
  expect(renderedLength(output)).toBe(14_744);
  expect(output.notes).toContain('2 more engines');
});

it('cuts a multi-line answer output that still does not fit', () => {
  const source = answerSource(
    'a\n'.repeat(4000),
    [{ url: longUrl('c', 2048) }],
    'q'.repeat(1000),
    Array.from({ length: 10 }, () => 'n'.repeat(200)),
  );

  const output = normalizeSearchOutput(source, 10);

  expect(renderedLength(output)).toBeLessThanOrEqual(15_000);

  if (output.kind !== 'answer') throw new Error('expected an answer output');
  // The rendered text is far over the bound while the stored answer is not.
  expect(source.answer).toHaveLength(8000);
  expect(output.answer.length).toBeLessThan(8000);
  expect(output.citations).toHaveLength(1);
  expect(output.notes).toContain('answer cut to fit the output limit');
});
