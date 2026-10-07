import { parseWebLocator } from '../web-read/locator';
import { canonicalizeSearchUrl, normalizeSearchOutput } from './output';
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
): ResultSource =>
  notes === undefined
    ? { kind: 'results', engine: 'brave', query: 'query', results }
    : { kind: 'results', engine: 'brave', query: 'query', results, notes };
const answerSource = (
  answer: string,
  citations: ReadonlyArray<RawCitation>,
  query = 'query',
  notes?: ReadonlyArray<string>,
): AnswerSource =>
  notes === undefined
    ? { kind: 'answer', engine: 'hosted', query, answer, citations }
    : { kind: 'answer', engine: 'hosted', query, answer, citations, notes };
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
  expect(output.citations[0]?.url).toContain('/u');
  expect(JSON.stringify(output)).toContain('citations dropped to fit');
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
