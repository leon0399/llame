import { parseHTML } from 'linkedom';
import {
  type WebSearchConfig,
  type WebSearchEngineConfig,
} from '../../instance-config/web-search-config';
import { createDuckDuckGoEngine } from './duckduckgo';
import { createExaMcpEngine } from './exa-mcp';
import { createBraveEngine } from './brave';
import { createDeepseekEngine } from './deepseek';
import { createExaEngine } from './exa';
import { createParallelEngine } from './parallel';
import { createPerplexityEngine } from './perplexity';
import { createSearxngEngine } from './searxng';
import { createModelHostedEngine } from './model-hosted';
import { canonicalUrl } from './output';
import { ENGINE_LIMITS, acceptsQuery } from './limits';
import { type ResultRemoval } from './removal';
import { type VendorFetch } from './http';
import { type ToolContext } from '../types';

export const WEB_SEARCH_FAILURE_CLASSES = [
  'auth',
  'rate_limited',
  'challenge',
  'timeout',
  'ungrounded',
  'unsupported',
  'upstream_error',
] as const;
export type FailureClass = (typeof WEB_SEARCH_FAILURE_CLASSES)[number];
const FAILURE_MESSAGES: Record<FailureClass, string> = {
  auth: 'The web search engine rejected authentication.',
  rate_limited: 'The web search engine rate limited the request.',
  challenge: 'The web search engine presented a challenge.',
  timeout: 'The web search engine timed out.',
  ungrounded: 'The web search engine returned an ungrounded answer.',
  unsupported: 'The web search engine does not accept this query.',
  upstream_error: 'The web search engine failed upstream.',
};

/** A fixed, non-disclosing engine failure. */
export class EngineFailure extends Error {
  readonly failureClass: FailureClass;
  constructor(failureClass: FailureClass) {
    super(FAILURE_MESSAGES[failureClass]);
    this.name = 'EngineFailure';
    this.failureClass = failureClass;
  }
}

export type RawResult = {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
  readonly published?: string;
};
export type RawCitation = { readonly url: string; readonly title?: string };
type ResultOutcome = {
  readonly kind: 'results';
  readonly results: ReadonlyArray<RawResult>;
  readonly notes?: ReadonlyArray<string>;
};
type AnswerOutcome = {
  readonly kind: 'answer';
  readonly answer: string;
  readonly citations: ReadonlyArray<RawCitation>;
  /** Engine notes that accompany a grounded answer, as for a result list. */
  readonly notes?: ReadonlyArray<string>;
};
type EmptyOutcome = {
  readonly kind: 'empty';
  readonly notes?: ReadonlyArray<string>;
};
export type EngineOutcome = ResultOutcome | AnswerOutcome | EmptyOutcome;
export type EngineRequest = {
  readonly query: string;
  /** The model's goal for this search; engines without the field ignore it. */
  readonly objective: string | undefined;
  readonly recency: 'day' | 'week' | 'month' | 'year' | undefined;
  readonly limit: number;
  readonly signal: AbortSignal;
  readonly userAgent: string | undefined;
  readonly chatId: string;
  /**
   * Removes the entries the call excludes — a `read` reject clause, or a
   * `-site:` host of the query — before the chain or an aggregate decides.
   */
  readonly removal: ResultRemoval;
  /**
   * Trusted model-client factory for model-hosted engines; absent leaves them
   * failing closed.
   */
  readonly modelClients?: ToolContext['modelClients'];
};
export type Engine = (request: EngineRequest) => Promise<EngineOutcome>;
export type EngineLookup = (id: string) => Engine;
type ChainBase = {
  readonly engine: string;
  readonly query: string;
  readonly notes?: ReadonlyArray<string>;
  /** Entries this call removed, for the output layer's one count note. */
  readonly removed?: number;
};
export type SearchChainSuccess =
  | (ChainBase & ResultOutcome)
  | (ChainBase & AnswerOutcome);
export type SearchChainError = {
  readonly status: 'error';
  readonly type: 'web_search_failed';
  readonly message: string;
};
export type SearchChainResult = SearchChainSuccess | SearchChainError;
type RunOne = EngineOutcome | FailureClass;
type Notes = Array<string>;
type LastEmpty = {
  readonly engine: string;
  readonly noteIndex: number;
  readonly notes?: ReadonlyArray<string>;
};
type OutcomeDecision =
  | { readonly kind: 'continue'; readonly lastEmpty?: LastEmpty }
  | {
      readonly kind: 'success';
      readonly success: ResultOutcome | AnswerOutcome;
    };

export function throwAbort(signal: AbortSignal): never {
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('The web search was aborted.', 'AbortError');
}

export function isFailureClass(value: RunOne): value is FailureClass {
  return WEB_SEARCH_FAILURE_CLASSES.some(
    (failureClass) => failureClass === value,
  );
}

function withChainNotes(
  result: SearchChainSuccess,
  notes: ReadonlyArray<string>,
): SearchChainSuccess {
  const finalNotes = [...notes, ...(result.notes ?? [])];
  return finalNotes.length === 0 ? result : { ...result, notes: finalNotes };
}

export function canonicalizeResults(
  results: ReadonlyArray<RawResult>,
): Array<RawResult> {
  return results.flatMap((result) => {
    const url = canonicalUrl(result.url);
    return url === undefined ? [] : [{ ...result, url }];
  });
}

function canonicalizeCitations(
  citations: ReadonlyArray<RawCitation>,
): Array<RawCitation> {
  const seen = new Set<string>();
  return citations.flatMap((citation) => {
    const url = canonicalUrl(citation.url);
    if (url === undefined || seen.has(url)) return [];
    seen.add(url);
    return [{ ...citation, url }];
  });
}

function canonicalizeOutcome(
  outcome: ResultOutcome | AnswerOutcome,
): ResultOutcome | AnswerOutcome {
  return outcome.kind === 'results'
    ? { ...outcome, results: canonicalizeResults(outcome.results) }
    : { ...outcome, citations: canonicalizeCitations(outcome.citations) };
}

/**
 * A Markdown inline link: its text and the destination it points at, in either
 * CommonMark form. A bare destination can hold balanced parentheses one level
 * deep (`/wiki/Foo_(bar)`) and an escaped character; a pointy destination is
 * wrapped in `<` and `>`. An optional title follows after whitespace, delimited
 * by `"`, `'`, or `(`. Each repeated alternative starts with a different
 * character, so a hostile line cannot make the engine backtrack.
 */
const MARKDOWN_LINK =
  /\[([^[\]\n]*)\]\([ \t\n]*(?:<([^<>\n]*)>|((?:[^()\s\\]|\\[!-/:-@[-`{-~]|\([^()\s]*\))*))(?:[ \t\n]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t\n]*\)/gu;
/**
 * A URL written as itself rather than as a Markdown link target, with balanced
 * parentheses one level deep. The last character cannot be sentence
 * punctuation or Markdown emphasis, so deleting a copy keeps the text around it
 * intact.
 */
const BARE_URL =
  /\bhttps?:\/\/(?:[^\s<>()[\]"'`]|\([^\s<>()[\]"'`]*\))*(?:[^\s<>()[\]"'`.,;:!?*_]|\([^\s<>()[\]"'`]*\))/giu;
/**
 * A CommonMark backslash escape: a backslash before one ASCII punctuation
 * character stands for that character alone.
 */
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/gu;
/**
 * A raw HTML anchor opening tag in answer text, whose quoted attribute values
 * may hold a `>` or a `<`. Each repeated alternative starts with a different
 * character, so a hostile answer cannot make the engine backtrack.
 */
const HTML_ANCHOR = /<a\b((?:[^<>"']|"[^"]*"|'[^']*')*)>/giu;
/**
 * The `href` of one anchor's attributes, which must start the list or follow
 * whitespace so `data-href` is not one. An unquoted value ends at a space.
 */
const HTML_HREF = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/iu;
/**
 * A link reference definition: its label and the destination that a reference
 * elsewhere in the answer resolves to. The renderer builds that link's `href`
 * from the destination, so it is a target like an inline one.
 */
const LINK_DEFINITION =
  /^ {0,3}\[[^[\]\n]+\]:[ \t]*(?:<([^<>\n]*)>|(\S+))[^\n]*$/gmu;

/** A detached body element that decodes the HTML set into it when read back. */
type ReferenceBody = { innerHTML: string; readonly textContent: string | null };

/**
 * The body `decodeCharacterReferences` parses into, created on first use:
 * removal only decodes a target that carries a reference or an escape, and a
 * document parse per such link would cost more than the search.
 */
let referenceBody: ReferenceBody | undefined;

/**
 * Decodes HTML character references a target can carry (`&colon;`, `&#58;`,
 * `&#x3a;`) the way the renderer does before it builds a link's `href`.
 */
function decodeCharacterReferences(text: string): string {
  referenceBody ??= parseHTML('<!doctype html><html><body></body></html>')
    .document.body;
  // safe-html: never rendered — linkedom decodes a link target's character references so removal can read the result back as text
  referenceBody.innerHTML = text;
  return String(referenceBody.textContent);
}

/**
 * A Markdown link target as the renderer reads it: CommonMark decodes a
 * backslash escape and a character reference before the renderer builds the
 * `href`. Removal decides on the decoded target, because `https&#58;//host/`
 * and `https\://host/` are not URLs on their own but render as live links to
 * `https://host/`.
 */
function decodeMarkdownTarget(target: string): string {
  const unescaped = target.includes('\\')
    ? target.replace(MARKDOWN_ESCAPE, '$1')
    : target;
  return unescaped.includes('&')
    ? decodeCharacterReferences(unescaped)
    : unescaped;
}

/**
 * The steps one answer's text goes through before the chain sees it: a raw
 * anchor whose `href` the renderer decodes, a Markdown link target, a link
 * reference definition's destination, and a bare copy of a URL. Each step
 * decides on what the renderer decodes, so an encoded spelling of a removed
 * URL cannot survive as a live link.
 */
function withoutRemovedTargets(answer: string, removal: ResultRemoval): string {
  return answer
    .replace(HTML_ANCHOR, (tag: string, attributes: string) => {
      const href = HTML_HREF.exec(attributes);
      const target = href?.[1] ?? href?.[2] ?? href?.[3];
      if (target === undefined) return tag;
      // HTML decodes character references in an attribute and leaves a
      // backslash alone.
      const value = target.includes('&')
        ? decodeCharacterReferences(target)
        : target;
      // The anchor loses its tag and keeps its text; the closing tag left
      // behind cannot start a link, so the HTML5 parser drops it.
      return removal.removes(value) ? '' : tag;
    })
    .replace(
      MARKDOWN_LINK,
      (
        link,
        text: string,
        angled: string | undefined,
        bare: string | undefined,
      ) => {
        const target = angled ?? bare ?? '';
        const decoded = decodeMarkdownTarget(target);
        if (!removal.removes(decoded) && !removal.removes(target)) return link;
        const label = text.trim().toLowerCase();
        const shown = (canonicalUrl(decoded) ?? decoded).toLowerCase();
        // A label that spells the removed target or its host is a bare copy of
        // the entry, not text worth keeping.
        return [shown, URL.parse(shown)?.hostname].includes(label) ? '' : text;
      },
    )
    .replace(
      LINK_DEFINITION,
      (line: string, angled: string | undefined, bare: string | undefined) => {
        const target = angled ?? bare;
        return target !== undefined &&
          removal.removes(decodeMarkdownTarget(target))
          ? ''
          : line;
      },
    )
    .replace(BARE_URL, (url) => (removal.removes(url) ? '' : url));
}

/**
 * Removes the entries the call excludes from one engine outcome, before the
 * chain decides on it and before an aggregate merges and cuts it. An answer
 * keeps the text of a link it loses and the text loses its target; a link whose
 * text is itself the removed URL or its host is a bare copy and goes whole, so
 * a removed URL survives nowhere. An answer whose citations are all removed has
 * none left, which the chain reports as `ungrounded`.
 */
function removeEntries(
  outcome: EngineOutcome,
  removal: ResultRemoval,
): EngineOutcome {
  if (outcome.kind === 'results') {
    const results = outcome.results.filter((result) => {
      if (!removal.removes(result.url)) return true;
      removal.count(result.url);
      return false;
    });
    return { ...outcome, results };
  }
  if (outcome.kind === 'answer') {
    const citations = outcome.citations.filter((citation) => {
      if (!removal.removes(citation.url)) return true;
      removal.count(citation.url);
      return false;
    });
    return {
      ...outcome,
      answer: withoutRemovedTargets(outcome.answer, removal),
      citations,
    };
  }
  return outcome;
}

export async function runOne(
  engine: Engine,
  timeoutSeconds: number | undefined,
  request: EngineRequest,
): Promise<RunOne> {
  const deadline =
    timeoutSeconds === undefined
      ? undefined
      : AbortSignal.timeout(timeoutSeconds * 1000);
  const signal =
    deadline === undefined
      ? request.signal
      : AbortSignal.any([request.signal, deadline]);
  try {
    const outcome = await engine({ ...request, signal });
    if (request.signal.aborted) throwAbort(request.signal);
    if (deadline?.aborted === true) return 'timeout';
    return removeEntries(outcome, request.removal);
  } catch (error) {
    if (request.signal.aborted) throwAbort(request.signal);
    return deadline?.aborted === true
      ? 'timeout'
      : error instanceof EngineFailure
        ? error.failureClass
        : 'upstream_error';
  }
}

/** Build an engine adapter from one resolved entry. */
export function createEngine(
  config: Exclude<WebSearchEngineConfig, { type: 'aggregate' }>,
  deps: {
    readonly fetch: VendorFetch;
  },
): Engine {
  switch (config.type) {
    case 'brave':
      return createBraveEngine(config, deps);
    case 'deepseek':
      return createDeepseekEngine(config, deps);
    case 'exa':
      return createExaEngine(config, deps);
    case 'exa-mcp':
      return createExaMcpEngine(config, deps);
    case 'parallel':
      return createParallelEngine(config, deps);
    case 'perplexity':
      return createPerplexityEngine(config, deps);
    case 'searxng':
      return createSearxngEngine(config, deps);
    case 'duckduckgo':
      return createDuckDuckGoEngine(deps);
    case 'model-hosted':
      return createModelHostedEngine(config);
  }
}

function emptyResult(
  query: string,
  engine: string,
  notes: Notes,
  engineNotes?: ReadonlyArray<string>,
): SearchChainSuccess {
  const finalNotes =
    engineNotes === undefined ? notes : [...notes, ...engineNotes];
  const result = { kind: 'results' as const, engine, query, results: [] };
  return finalNotes.length === 0 ? result : { ...result, notes: finalNotes };
}
function withoutNote(notes: Notes, noteIndex: number): Notes {
  return [...notes.slice(0, noteIndex), ...notes.slice(noteIndex + 1)];
}
function classifyOutcome(
  id: string,
  outcome: RunOne,
  notes: Notes,
): OutcomeDecision {
  if (isFailureClass(outcome)) {
    notes.push(`${id}: ${outcome}`);
    return { kind: 'continue' };
  }
  const success =
    outcome.kind === 'empty' ? outcome : canonicalizeOutcome(outcome);
  if (
    success.kind === 'empty' ||
    (success.kind === 'results' && success.results.length === 0)
  ) {
    notes.push(`${id}: empty`);
    return {
      kind: 'continue',
      lastEmpty: {
        engine: id,
        noteIndex: notes.length - 1,
        notes: success.notes,
      },
    };
  }
  if (
    success.kind === 'answer' &&
    (success.answer.trim() === '' || success.citations.length === 0)
  ) {
    notes.push(`${id}: ungrounded`);
    return { kind: 'continue' };
  }
  return { kind: 'success', success };
}

/**
 * Attaches the call's removed-entry count, which the output layer turns into
 * the one note that comes before every other note.
 */
function withRemoved(
  result: SearchChainSuccess,
  removal: ResultRemoval,
): SearchChainSuccess {
  const removed = removal.removedCount();
  return removed === 0 ? result : { ...result, removed };
}

function totalFailure(notes: ReadonlyArray<string>): SearchChainError {
  return {
    status: 'error',
    type: 'web_search_failed',
    message: `All web search engines failed: ${notes.join('; ')}`,
  };
}

/** Execute a configured fallback chain, preserving only fixed failure classes. */
export async function executeSearchChain(
  config: WebSearchConfig,
  request: EngineRequest,
  lookup: EngineLookup,
): Promise<SearchChainResult> {
  const notes: Notes = [];
  let lastEmpty: LastEmpty | undefined;
  for (const id of config.chain) {
    if (request.signal.aborted) throwAbort(request.signal);
    const entry = config.engines.find((candidate) => candidate.id === id)!;
    // A local decision, not a vendor failure: the request is never sent.
    if (!acceptsQuery(ENGINE_LIMITS[entry.type], request.query)) {
      notes.push(`${id}: unsupported`);
      continue;
    }
    const decision = classifyOutcome(
      id,
      await runOne(
        lookup(id),
        entry.type === 'aggregate' ? undefined : entry.timeoutSeconds,
        request,
      ),
      notes,
    );
    if (decision.kind === 'success')
      return withRemoved(
        withChainNotes(
          { ...decision.success, engine: id, query: request.query },
          notes,
        ),
        request.removal,
      );
    if (decision.lastEmpty !== undefined) lastEmpty = decision.lastEmpty;
  }
  if (lastEmpty === undefined) return totalFailure(notes);
  const finalNotes = withoutNote(notes, lastEmpty.noteIndex);
  return withRemoved(
    emptyResult(request.query, lastEmpty.engine, finalNotes, lastEmpty.notes),
    request.removal,
  );
}
