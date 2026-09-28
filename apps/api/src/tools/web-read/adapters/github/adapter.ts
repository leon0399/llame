import type { GithubWebAdapterConfig } from '../../../../instance-config/llame-config';
import type {
  WebFetchFailure,
  WebRequestInit,
  WebResponse,
} from '../../http-client';
import {
  classifyFetchFailure,
  isFatalAdapterFailure,
  omissionNote,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';
import {
  countGithubChecks,
  parseCheckPage,
  parseCommentsPage,
  parseFilesPage,
  parseGithubJson,
  parseIssuePayload,
  parsePullPayload,
  parseReviewCommentsPage,
  parseReviewsPage,
  type GithubCheckRun,
  type GithubJsonValue,
} from './payload';
import {
  renderGithubDocument,
  type GithubChecks,
  type GithubIssueDocument,
  type GithubPullDocument,
} from './document';
import { parseGithubThreadUrl, type GithubThreadTarget } from './url';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
const PAGE_SIZE = 100;
const PARSE_FAILURE: WebFetchFailure = {
  type: 'parse',
  message: 'The GitHub response was not valid JSON.',
};

type JsonResult =
  | { readonly kind: 'ok'; readonly value: GithubJsonValue }
  | { readonly kind: 'failed'; readonly failure: WebFetchFailure };
type RequestContext = {
  readonly io: WebAdapterIo;
  readonly init: WebRequestInit;
  readonly apiOrigin: string;
  readonly notes: Array<string>;
  halted?: WebFetchFailure;
};
type PageParser<T> = (value: GithubJsonValue) => ReadonlyArray<T> | undefined;
type PageSpec<T> = {
  readonly basePath: string;
  readonly section: string;
  readonly parse: PageParser<T>;
  readonly context: RequestContext;
};
type CheckLoad = {
  readonly runs: ReadonlyArray<GithubCheckRun>;
  readonly totalCount?: number;
};

/** Creates the native GitHub thread adapter. */
export function createGithubAdapter(
  config: GithubWebAdapterConfig,
  options: { readonly apiOrigin?: string } = {},
): WebAdapter {
  const apiOrigin = trimTrailingSlash(options.apiOrigin ?? GITHUB_API_ORIGIN);
  const init = requestInit(config.token, apiOrigin);
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseGithubThreadUrl(source) !== undefined,
    read: (source, io) => readGithubThread(source, io, apiOrigin, init),
  };
}

async function readGithubThread(
  source: URL,
  io: WebAdapterIo,
  apiOrigin: string,
  init: WebRequestInit,
): Promise<WebAdapterOutcome> {
  const target = parseGithubThreadUrl(source);
  if (target === undefined) return { kind: 'failed', failure: 'permission' };
  const context: RequestContext = { io, init, apiOrigin, notes: [] };
  const primary = await requestJson(primaryUrl(target, apiOrigin), context);
  if (primary.kind === 'failed') return primaryFailure(primary.failure);
  return target.kind === 'issue'
    ? renderIssue(target, primary.value, context)
    : renderPull(target, primary.value, context);
}

async function renderIssue(
  target: GithubThreadTarget,
  value: GithubJsonValue,
  context: RequestContext,
): Promise<WebAdapterOutcome> {
  const document = parseIssuePayload(value, target);
  if (document === undefined) return { kind: 'failed', failure: 'parse' };
  const comments = await loadPaged({
    basePath: threadPath(target, 'issues', 'comments'),
    section: 'comments',
    parse: parseCommentsPage,
    context,
  });
  return rendered({ ...document, comments }, context.notes);
}

async function renderPull(
  target: GithubThreadTarget,
  value: GithubJsonValue,
  context: RequestContext,
): Promise<WebAdapterOutcome> {
  const primary = parsePullPayload(value, target);
  if (primary === undefined) return { kind: 'failed', failure: 'parse' };
  const sections = await loadPullSections(target, primary.headSha, context);
  return rendered({ ...primary.document, ...sections }, context.notes);
}

async function loadPullSections(
  target: GithubThreadTarget,
  headSha: string,
  context: RequestContext,
): Promise<
  Pick<
    GithubPullDocument,
    'comments' | 'reviews' | 'reviewComments' | 'files' | 'checks'
  >
> {
  const comments = await loadPaged({
    basePath: threadPath(target, 'issues', 'comments'),
    section: 'comments',
    parse: parseCommentsPage,
    context,
  });
  const reviews = await loadPaged({
    basePath: threadPath(target, 'pulls', 'reviews'),
    section: 'reviews',
    parse: parseReviewsPage,
    context,
  });
  const reviewComments = await loadPaged({
    basePath: threadPath(target, 'pulls', 'comments'),
    section: 'review comments',
    parse: parseReviewCommentsPage,
    context,
  });
  const files = await loadPaged({
    basePath: threadPath(target, 'pulls', 'files'),
    section: 'files',
    parse: parseFilesPage,
    context,
  });
  const checks = await loadChecks(target, headSha, context);
  return { comments, reviews, reviewComments, files, checks };
}

function rendered(
  document: GithubIssueDocument | GithubPullDocument,
  notes: ReadonlyArray<string>,
): WebAdapterOutcome {
  const content = renderGithubDocument(document);
  return content.trim().length === 0
    ? { kind: 'failed', failure: 'empty' }
    : { kind: 'rendered', content, notes };
}

async function loadPaged<T>(spec: PageSpec<T>): Promise<ReadonlyArray<T>> {
  if (spec.context.halted !== undefined) {
    spec.context.notes.push(omissionNote(spec.section, spec.context.halted));
    return [];
  }
  const items: Array<T> = [];
  for (let page = 1; ; page += 1) {
    const result = await requestJson(
      `${spec.context.apiOrigin}${spec.basePath}?per_page=${PAGE_SIZE}&page=${page}`,
      spec.context,
    );
    if (result.kind === 'failed') {
      recordSecondaryFailure(spec.section, result.failure, spec.context);
      break;
    }
    const parsed = spec.parse(result.value);
    if (parsed === undefined) {
      recordSecondaryFailure(spec.section, PARSE_FAILURE, spec.context);
      break;
    }
    items.push(...parsed);
    if (parsed.length < PAGE_SIZE) break;
  }
  return items;
}

async function loadChecks(
  target: GithubThreadTarget,
  headSha: string,
  context: RequestContext,
): Promise<GithubChecks> {
  if (context.halted !== undefined) {
    context.notes.push(omissionNote('check runs', context.halted));
    return { kind: 'unavailable' };
  }
  const loaded = await requestCheckPages(target, headSha, context);
  return countGithubChecks(loaded.runs, loaded.totalCount);
}

async function requestCheckPages(
  target: GithubThreadTarget,
  headSha: string,
  context: RequestContext,
): Promise<CheckLoad> {
  const runs: Array<GithubCheckRun> = [];
  let totalCount: number | undefined;
  const basePath = checkRunsPath(target, headSha);
  for (let page = 1; ; page += 1) {
    const result = await requestJson(
      `${context.apiOrigin}${basePath}?filter=latest&per_page=${PAGE_SIZE}&page=${page}`,
      context,
    );
    if (result.kind === 'failed') {
      recordSecondaryFailure('check runs', result.failure, context);
      return { runs, totalCount };
    }
    const parsed = parseCheckPage(result.value, page === 1);
    if (parsed === undefined) {
      recordSecondaryFailure('check runs', PARSE_FAILURE, context);
      return { runs, totalCount };
    }
    if (page === 1) totalCount = parsed.totalCount;
    runs.push(...parsed.runs);
    if (totalCount !== undefined && runs.length >= totalCount) {
      return { runs, totalCount };
    }
    if (parsed.runs.length === 0 && totalCount !== undefined) {
      recordSecondaryFailure('check runs', PARSE_FAILURE, context);
      return { runs, totalCount };
    }
  }
}

function recordSecondaryFailure(
  section: string,
  failure: WebFetchFailure,
  context: RequestContext,
): void {
  context.notes.push(omissionNote(section, failure));
  if (isFatalAdapterFailure(failure)) context.halted = failure;
}

async function requestJson(
  url: string,
  context: RequestContext,
): Promise<JsonResult> {
  const fetched = await context.io.fetch(url, context.init);
  if (isFetchFailure(fetched)) return { kind: 'failed', failure: fetched };
  const value = parseGithubJson(fetched.body);
  return value === undefined
    ? { kind: 'failed', failure: PARSE_FAILURE }
    : { kind: 'ok', value };
}

function primaryFailure(failure: WebFetchFailure): WebAdapterOutcome {
  const outcome: WebAdapterOutcome = {
    kind: 'failed',
    failure: classifyFetchFailure(failure),
  };
  return isFatalAdapterFailure(failure)
    ? { ...outcome, fatal: failure }
    : outcome;
}

function isFetchFailure(
  value: WebResponse | WebFetchFailure,
): value is WebFetchFailure {
  return 'type' in value;
}

function requestInit(
  token: string | undefined,
  apiOrigin: string,
): WebRequestInit {
  if (token === undefined) return { accept: 'application/vnd.github+json' };
  return {
    accept: 'application/vnd.github+json',
    authorization: { origin: apiOrigin, value: `Bearer ${token}` },
  };
}

function trimTrailingSlash(origin: string): string {
  return origin.endsWith('/') ? origin.slice(0, -1) : origin;
}

function primaryUrl(target: GithubThreadTarget, apiOrigin: string): string {
  const resource = target.kind === 'issue' ? 'issues' : 'pulls';
  return `${apiOrigin}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${resource}/${target.number}`;
}

function threadPath(
  target: GithubThreadTarget,
  resource: string,
  suffix: string,
): string {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${resource}/${target.number}/${suffix}`;
}

function checkRunsPath(target: GithubThreadTarget, headSha: string): string {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/commits/${encodeURIComponent(headSha)}/check-runs`;
}
