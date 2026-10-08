import {
  type WebSearchConfig,
  type WebSearchEngineConfig,
} from '../../instance-config/llame-config';
import { createDuckDuckGoEngine } from './duckduckgo';
import { createExaMcpEngine } from './exa-mcp';
import { createBraveEngine } from './brave';
import { createExaEngine } from './exa';
import { createPerplexityEngine } from './perplexity';
import { createSearxngEngine } from './searxng';
import { createModelHostedEngine } from './model-hosted';
import { canonicalUrl } from './output';
import { type VendorFetch } from './http';
import { type ToolContext } from '../types';

export const WEB_SEARCH_FAILURE_CLASSES = [
  'auth',
  'rate_limited',
  'challenge',
  'timeout',
  'ungrounded',
  'upstream_error',
] as const;
export type FailureClass = (typeof WEB_SEARCH_FAILURE_CLASSES)[number];
const FAILURE_MESSAGES: Record<FailureClass, string> = {
  auth: 'The web search engine rejected authentication.',
  rate_limited: 'The web search engine rate limited the request.',
  challenge: 'The web search engine presented a challenge.',
  timeout: 'The web search engine timed out.',
  ungrounded: 'The web search engine returned an ungrounded answer.',
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
};
type EmptyOutcome = {
  readonly kind: 'empty';
  readonly notes?: ReadonlyArray<string>;
};
export type EngineOutcome = ResultOutcome | AnswerOutcome | EmptyOutcome;
export type EngineRequest = {
  readonly query: string;
  readonly recency: 'day' | 'week' | 'month' | 'year' | undefined;
  readonly limit: number;
  readonly signal: AbortSignal;
  readonly userAgent: string | undefined;
  readonly chatId: string;
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
    return deadline?.aborted === true ? 'timeout' : outcome;
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
    case 'exa':
      return createExaEngine(config, deps);
    case 'exa-mcp':
      return createExaMcpEngine(config, deps);
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
      return withChainNotes(
        { ...decision.success, engine: id, query: request.query },
        notes,
      );
    if (decision.lastEmpty !== undefined) lastEmpty = decision.lastEmpty;
  }
  if (lastEmpty === undefined) return totalFailure(notes);
  const finalNotes = withoutNote(notes, lastEmpty.noteIndex);
  return emptyResult(
    request.query,
    lastEmpty.engine,
    finalNotes,
    lastEmpty.notes,
  );
}
