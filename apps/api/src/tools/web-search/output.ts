import { cutStringAtCodePointBoundary } from '@workspace/runtime-safety';
import { canonicalHref, stripFragment } from '../web-read/locator';
import { type SearchChainError, type SearchChainSuccess } from './chain';

export const WEB_SEARCH_URL_MAX_CODE_UNITS = 2048;
export const WEB_SEARCH_OUTPUT_MAX_CODE_UNITS = 15_000;
export const WEB_SEARCH_TITLE_MAX_CODE_UNITS = 200;
export const WEB_SEARCH_SNIPPET_MAX_CODE_UNITS = 300;
export const WEB_SEARCH_ANSWER_MAX_CODE_UNITS = 8000;
export const WEB_SEARCH_NOTE_MAX_CODE_UNITS = 200;
export const WEB_SEARCH_NOTES_MAX = 10;
export const WEB_SEARCH_CITATIONS_MAX = 20;

export type WebSearchResult = {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
  readonly published?: string;
};
export type WebSearchCitation = {
  readonly url: string;
  readonly title?: string;
};
type WebSearchBase = {
  readonly status: 'success';
  readonly engine: string;
  readonly query: string;
  readonly notes?: ReadonlyArray<string>;
};
export type WebSearchSuccess =
  | (WebSearchBase & {
      readonly kind: 'results';
      readonly results: ReadonlyArray<WebSearchResult>;
    })
  | (WebSearchBase & {
      readonly kind: 'answer';
      readonly answer: string;
      readonly citations: ReadonlyArray<WebSearchCitation>;
    });
export type WebSearchOutput = WebSearchSuccess | SearchChainError;

type ResultSource = Extract<SearchChainSuccess, { kind: 'results' }>;
type AnswerSource = Extract<SearchChainSuccess, { kind: 'answer' }>;
type AnswerOutput = Extract<WebSearchSuccess, { kind: 'answer' }>;
function capText(text: string, max: number): string {
  return cutStringAtCodePointBoundary(text, max);
}

/** Canonicalize a result locator without applying read's selector grammar. */
export function canonicalUrl(raw: string): string | undefined {
  try {
    const url = new URL(stripFragment(raw));
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    )
      return undefined;
    let href = canonicalHref(url);
    if (url.search === '') {
      const slash = href.lastIndexOf('/');
      const segment = href.slice(slash + 1);
      if (segment.includes(':'))
        href = `${href.slice(0, slash + 1)}${segment.replaceAll(':', '%3A')}`;
    }
    return href.length <= WEB_SEARCH_URL_MAX_CODE_UNITS ? href : undefined;
  } catch {
    return undefined;
  }
}
export const canonicalizeSearchUrl = canonicalUrl;

function isoPublished(value: string | undefined): string | undefined {
  if (
    value === undefined ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u.test(
      value,
    ) ||
    Number.isNaN(Date.parse(value))
  )
    return undefined;
  return value;
}

const structuredNote =
  /^(?:answer (?:truncated|cut)|\d+ (?:results|citations) dropped)/u;
function capNotes(notes: ReadonlyArray<string>): Array<string> {
  const bounded = notes.map((note) =>
    capText(note, WEB_SEARCH_NOTE_MAX_CODE_UNITS),
  );
  if (bounded.length <= WEB_SEARCH_NOTES_MAX) return bounded;
  const fixed = bounded.filter((note) => structuredNote.test(note));
  const engines = bounded.filter((note) => !structuredNote.test(note));
  const slots = Math.max(0, WEB_SEARCH_NOTES_MAX - fixed.length - 1);
  return [
    ...fixed,
    ...engines.slice(0, slots),
    `${engines.length - slots} more engines`,
  ];
}

function capResults(
  source: ResultSource,
  limit: number,
): Array<WebSearchResult> {
  const results: Array<WebSearchResult> = [];
  for (const item of source.results) {
    const url = canonicalUrl(item.url);
    if (url === undefined) continue;
    const published = isoPublished(item.published);
    results.push({
      title: capText(item.title, WEB_SEARCH_TITLE_MAX_CODE_UNITS),
      url,
      ...(item.snippet !== undefined && {
        snippet: capText(item.snippet, WEB_SEARCH_SNIPPET_MAX_CODE_UNITS),
      }),
      ...(published !== undefined && { published }),
    });
    if (results.length >= limit) break;
  }
  return results;
}

function capCitations(source: AnswerSource): Array<WebSearchCitation> {
  const citations: Array<WebSearchCitation> = [],
    seen = new Set<string>();
  for (const item of source.citations) {
    const url = canonicalUrl(item.url);
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      url,
      ...(item.title !== undefined && {
        title: capText(item.title, WEB_SEARCH_TITLE_MAX_CODE_UNITS),
      }),
    });
    if (citations.length >= WEB_SEARCH_CITATIONS_MAX) break;
  }
  return citations;
}

function capFields(source: SearchChainSuccess, limit: number): WebSearchOutput {
  if (source.kind === 'results')
    return {
      status: 'success',
      kind: 'results',
      engine: source.engine,
      query: source.query,
      results: capResults(source, limit),
    };
  const answer = capText(source.answer, WEB_SEARCH_ANSWER_MAX_CODE_UNITS),
    citations = capCitations(source);
  return citations.length === 0
    ? {
        status: 'error',
        type: 'web_search_failed',
        message: `All web search engines failed: ${source.engine}: ungrounded`,
      }
    : {
        status: 'success',
        kind: 'answer',
        engine: source.engine,
        query: source.query,
        answer,
        citations,
      };
}

function withNotes(
  value: WebSearchSuccess,
  notes: ReadonlyArray<string>,
  budgetNote: string,
  answerCut: boolean,
): WebSearchSuccess {
  const visible = [...notes];
  if (budgetNote !== '') visible.unshift(budgetNote);
  if (answerCut) visible.unshift('answer cut to fit the output limit');
  const bounded = capNotes(visible);
  return bounded.length === 0 ? value : { ...value, notes: bounded };
}

function cutAnswer(
  output: AnswerOutput,
  notes: ReadonlyArray<string>,
  budgetNote: string,
): WebSearchSuccess {
  let low = 0,
    high = output.answer.length,
    fitting = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2),
      candidate = capText(output.answer, middle);
    if (
      JSON.stringify(
        withNotes({ ...output, answer: candidate }, notes, budgetNote, true),
      ).length <= WEB_SEARCH_OUTPUT_MAX_CODE_UNITS
    ) {
      fitting = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  return withNotes({ ...output, answer: fitting }, notes, budgetNote, true);
}

function fitBudget(
  source: SearchChainSuccess,
  initial: WebSearchSuccess,
): WebSearchSuccess {
  const notes = source.notes === undefined ? [] : [...source.notes];
  if (
    source.kind === 'answer' &&
    source.answer.length > WEB_SEARCH_ANSWER_MAX_CODE_UNITS
  )
    notes.unshift('answer truncated to 8000 characters');
  let output = withNotes(initial, notes, '', false),
    budgetNote = '',
    dropped = 0;
  while (
    JSON.stringify(output).length > WEB_SEARCH_OUTPUT_MAX_CODE_UNITS &&
    (output.kind === 'results'
      ? output.results.length > 0
      : output.citations.length > 1)
  ) {
    if (output.kind === 'results') {
      output = Object.assign(output, { results: output.results.slice(0, -1) });
      budgetNote = `${++dropped} results dropped to fit the output limit`;
    } else {
      output = Object.assign(output, {
        citations: output.citations.slice(0, -1),
      });
      budgetNote = `${++dropped} citations dropped to fit the output limit`;
    }
    output = withNotes(output, notes, budgetNote, false);
  }
  return output.kind === 'answer' &&
    JSON.stringify(output).length > WEB_SEARCH_OUTPUT_MAX_CODE_UNITS
    ? cutAnswer(output, notes, budgetNote)
    : output;
}

/** Normalize one chain result into the bounded model-visible output. */
export function normalizeOutput(
  source: SearchChainSuccess,
  limit: number,
): WebSearchOutput {
  const fields = capFields(source, limit);
  return fields.status === 'error' ? fields : fitBudget(source, fields);
}

export const normalizeSearchOutput = normalizeOutput;
