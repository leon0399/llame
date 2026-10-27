import { cutStringAtCodePointBoundary as capText } from '@workspace/runtime-safety';
import { canonicalHref, stripFragment } from '../web-read/locator';
import {
  type AnswerLinkRange,
  type RawAnswer,
  type RawCitation,
  type RawResult,
  type SearchChainSuccess,
  answerLinkRanges,
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
    answer: boundedText(answer.answer, WEB_SEARCH_ANSWER_MAX_CODE_UNITS),
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
    answer: boundedText(source.answer, WEB_SEARCH_ANSWER_MAX_CODE_UNITS),
    citations: capCitations(source.citations),
  };
}

const ANSWER_TRUNCATION_NOTE = 'answer truncated to 8000 characters';
/** The note of an answer output whose own text is cut further. */
const ANSWER_CUT_NOTE = 'answer cut to fit the output limit';
/**
 * The note of a results output whose last answer text is cut. The step cuts at
 * most one answer, so its note is a constant.
 */
const ATTACHED_ANSWER_CUT_NOTE = '1 answer cut to fit the output limit';

/** A text prefix of `maximum` units that does not split a link or bare URL. */
function textPrefix(
  text: string,
  maximum: number,
  ranges: ReadonlyArray<AnswerLinkRange>,
): string {
  const split = ranges.find(
    ({ start, end }) => start < maximum && end > maximum,
  );
  return capText(text, split === undefined ? maximum : split.start);
}

/** A text bounded to `maximum` units without leaving a truncated URL. */
function boundedText(text: string, maximum: number): string {
  return text.length <= maximum
    ? text
    : textPrefix(text, maximum, answerLinkRanges(text));
}

/** The longest prefix of `text` whose rendering the caller accepts. */
function longestFittingPrefix(
  text: string,
  fits: (candidate: string) => boolean,
): string | undefined {
  const ranges = answerLinkRanges(text);
  let low = 0,
    high = text.length;
  let fitting: string | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = textPrefix(text, middle, ranges);
    if (fits(candidate)) {
      fitting = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  return fitting;
}

function isOverBudget(value: WebSearchSuccess): boolean {
  return JSON.stringify(value).length > WEB_SEARCH_OUTPUT_MAX_CODE_UNITS;
}

/** What each trim step removed, formatted into one note per step. */
type TrimCounts = {
  results: number;
  citations: number;
  /** The text step cuts at most the last answer, so this is a flag. */
  answerCut: boolean;
  answers: number;
};
const NO_TRIM_COUNTS: TrimCounts = {
  results: 0,
  citations: 0,
  answerCut: false,
  answers: 0,
};

/** A drop step's note: how many entries it removed. */
function dropNote(
  count: number,
  unit: 'result' | 'citation' | 'answer',
): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} dropped to fit the output limit`;
}

/** The count notes of the trim steps that ran, in step order. */
function trimNoteList(counts: TrimCounts): Array<string> {
  return [
    counts.results === 0 ? '' : dropNote(counts.results, 'result'),
    counts.citations === 0 ? '' : dropNote(counts.citations, 'citation'),
    counts.answerCut ? ATTACHED_ANSWER_CUT_NOTE : '',
    counts.answers === 0 ? '' : dropNote(counts.answers, 'answer'),
  ].filter((note) => note !== '');
}

/** The notes of one normalized output, before they are bounded. */
type NoteInputs = {
  readonly notes: ReadonlyArray<string>;
  /** The count notes of the trim steps that ran. */
  readonly counts: TrimCounts;
  /** Whether the answer was cut further to fit beside one citation. */
  readonly answerCut: boolean;
  /** Entries the call removed, for the note that comes before the others. */
  readonly removed: number | undefined;
};

function withNotes(
  value: WebSearchSuccess,
  { notes, counts, answerCut, removed }: NoteInputs,
): WebSearchSuccess {
  const visible = [...trimNoteList(counts), ...notes];
  if (answerCut) visible.unshift(ANSWER_CUT_NOTE);
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

/**
 * Drops trailing entries of `items` while the rendered output is over its
 * bound, measuring once after each drop, and reports whether the output is
 * still over when nothing droppable is left.
 */
function dropTrailing<T>(
  items: ReadonlyArray<T>,
  floor: number,
  isOver: () => boolean,
  onDrop: (kept: Array<T>) => void,
): boolean {
  let kept = [...items];
  for (;;) {
    if (!isOver()) return false;
    if (kept.length <= floor) return true;
    kept = kept.slice(0, -1);
    onDrop(kept);
  }
}

function cutAnswer(
  output: AnswerOutput,
  notes: ReadonlyArray<string>,
  counts: TrimCounts,
  removed: number | undefined,
): WebSearchSuccess {
  const render = (answer: string): WebSearchSuccess =>
    withNotes(
      { ...output, answer },
      { notes, counts, answerCut: true, removed },
    );
  const fitting = longestFittingPrefix(
    output.answer,
    (candidate) => !isOverBudget(render(candidate)),
  );
  return render(fitting ?? '');
}

function fitAnswer(
  initial: AnswerOutput,
  notes: ReadonlyArray<string>,
  removed: number | undefined,
): WebSearchSuccess {
  const counts: TrimCounts = { ...NO_TRIM_COUNTS };
  let citations = initial.citations;
  const render = (): WebSearchSuccess =>
    withNotes(
      { ...initial, citations },
      { notes, counts, answerCut: false, removed },
    );
  const over = dropTrailing(
    initial.citations,
    1,
    () => isOverBudget(render()),
    (kept) => {
      citations = kept;
      counts.citations += 1;
    },
  );
  return over
    ? cutAnswer({ ...initial, citations }, notes, counts, removed)
    : render();
}

/** A results output while its trim steps run, with the notes they carry. */
type ResultsTrim = {
  readonly initial: ResultsOutput;
  readonly notes: ReadonlyArray<string>;
  readonly removed: number | undefined;
  readonly counts: TrimCounts;
  results: Array<RawResult>;
  answers: Array<RawAnswer>;
};

/** The current rendering of a trimmed results output, notes included. */
function renderTrimmed(trim: ResultsTrim): WebSearchSuccess {
  return withNotes(
    {
      ...trim.initial,
      results: trim.results,
      ...(trim.answers.length > 0 && { answers: trim.answers }),
    },
    {
      notes: trim.notes,
      counts: trim.counts,
      answerCut: false,
      removed: trim.removed,
    },
  );
}

/** Second trim step: each attached answer loses citations from its end. */
function trimAnswerCitations(trim: ResultsTrim): void {
  let over = isOverBudget(renderTrimmed(trim));
  for (let index = trim.answers.length - 1; index >= 0 && over; index -= 1) {
    const answer = trim.answers[index];
    over = dropTrailing(
      answer.citations,
      1,
      () => over,
      (kept) => {
        trim.answers[index] = { ...answer, citations: kept };
        trim.counts.citations += 1;
        over = isOverBudget(renderTrimmed(trim));
      },
    );
  }
}

/**
 * Third trim step: the last answer's text is cut to the longest prefix that
 * fits. When even an emptied answer does not fit, the step stops and the next
 * one drops whole answers from the end, so no earlier answer loses text while a
 * later one stays whole.
 */
function cutLastAnswerText(trim: ResultsTrim): void {
  const index = trim.answers.length - 1;
  if (index < 0) return;
  const answer = trim.answers[index];
  if (answer.answer === '' || !isOverBudget(renderTrimmed(trim))) return;
  // The note of this cut joins its own measurement.
  trim.counts.answerCut = true;
  trim.answers[index] = { ...answer, answer: '' };
  if (isOverBudget(renderTrimmed(trim))) {
    trim.answers[index] = answer;
    trim.counts.answerCut = false;
    return;
  }
  const fitting = longestFittingPrefix(answer.answer, (candidate) => {
    trim.answers[index] = { ...answer, answer: candidate };
    return !isOverBudget(renderTrimmed(trim));
  });
  trim.answers[index] = { ...answer, answer: fitting ?? '' };
}

/**
 * Fits a results output and its attached answers: trailing results go first,
 * then citations from the last answer's end while each answer keeps one, then
 * the last answer's text, then whole answers from the end. Each step keeps one
 * count note.
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
    counts: { ...NO_TRIM_COUNTS },
    results: [...initial.results],
    answers: initial.answers === undefined ? [] : [...initial.answers],
  };
  dropTrailing(
    trim.results,
    0,
    () => isOverBudget(renderTrimmed(trim)),
    (kept) => {
      trim.results = kept;
      trim.counts.results += 1;
    },
  );
  if (trim.answers.length > 0) {
    trimAnswerCitations(trim);
    cutLastAnswerText(trim);
    dropTrailing(
      trim.answers,
      0,
      () => isOverBudget(renderTrimmed(trim)),
      (kept) => {
        trim.answers = kept;
        trim.counts.answers += 1;
      },
    );
  }
  return renderTrimmed(trim);
}

/** The note for attached answers cut to the answer bound, if any. */
function truncatedAnswersNote(source: ResultSource): string | undefined {
  const truncated = (source.answers ?? []).filter(
    (answer) => answer.answer.length > WEB_SEARCH_ANSWER_MAX_CODE_UNITS,
  ).length;
  if (truncated === 0) return undefined;
  return truncated === 1
    ? ANSWER_TRUNCATION_NOTE
    : `${truncated} answers truncated to 8000 characters`;
}

/** Normalize one chain result into the bounded model-visible output. */
export function normalizeOutput(
  source: SearchChainSuccess,
  limit: number,
): WebSearchSuccess {
  const notes = source.notes === undefined ? [] : [...source.notes];
  const truncation =
    source.kind === 'answer'
      ? source.answer.length > WEB_SEARCH_ANSWER_MAX_CODE_UNITS
        ? ANSWER_TRUNCATION_NOTE
        : undefined
      : truncatedAnswersNote(source);
  if (truncation !== undefined) notes.unshift(truncation);
  const initial = capFields(source, limit);
  return initial.kind === 'results'
    ? fitResults(initial, notes, source.removed)
    : fitAnswer(initial, notes, source.removed);
}
