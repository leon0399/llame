import { parseWebLocator } from '../web-read/locator';
import {
  canonicalUrl as canonicalizeSearchUrl,
  normalizeOutput as normalizeSearchOutput,
} from './output';
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

it('notes when an answer is cut further to fit with one citation', () => {
  const output = normalizeSearchOutput(
    answerSource(
      'a'.repeat(8000),
      [{ url: `https://example.test/${'u'.repeat(2020)}` }],
      '"'.repeat(1000),
      Array.from({ length: 10 }, () => '\u0000'.repeat(200)),
    ),
    10,
  );
  expect(JSON.stringify(output).length).toBeLessThanOrEqual(15_000);
  expect(JSON.stringify(output)).toContain('answer cut to fit');
});
it('finds the largest answer that exactly fits the serialized budget', () => {
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
  expect(output.answer).toBe('a'.repeat(5088));
  expect(JSON.stringify(output).length).toBe(15_000);
  expect(output.notes).toContain('answer cut to fit the output limit');
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
