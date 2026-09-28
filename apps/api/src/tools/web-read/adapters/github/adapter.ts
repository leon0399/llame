import type { GithubWebAdapterConfig } from '../../../../instance-config/llame-config';
import type { WebFetchFailure, WebRequestInit } from '../../http-client';
import {
  classifyFetchFailure,
  isFatalAdapterFailure,
  omissionNote,
  rateLimitReset,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';
import {
  countGithubChecks,
  parseCheckPage,
  parseCommentsPage,
  parseFilesPage,
  parseIssuePayload,
  parsePullPayload,
  parseReviewCommentsPage,
  parseReviewsPage,
  type GithubCheckRun,
} from './payload';
import {
  renderGithubDocument,
  type GithubChecks,
  type GithubIssueDocument,
  type GithubPullDocument,
} from './document';
import {
  parseGithubUrl,
  type GithubTarget,
  type GithubThreadTarget,
} from './url';
import { readGithubCode } from './code';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
const PAGE_SIZE = 100;
const PARSE_FAILURE: WebFetchFailure = {
  type: 'parse',
  message: 'The GitHub response was not valid JSON.',
};

type JsonResult =
  | { readonly kind: 'ok'; readonly body: string }
  | { readonly kind: 'failed'; readonly failure: WebFetchFailure };
type RequestContext = {
  readonly io: WebAdapterIo;
  readonly init: WebRequestInit;
  readonly apiOrigin: string;
  readonly notes: Array<string>;
  halted?: WebFetchFailure;
};
type PageStep<T> = (
  body: string,
  page: number,
  loaded: number,
) => PageResult<T> | undefined;
type PageResult<T> = {
  readonly items: ReadonlyArray<T>;
  readonly done?: boolean;
  readonly totalCount?: number;
};
type PageSpec<T> = {
  readonly section: string;
  readonly path: string;
  readonly context: RequestContext;
  readonly step: PageStep<T>;
};
type PullListSpec<T> = {
  readonly section: string;
  readonly path: string;
  readonly parse: (body: string) => ReadonlyArray<T> | undefined;
  readonly context: RequestContext;
};
/** Creates the native GitHub adapter. */
export function createGithubAdapter(
  config: GithubWebAdapterConfig,
  options: { readonly apiOrigin?: string } = {},
): WebAdapter {
  const apiOrigin = options.apiOrigin ?? GITHUB_API_ORIGIN;
  const init = requestInit(config.token, apiOrigin);
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseGithubUrl(source) !== undefined,
    read: (source, io) => {
      const target = parseGithubUrl(source);
      return target === undefined
        ? Promise.resolve<WebAdapterOutcome>({
            kind: 'failed',
            failure: 'parse',
          })
        : readGithubTarget(target, source, { io, apiOrigin, init });
    },
  };
}

function readGithubTarget(
  target: GithubTarget,
  source: URL,
  options: {
    readonly io: WebAdapterIo;
    readonly apiOrigin: string;
    readonly init: WebRequestInit;
  },
): Promise<WebAdapterOutcome> {
  if (isGithubThreadTarget(target)) {
    return readGithubThread(
      target,
      options.io,
      options.apiOrigin,
      options.init,
    );
  }
  return readGithubCode(target, { source, ...options });
}

function isGithubThreadTarget(
  target: GithubTarget,
): target is GithubThreadTarget {
  return target.kind === 'issue' || target.kind === 'pull';
}

async function readGithubThread(
  target: GithubThreadTarget,
  io: WebAdapterIo,
  apiOrigin: string,
  init: WebRequestInit,
): Promise<WebAdapterOutcome> {
  const context: RequestContext = { io, init, apiOrigin, notes: [] };
  const primary = await requestJson(primaryUrl(target, apiOrigin), context);
  if (primary.kind === 'failed') {
    const result: WebAdapterOutcome = {
      kind: 'failed',
      failure: classifyFetchFailure(primary.failure),
    };
    const reset = rateLimitReset(primary.failure);
    const outcome = reset === undefined ? result : { ...result, reset };
    return isFatalAdapterFailure(primary.failure)
      ? { ...outcome, fatal: primary.failure }
      : outcome;
  }
  return target.kind === 'issue'
    ? renderIssue(target, primary.body, context)
    : renderPull(target, primary.body, context);
}

async function renderIssue(
  target: GithubThreadTarget,
  body: string,
  context: RequestContext,
): Promise<WebAdapterOutcome> {
  const document = parseIssuePayload(body, target);
  if (document === undefined) return { kind: 'failed', failure: 'parse' };
  const comments = (
    await loadList({
      section: 'comments',
      path: threadPath(target, 'issues', 'comments'),
      parse: parseCommentsPage,
      context,
    })
  ).items;
  return finish({ ...document, comments }, context);
}

async function renderPull(
  target: GithubThreadTarget,
  body: string,
  context: RequestContext,
): Promise<WebAdapterOutcome> {
  const primary = parsePullPayload(body, target);
  if (primary === undefined) return { kind: 'failed', failure: 'parse' };
  const sections = await loadPullSections(target, primary.headSha, context);
  return finish({ ...primary.document, ...sections }, context);
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
  const lists = await loadPullLists(target, context);
  const checks = await loadChecks(target, headSha, context);
  return { ...lists, checks };
}

async function loadPullLists(
  target: GithubThreadTarget,
  context: RequestContext,
): Promise<
  Pick<GithubPullDocument, 'comments' | 'reviews' | 'reviewComments' | 'files'>
> {
  const comments = (
    await loadList({
      section: 'comments',
      path: threadPath(target, 'issues', 'comments'),
      parse: parseCommentsPage,
      context,
    })
  ).items;
  const reviews = (
    await loadList({
      section: 'reviews',
      path: threadPath(target, 'pulls', 'reviews'),
      parse: parseReviewsPage,
      context,
    })
  ).items;
  const reviewComments = (
    await loadList({
      section: 'review comments',
      path: threadPath(target, 'pulls', 'comments'),
      parse: parseReviewCommentsPage,
      context,
    })
  ).items;
  const files = (
    await loadList({
      section: 'files',
      path: threadPath(target, 'pulls', 'files'),
      parse: parseFilesPage,
      context,
    })
  ).items;
  return { comments, reviews, reviewComments, files };
}

async function loadList<T>(spec: PullListSpec<T>): Promise<PageResult<T>> {
  return loadPaged({
    ...spec,
    step: (body) => {
      const items = spec.parse(body);
      return items === undefined
        ? undefined
        : { items, done: items.length < PAGE_SIZE };
    },
  });
}

async function loadChecks(
  target: GithubThreadTarget,
  headSha: string,
  context: RequestContext,
): Promise<GithubChecks> {
  const page = checkPageStep();
  const loaded = await loadPaged({
    section: 'check runs',
    path: `${checkRunsPath(target, headSha)}?filter=latest`,
    context,
    step: page,
  });
  return countGithubChecks(loaded.items, loaded.totalCount);
}

function checkPageStep(): PageStep<GithubCheckRun> {
  let totalCount: number | undefined;
  return (body, page, loaded) => {
    const parsed = parseCheckPage(body, page === 1);
    if (parsed === undefined) return undefined;
    if (page === 1) totalCount = parsed.totalCount;
    if (parsed.runs.length === 0 && loaded < (totalCount ?? 0)) {
      return undefined;
    }
    return {
      items: parsed.runs,
      done:
        totalCount !== undefined && loaded + parsed.runs.length >= totalCount,
      totalCount,
    };
  };
}

async function loadPaged<T>(spec: PageSpec<T>): Promise<PageResult<T>> {
  const items: Array<T> = [];
  let totalCount: number | undefined;
  for (let page = 1; ; page += 1) {
    if (spec.context.halted !== undefined) {
      recordSecondaryFailure(spec.section, spec.context.halted, spec.context);
      break;
    }
    const result = await requestJson(
      `${spec.context.apiOrigin}${spec.path}${spec.path.includes('?') ? '&' : '?'}per_page=${PAGE_SIZE}&page=${page}`,
      spec.context,
    );
    if (result.kind === 'failed') {
      recordSecondaryFailure(spec.section, result.failure, spec.context);
      break;
    }
    const parsed = spec.step(result.body, page, items.length);
    if (parsed === undefined) {
      recordSecondaryFailure(spec.section, PARSE_FAILURE, spec.context);
      break;
    }
    items.push(...parsed.items);
    if (parsed.totalCount !== undefined) totalCount = parsed.totalCount;
    if (parsed.done) return { items, totalCount };
  }
  return { items, totalCount };
}

function finish(
  document: GithubIssueDocument | GithubPullDocument,
  context: RequestContext,
): WebAdapterOutcome {
  if (context.halted !== undefined && context.halted.type !== 'call_timeout') {
    return {
      kind: 'failed',
      failure: classifyFetchFailure(context.halted),
      fatal: context.halted,
    };
  }
  return {
    kind: 'rendered',
    content: renderGithubDocument(document),
    notes: context.notes,
  };
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
  if (context.halted !== undefined) {
    return { kind: 'failed', failure: context.halted };
  }
  const fetched = await context.io.fetch(url, context.init);
  if ('type' in fetched) return { kind: 'failed', failure: fetched };
  return { kind: 'ok', body: fetched.body };
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

function primaryUrl(target: GithubThreadTarget, apiOrigin: string): string {
  const resource = target.kind === 'issue' ? 'issues' : 'pulls';
  return `${apiOrigin}${repoPath(target)}/${resource}/${target.number}`;
}

function threadPath(
  target: GithubThreadTarget,
  resource: string,
  suffix: string,
): string {
  return `${repoPath(target)}/${resource}/${target.number}/${suffix}`;
}

function checkRunsPath(target: GithubThreadTarget, headSha: string): string {
  return `${repoPath(target)}/commits/${encodeURIComponent(headSha)}/check-runs`;
}

function repoPath(target: GithubThreadTarget): string {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
}
