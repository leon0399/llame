import { cutStringAtCodePointBoundary as capText } from '@workspace/runtime-safety';
import { canonicalHref, stripFragment } from '../web-read/locator';
import {
  type RawAnswer,
  type RawCitation,
  type RawResult,
  type SearchChainSuccess,
} from './chain';

export const WEB_SEARCH_URL_MAX_CODE_UNITS = 2048;
export const WEB_SEARCH_OUTPUT_MAX_CODE_UNITS = 15_000;
export const WEB_SEARCH_TITLE_MAX_CODE_UNITS = 200;
export const WEB_SEARCH_SNIPPET_MAX_CODE_UNITS = 300;
export const WEB_SEARCH_ANSWER_MAX_CODE_UNITS = 8000;
export const WEB_SEARCH_NOTE_MAX_CODE_UNITS = 200;
export const WEB_SEARCH_NOTES_MAX = 10;
export const WEB_SEARCH_CITATIONS_MAX = 20;

type WebSearchBase = {
  readonly status: 'success';
  readonly engine: string;
  readonly query: string;
  readonly notes?: ReadonlyArray<string>;
};
export type WebSearchSuccess =
  | (WebSearchBase & {
      readonly kind: 'results';
      readonly results: ReadonlyArray<RawResult>;
      /** Grounded answers an `aggregate` attaches, after its results. */
      readonly answers?: ReadonlyArray<RawAnswer>;
    })
  | (WebSearchBase & {
      readonly kind: 'answer';
      readonly answer: string;
      readonly citations: ReadonlyArray<RawCitation>;
    });

type ResultSource = Extract<SearchChainSuccess, { kind: 'results' }>;
type ResultsOutput = Extract<WebSearchSuccess, { kind: 'results' }>;
type AnswerOutput = Extract<WebSearchSuccess, { kind: 'answer' }>;

/** Canonicalize a result locator without applying read's selector grammar. */
export function canonicalUrl(raw: string): string | undefined {
  const locator = stripFragment(raw);
  if (!URL.canParse(locator)) return undefined;
  const url = new URL(locator);
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
    href = `${href.slice(0, slash + 1)}${segment.replaceAll(':', '%3A')}`;
  }
  return href.length <= WEB_SEARCH_URL_MAX_CODE_UNITS ? href : undefined;
}
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

function capNotes(notes: ReadonlyArray<string>): Array<string> {
  const bounded = notes.map((note) =>
    capText(note, WEB_SEARCH_NOTE_MAX_CODE_UNITS),
  );
  if (bounded.length <= WEB_SEARCH_NOTES_MAX) return bounded;
  return [...bounded.slice(0, 9), `${bounded.length - 9} more engines`];
}

function capResults(source: ResultSource, limit: number): Array<RawResult> {
  const results: Array<RawResult> = [];
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

function capCitations(
  citations: ReadonlyArray<RawCitation>,
): Array<RawCitation> {
  const bounded: Array<RawCitation> = [],
    seen = new Set<string>();
  for (const item of citations) {
    const url = canonicalUrl(item.url);
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    bounded.push({
      url,
      ...(item.title !== undefined && {
        title: capText(item.title, WEB_SEARCH_TITLE_MAX_CODE_UNITS),
      }),
    });
    if (bounded.length >= WEB_SEARCH_CITATIONS_MAX) break;
  }
  return bounded;
}

/** Attached answers keep the answer and citation bounds of an answer output. */
function capAnswers(source: ResultSource): Array<RawAnswer> | undefined {
  if (source.answers === undefined) return undefined;
  return source.answers.map((answer) => ({
    engine: answer.engine,
    answer: capText(answer.answer, WEB_SEARCH_ANSWER_MAX_CODE_UNITS),
    citations: capCitations(answer.citations),
  }));
}

function capFields(
  source: SearchChainSuccess,
  limit: number,
): WebSearchSuccess {
  if (source.kind === 'results') {
    const answers = capAnswers(source);
    return {
      status: 'success',
      kind: 'results',
      engine: source.engine,
      query: source.query,
      results: capResults(source, limit),
      ...(answers !== undefined && { answers }),
    };
  }
  return {
    status: 'success',
    kind: 'answer',
    engine: source.engine,
    query: source.query,
    answer: capText(source.answer, WEB_SEARCH_ANSWER_MAX_CODE_UNITS),
    citations: capCitations(source.citations),
  };
}

/** One trim step's count note; empty until the step drops its first entry. */
type TrimNotes = {
  results: string;
  citations: string;
  answersCut: string;
  answers: string;
};

const NO_TRIM_NOTES: TrimNotes = {
  results: '',
  citations: '',
  answersCut: '',
  answers: '',
};

/** The trim notes in step order, each visible while its own step measures. */
function trimNoteList(trimNotes: TrimNotes): Array<string> {
  return [
    trimNotes.results,
    trimNotes.citations,
    trimNotes.answersCut,
    trimNotes.answers,
  ].filter((note) => note !== '');
}

/** The notes of one normalized output, before they are bounded. */
type NoteInputs = {
  readonly notes: ReadonlyArray<string>;
  /** The trim notes of the current step and of the steps before it. */
  readonly trimNotes: TrimNotes;
  /** Whether the answer was cut further to fit beside one citation. */
  readonly answerCut: boolean;
  /** Entries the call removed, for the note that comes before the others. */
  readonly removed: number | undefined;
};

function withNotes(
  value: WebSearchSuccess,
  { notes, trimNotes, answerCut, removed }: NoteInputs,
): WebSearchSuccess {
  const visible = [...trimNoteList(trimNotes), ...notes];
  if (answerCut) visible.unshift('answer cut to fit the output limit');
  // The count note goes before every other note, including the truncation ones
  // above, so neither the cap nor a cut can take its place. It names no URL or
  // host: the model learns that something was removed, not what.
  if (removed !== undefined && removed > 0)
    visible.unshift(
      `removed ${removed} ${removed === 1 ? 'entry' : 'entries'}`,
    );
  const bounded = capNotes(visible);
  return bounded.length === 0 ? value : { ...value, notes: bounded };
}

/** One trim step's note: the entries it removed and how it removed them. */
function trimNote(
  count: number,
  unit: 'result' | 'citation' | 'answer',
  verb: 'dropped' | 'cut',
): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ${verb} to fit the output limit`;
}

function cutAnswer(
  output: AnswerOutput,
  notes: ReadonlyArray<string>,
  trimNotes: TrimNotes,
  removed: number | undefined,
): WebSearchSuccess {
  let low = 0,
    high = output.answer.length;
  let fitting: string | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2),
      candidate = capText(output.answer, middle);
    if (
      JSON.stringify(
        withNotes(
          { ...output, answer: candidate },
          { notes, trimNotes, answerCut: true, removed },
        ),
      ).length <= WEB_SEARCH_OUTPUT_MAX_CODE_UNITS
    ) {
      fitting = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  return withNotes(
    { ...output, answer: fitting ?? '' },
    { notes, trimNotes, answerCut: true, removed },
  );
}

function isOverBudget(value: WebSearchSuccess): boolean {
  return JSON.stringify(value).length > WEB_SEARCH_OUTPUT_MAX_CODE_UNITS;
}

function fitAnswer(
  initial: AnswerOutput,
  notes: ReadonlyArray<string>,
  removed: number | undefined,
): WebSearchSuccess {
  const trimNotes: TrimNotes = { ...NO_TRIM_NOTES };
  let citations = initial.citations;
  const render = (): WebSearchSuccess =>
    withNotes(
      { ...initial, citations },
      { notes, trimNotes, answerCut: false, removed },
    );
  let output = render(),
    dropped = 0;
  while (isOverBudget(output) && citations.length > 1) {
    citations = citations.slice(0, -1);
    trimNotes.citations = trimNote(++dropped, 'citation', 'dropped');
    output = render();
  }
  return isOverBudget(output)
    ? cutAnswer({ ...initial, citations }, notes, trimNotes, removed)
    : output;
}

/** A results output while its trim steps run, with the notes they carry. */
type ResultsTrim = {
  readonly initial: ResultsOutput;
  readonly notes: ReadonlyArray<string>;
  readonly removed: number | undefined;
  readonly trimNotes: TrimNotes;
  /** Whether the output carries answers at all; an absent key stays absent. */
  readonly hasAnswers: boolean;
  results: ReadonlyArray<RawResult>;
  answers: Array<RawAnswer>;
};

/** The current rendering of a trimmed results output, notes included. */
function renderTrimmed(trim: ResultsTrim): WebSearchSuccess {
  return withNotes(
    {
      ...trim.initial,
      results: trim.results,
      ...(trim.hasAnswers && { answers: trim.answers }),
    },
    {
      notes: trim.notes,
      trimNotes: trim.trimNotes,
      answerCut: false,
      removed: trim.removed,
    },
  );
}

/** First trim step: a results output loses trailing results. */
function trimTrailingResults(trim: ResultsTrim): void {
  let dropped = 0;
  while (trim.results.length > 0 && isOverBudget(renderTrimmed(trim))) {
    trim.results = trim.results.slice(0, -1);
    trim.trimNotes.results = trimNote(++dropped, 'result', 'dropped');
  }
}

/** Second trim step: each attached answer loses citations from its end. */
function trimAnswerCitations(trim: ResultsTrim): void {
  let dropped = 0;
  for (
    let index = trim.answers.length - 1;
    index >= 0 && isOverBudget(renderTrimmed(trim));
    index -= 1
  ) {
    let citations = trim.answers[index].citations;
    while (citations.length > 1 && isOverBudget(renderTrimmed(trim))) {
      citations = citations.slice(0, -1);
      trim.answers[index] = { ...trim.answers[index], citations };
      trim.trimNotes.citations = trimNote(++dropped, 'citation', 'dropped');
    }
  }
}

/** Third trim step: answer text is cut, the last answer first. */
function cutAnswerText(trim: ResultsTrim): void {
  let cut = 0;
  for (
    let index = trim.answers.length - 1;
    index >= 0 && isOverBudget(renderTrimmed(trim));
    index -= 1
  ) {
    const answer = trim.answers[index];
    if (answer.answer === '') continue;
    // The note of this cut joins its own measurement, so a cut that only trades
    // answer text for the note does not happen.
    trim.trimNotes.answersCut = trimNote(cut + 1, 'answer', 'cut');
    // The largest prefix that makes the whole output fit. An answer that cannot
    // fit even when empty is left whole for the next step to drop, so trimming
    // never discards text that the output would otherwise keep.
    let low = 0,
      high = answer.answer.length;
    let fitting: string | undefined;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      trim.answers[index] = {
        ...answer,
        answer: capText(answer.answer, middle),
      };
      if (isOverBudget(renderTrimmed(trim))) high = middle - 1;
      else {
        fitting = trim.answers[index].answer;
        low = middle + 1;
      }
    }
    if (fitting === undefined) {
      trim.answers[index] = answer;
      trim.trimNotes.answersCut = '';
      continue;
    }
    trim.answers[index] = { ...answer, answer: fitting };
    cut += 1;
  }
}

/** Fourth trim step: whole answers are dropped, the end first. */
function trimWholeAnswers(trim: ResultsTrim): void {
  let dropped = 0;
  while (trim.answers.length > 0 && isOverBudget(renderTrimmed(trim))) {
    trim.answers = trim.answers.slice(0, -1);
    trim.trimNotes.answers = trimNote(++dropped, 'answer', 'dropped');
  }
}

/**
 * Fits a results output and its attached answers: trailing results go first,
 * then citations from the last answer's end while each answer keeps one, then
 * answer text from the last answer backwards, then whole answers from the end.
 * Each step keeps one count note.
 */
function fitResults(
  initial: ResultsOutput,
  notes: ReadonlyArray<string>,
  removed: number | undefined,
): WebSearchSuccess {
  const trim: ResultsTrim = {
    initial,
    notes,
    removed,
    trimNotes: { ...NO_TRIM_NOTES },
    hasAnswers: initial.answers !== undefined,
    results: initial.results,
    answers: initial.answers === undefined ? [] : [...initial.answers],
  };
  trimTrailingResults(trim);
  if (trim.hasAnswers) {
    trimAnswerCitations(trim);
    cutAnswerText(trim);
    trimWholeAnswers(trim);
  }
  return renderTrimmed(trim);
}

/** Normalize one chain result into the bounded model-visible output. */
export function normalizeOutput(
  source: SearchChainSuccess,
  limit: number,
): WebSearchSuccess {
  const notes = source.notes === undefined ? [] : [...source.notes];
  if (
    source.kind === 'answer' &&
    source.answer.length > WEB_SEARCH_ANSWER_MAX_CODE_UNITS
  )
    notes.unshift('answer truncated to 8000 characters');
  const initial = capFields(source, limit);
  return initial.kind === 'results'
    ? fitResults(initial, notes, source.removed)
    : fitAnswer(initial, notes, source.removed);
}
