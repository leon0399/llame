import {
  type WebSearchConfig,
  type WebSearchEngineConfig,
} from '../../instance-config/llame-config';
import { type VendorFetch } from './http';
import { createBraveEngine } from './brave';

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
  readonly recency?: 'day' | 'week' | 'month' | 'year';
  readonly limit: number;
  readonly signal: AbortSignal;
  readonly userAgent?: string;
};
export type Engine = (request: EngineRequest) => Promise<EngineOutcome>;
export type EngineLookup = (id: string) => Engine | undefined;
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
type Failures = Array<readonly [string, FailureClass]>;

function throwAbort(signal: AbortSignal): never {
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('The web search was aborted.', 'AbortError');
}
function isFailureClass(value: RunOne): value is FailureClass {
  return WEB_SEARCH_FAILURE_CLASSES.some(
    (failureClass) => failureClass === value,
  );
}
function isEmptyNotes(
  value: SearchChainSuccess | FailureClass | ReadonlyArray<string> | undefined,
): value is ReadonlyArray<string> {
  return Array.isArray(value);
}
function recordFailure(
  notes: Notes,
  failures: Failures,
  id: string,
  failureClass: FailureClass,
): void {
  failures.push([id, failureClass]);
  notes.push(`${id}: ${failureClass}`);
}
function findEngine(lookup: EngineLookup, id: string): Engine | undefined {
  try {
    return lookup(id);
  } catch {
    return undefined;
  }
}
function withChainNotes(
  result: SearchChainSuccess,
  notes: ReadonlyArray<string>,
): SearchChainSuccess {
  return notes.length === 0 ? result : { ...result, notes };
}
async function runConfiguredEngine(
  id: string,
  config: WebSearchConfig,
  request: EngineRequest,
  lookup: EngineLookup,
): Promise<RunOne> {
  const entry = config.engines.find((candidate) => candidate.id === id),
    engine = findEngine(lookup, id);
  return entry === undefined || engine === undefined
    ? 'upstream_error'
    : runOne(engine, entry, request);
}
function handleOutcome(
  id: string,
  query: string,
  outcome: RunOne,
  notes: Notes,
): SearchChainSuccess | FailureClass | ReadonlyArray<string> | undefined {
  if (isFailureClass(outcome)) return outcome;
  if (outcome.kind === 'results') {
    if (outcome.results.length === 0) {
      notes.push(`${id}: empty`);
      return undefined;
    }
    return withChainNotes(
      { kind: 'results', engine: id, query, results: outcome.results },
      notes,
    );
  }
  if (outcome.kind === 'empty') {
    notes.push(`${id}: empty`);
    return outcome.notes ?? [];
  }
  if (outcome.answer.trim() === '' || outcome.citations.length === 0)
    return 'ungrounded';
  return withChainNotes(
    {
      kind: 'answer',
      engine: id,
      query,
      answer: outcome.answer,
      citations: outcome.citations,
    },
    notes,
  );
}

async function runOne(
  engine: Engine,
  entry: WebSearchEngineConfig,
  request: EngineRequest,
): Promise<RunOne> {
  const deadline = AbortSignal.timeout(entry.timeoutSeconds * 1000),
    signal = AbortSignal.any([request.signal, deadline]);
  try {
    const outcome = await engine({ ...request, signal });
    if (request.signal.aborted) throwAbort(request.signal);
    return deadline.aborted ? 'timeout' : outcome;
  } catch (error) {
    if (request.signal.aborted) throwAbort(request.signal);
    return deadline.aborted
      ? 'timeout'
      : error instanceof EngineFailure
        ? error.failureClass
        : 'upstream_error';
  }
}

/** Build an engine adapter from one resolved entry; core supports Brave only. */
export function createEngine(
  config: WebSearchEngineConfig,
  deps: { readonly fetch: VendorFetch },
): Engine {
  switch (config.type) {
    case 'brave':
      return createBraveEngine(config, deps);
  }
}
function emptyResult(
  query: string,
  engine: string,
  notes: Notes,
  engineNotes?: ReadonlyArray<string>,
): SearchChainSuccess {
  const finalNotes = notes.filter((note) => note !== `${engine}: empty`);
  if (engineNotes !== undefined) finalNotes.push(...engineNotes);
  const result = { kind: 'results' as const, engine, query, results: [] };
  return finalNotes.length === 0 ? result : { ...result, notes: finalNotes };
}
function totalFailure(failures: Failures): SearchChainError {
  const detail = failures
    .map(([id, failureClass]) => `${id}: ${failureClass}`)
    .join('; ');
  return {
    status: 'error',
    type: 'web_search_failed',
    message: `All web search engines failed: ${detail}`,
  };
}

/** Execute a configured fallback chain, preserving only fixed failure classes. */
export async function executeSearchChain(
  config: WebSearchConfig,
  request: EngineRequest,
  lookup: EngineLookup,
): Promise<SearchChainResult> {
  const notes: Notes = [],
    failures: Failures = [];
  let lastEmpty: string | undefined,
    lastEmptyNotes: ReadonlyArray<string> | undefined;
  for (const id of config.chain) {
    if (request.signal.aborted) throwAbort(request.signal);
    const handled = handleOutcome(
      id,
      request.query,
      await runConfiguredEngine(id, config, request, lookup),
      notes,
    );
    if (handled === undefined || isEmptyNotes(handled)) {
      [lastEmpty, lastEmptyNotes] = [id, handled];
      continue;
    }
    if (isFailureClass(handled)) {
      recordFailure(notes, failures, id, handled);
      continue;
    }
    return handled;
  }
  return lastEmpty === undefined
    ? totalFailure(failures)
    : emptyResult(request.query, lastEmpty, notes, lastEmptyNotes);
}
