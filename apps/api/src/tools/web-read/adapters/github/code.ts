import type { WebFetchFailure, WebRequestInit } from '../../http-client';
import {
  classifyFetchFailure,
  isFatalAdapterFailure,
  omissionNote,
  rateLimitReset,
  MAX_ADAPTER_DOCUMENT_BYTES,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';
import {
  parseGithubBlob,
  parseGithubCommit,
  parseGithubMatchingRefs,
  parseGithubRepository,
  parseGithubTree,
  type GithubBlobPayload,
  type GithubCommitPayload,
  type GithubMatchingRef,
  type GithubRepositoryPayload,
} from './code-payload';
import { renderGithubCodeDocument } from './code-document';
import type {
  GithubBlobTarget,
  GithubCommitTarget,
  GithubRepositoryTarget,
  GithubTreeTarget,
} from './url';
import type {
  GithubCodeDocument,
  GithubCommitDocument,
  GithubRepositoryDocument,
  GithubTreeEntry,
} from './code-document';

type GithubCodeTarget =
  | GithubRepositoryTarget
  | GithubTreeTarget
  | GithubBlobTarget
  | GithubCommitTarget;

const PARSE_FAILURE: WebFetchFailure = {
  type: 'parse',
  message: 'The GitHub response was not valid JSON.',
};
const BODY_TOO_LARGE: WebFetchFailure = {
  type: 'body_too_large',
  message: 'The response body exceeds the 5 MiB limit.',
};
const HEX_SHA = /^[0-9a-fA-F]{40}$/u;

type JsonResult =
  | { readonly kind: 'ok'; readonly body: string }
  | { readonly kind: 'failed'; readonly failure: WebFetchFailure };
type CodeContext = {
  readonly source: URL;
  readonly io: WebAdapterIo;
  readonly init: WebRequestInit;
  readonly apiOrigin: string;
  readonly notes: Array<string>;
  halted?: WebFetchFailure;
};
type ResolvedResponse = {
  readonly body: string;
  readonly path: ReadonlyArray<string>;
};
type ResolveResult =
  | { readonly kind: 'ok'; readonly response: ResolvedResponse }
  | { readonly kind: 'failed'; readonly failure: WebFetchFailure };
type CandidateResult =
  | { readonly kind: 'found'; readonly ref: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly failure: WebFetchFailure };
type CodeRequest = (
  ref: string,
  path: ReadonlyArray<string>,
) => Promise<JsonResult>;
type RepositoryLike =
  | GithubRepositoryTarget
  | GithubTreeTarget
  | GithubBlobTarget
  | GithubCommitTarget;
type ResolutionContext = {
  readonly target: RepositoryLike;
  readonly context: CodeContext;
};
type BlobDecodeResult =
  | { readonly kind: 'ok'; readonly content: string }
  | {
      readonly kind: 'failed';
      readonly failure: 'parse' | 'binary' | 'too_large';
    };

/** Fetches and renders a claimed GitHub repository-code locator. */
export async function readGithubCode(
  target: GithubCodeTarget,
  options: {
    readonly source: URL;
    readonly io: WebAdapterIo;
    readonly apiOrigin: string;
    readonly init: WebRequestInit;
  },
): Promise<WebAdapterOutcome> {
  const context: CodeContext = {
    source: options.source,
    io: options.io,
    init: options.init,
    apiOrigin: options.apiOrigin,
    notes: [],
  };
  switch (target.kind) {
    case 'repository':
      return readRepository(target, context);
    case 'tree':
      return readTree(target, context);
    case 'blob':
      return readBlob(target, context);
    case 'commit':
      return readCommit(target, context);
  }
}
async function readRepository(
  target: GithubRepositoryTarget,
  context: CodeContext,
): Promise<WebAdapterOutcome> {
  const primary = await requestJson(
    `${context.apiOrigin}${repoPath(target)}`,
    context,
  );
  if (primary.kind === 'failed') return primaryFailure(primary.failure);
  const repository = parseGithubRepository(primary.body);
  if (repository === undefined) return directFailure('parse');
  const document = await loadRepositorySections(repository, target, context);
  return finish(document, context);
}

async function loadRepositorySections(
  repository: GithubRepositoryPayload,
  target: GithubRepositoryTarget,
  context: CodeContext,
): Promise<GithubRepositoryDocument> {
  const entries = await loadRootTree(repository.defaultBranch, target, context);
  const readme = await loadReadme(target, context);
  return {
    kind: 'repository',
    displayPath: context.source.href,
    description: repository.description,
    defaultBranch: repository.defaultBranch,
    visibility: repository.visibility,
    language: repository.language,
    ...(entries !== undefined && { entries }),
    ...(readme !== undefined && { readme }),
  };
}

async function loadRootTree(
  ref: string,
  target: GithubRepositoryTarget,
  context: CodeContext,
) {
  const path = `${context.apiOrigin}${treePath(target, ref, [])}?recursive=1`;
  const result = await requestJson(path, context);
  if (result.kind === 'failed') {
    recordSecondaryFailure('tree', result.failure, context);
    return undefined;
  }
  const tree = parseGithubTree(result.body);
  if (tree === undefined) {
    recordSecondaryFailure('tree', PARSE_FAILURE, context);
    return undefined;
  }
  return tree.entries;
}

async function loadReadme(
  target: GithubRepositoryTarget,
  context: CodeContext,
): Promise<string | undefined> {
  const result = await requestJson(
    `${context.apiOrigin}${repoPath(target)}/readme`,
    context,
  );
  if (result.kind === 'failed') {
    recordSecondaryFailure('README', result.failure, context);
    return undefined;
  }
  const decoded = decodeBlob(result.body);
  if (decoded.kind === 'failed') {
    recordSecondaryCodeFailure('README', decoded.failure, context);
    return undefined;
  }
  return decoded.content;
}

async function readTree(
  target: GithubTreeTarget,
  context: CodeContext,
): Promise<WebAdapterOutcome> {
  const resolution = { target, context };
  const resolved = await resolveRef(target.segments, resolution, (ref, path) =>
    requestJson(
      `${context.apiOrigin}${treePath(target, ref, path)}?recursive=1`,
      context,
    ),
  );
  if (resolved.kind === 'failed') return primaryFailure(resolved.failure);
  const tree = parseGithubTree(resolved.response.body);
  if (tree === undefined) return directFailure('parse');
  const entries = stripTreePrefix(tree.entries, resolved.response.path);
  return finish(
    { kind: 'tree', displayPath: context.source.href, entries },
    context,
  );
}

async function readBlob(
  target: GithubBlobTarget,
  context: CodeContext,
): Promise<WebAdapterOutcome> {
  const resolution = { target, context };
  const resolved = await resolveRef(target.segments, resolution, (ref, path) =>
    requestJson(
      `${context.apiOrigin}${contentsPath(target, path)}?${refQuery(ref)}`,
      context,
    ),
  );
  if (resolved.kind === 'failed') return primaryFailure(resolved.failure);
  const parsed = parseGithubBlob(resolved.response.body);
  if (parsed === undefined || parsed.kind === 'directory') {
    return directFailure('parse');
  }
  const decoded = decodeBlobPayload(parsed.payload);
  if (decoded.kind === 'failed') return directFailure(decoded.failure);
  return { kind: 'rendered', content: decoded.content, notes: context.notes };
}

async function readCommit(
  target: GithubCommitTarget,
  context: CodeContext,
): Promise<WebAdapterOutcome> {
  const result = await requestJson(
    `${context.apiOrigin}${repoPath(target)}/commits/${encodeURIComponent(target.sha)}`,
    context,
  );
  if (result.kind === 'failed') return primaryFailure(result.failure);
  const commit = parseGithubCommit(result.body);
  if (commit === undefined) return directFailure('parse');
  return finish(commitDocument(target, commit), context);
}

function commitDocument(
  target: GithubCommitTarget,
  commit: GithubCommitPayload,
): GithubCommitDocument {
  return {
    kind: 'commit',
    sha: commit.sha,
    message: commit.message,
    author: commit.author,
    authoredAt: commit.authoredAt,
    files: commit.files,
    diffUrl: `https://github.com/${target.owner}/${target.repo}/commit/${target.sha}.diff`,
  };
}

async function resolveRef(
  segments: ReadonlyArray<string>,
  resolution: ResolutionContext,
  request: CodeRequest,
): Promise<ResolveResult> {
  const first = segments[0];
  if (first === undefined) return { kind: 'failed', failure: PARSE_FAILURE };
  const initial = await request(first, segments.slice(1));
  if (initial.kind === 'ok') {
    return {
      kind: 'ok',
      response: { body: initial.body, path: segments.slice(1) },
    };
  }
  if (!canResolveRef(first, segments, initial.failure)) {
    return { kind: 'failed', failure: initial.failure };
  }
  const locator = segments.join('/');
  const heads = await matchingCandidate('heads', first, locator, resolution);
  if (heads.kind === 'failed') return heads;
  const candidate =
    heads.kind === 'found'
      ? heads
      : await matchingCandidate('tags', first, locator, resolution);
  if (candidate.kind !== 'found') {
    return candidate.kind === 'failed'
      ? candidate
      : { kind: 'failed', failure: initial.failure };
  }
  return retryResolvedRef(candidate.ref, segments, request);
}

async function retryResolvedRef(
  ref: string,
  segments: ReadonlyArray<string>,
  request: CodeRequest,
): Promise<ResolveResult> {
  const refSegments = ref.split('/');
  const retry = await request(ref, segments.slice(refSegments.length));
  if (retry.kind === 'failed') return retry;
  return {
    kind: 'ok',
    response: {
      body: retry.body,
      path: segments.slice(refSegments.length),
    },
  };
}
function canResolveRef(
  first: string,
  segments: ReadonlyArray<string>,
  failure: WebFetchFailure,
): boolean {
  const notFound =
    failure.httpStatus === 404 || /\bHTTP\s+404(?:\D|$)/u.test(failure.message);
  return notFound && segments.length > 1 && !HEX_SHA.test(first);
}

async function matchingCandidate(
  namespace: 'heads' | 'tags',
  first: string,
  locator: string,
  resolution: ResolutionContext,
): Promise<CandidateResult> {
  const path = `${resolution.context.apiOrigin}${matchingRefsPath(
    resolution.target,
    namespace,
    first,
  )}`;
  const result = await requestJson(path, resolution.context);
  if (result.kind === 'failed') {
    return result.failure.httpStatus === 404
      ? { kind: 'none' }
      : { kind: 'failed', failure: result.failure };
  }
  const refs = parseGithubMatchingRefs(result.body);
  if (refs === undefined) return { kind: 'failed', failure: PARSE_FAILURE };
  const ref = longestCandidate(refs, locator, namespace);
  return ref === undefined ? { kind: 'none' } : { kind: 'found', ref };
}

function longestCandidate(
  refs: ReadonlyArray<GithubMatchingRef>,
  locator: string,
  namespace: 'heads' | 'tags',
): string | undefined {
  const prefix = `refs/${namespace}/`;
  let longest: string | undefined;
  for (const item of refs) {
    if (!item.ref.startsWith(prefix)) continue;
    const candidate = item.ref.slice(prefix.length);
    if (candidate.length === 0) continue;
    if (locator !== candidate && !locator.startsWith(`${candidate}/`)) continue;
    if (longest === undefined || candidate.length > longest.length) {
      longest = candidate;
    }
  }
  return longest;
}
function stripTreePrefix(
  entries: ReadonlyArray<GithubTreeEntry>,
  path: ReadonlyArray<string>,
): ReadonlyArray<GithubTreeEntry> {
  const prefix = path.join('/');
  if (prefix === '') return entries;
  const marker = `${prefix}/`;
  return entries.flatMap((entry) => {
    if (!entry.path.startsWith(marker)) return [];
    return [{ ...entry, path: entry.path.slice(marker.length) }];
  });
}

function decodeBlobPayload(payload: GithubBlobPayload): BlobDecodeResult {
  if (payload.size !== undefined && payload.size > MAX_ADAPTER_DOCUMENT_BYTES) {
    return { kind: 'failed', failure: 'too_large' };
  }
  if (
    payload.encoding !== 'base64' ||
    ((payload.size ?? 0) > 0 && payload.content === '')
  ) {
    return { kind: 'failed', failure: 'binary' };
  }
  const bytes = decodeBase64(payload.content);
  if (bytes === undefined || bytes.includes(0)) {
    return { kind: 'failed', failure: 'binary' };
  }
  try {
    return {
      kind: 'ok',
      content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    };
  } catch {
    return { kind: 'failed', failure: 'binary' };
  }
}

function decodeBlob(body: string): BlobDecodeResult {
  const parsed = parseGithubBlob(body);
  if (parsed === undefined || parsed.kind === 'directory') {
    return { kind: 'failed', failure: 'parse' };
  }
  return decodeBlobPayload(parsed.payload);
}

function decodeBase64(content: string): Uint8Array | undefined {
  const compact = content.replaceAll(/\s+/gu, '');
  if (compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) {
    return undefined;
  }
  return Uint8Array.from(Buffer.from(compact, 'base64'));
}

async function requestJson(
  url: string,
  context: CodeContext,
): Promise<JsonResult> {
  if (context.halted !== undefined) {
    return { kind: 'failed', failure: context.halted };
  }
  const fetched = await context.io.fetch(url, context.init);
  if ('type' in fetched) return { kind: 'failed', failure: fetched };
  const size = new TextEncoder().encode(fetched.body).byteLength;
  if (size > MAX_ADAPTER_DOCUMENT_BYTES) {
    return { kind: 'failed', failure: BODY_TOO_LARGE };
  }
  return { kind: 'ok', body: fetched.body };
}

function finish(
  document: GithubCodeDocument,
  context: CodeContext,
): WebAdapterOutcome {
  if (context.halted?.type === 'aborted') {
    return { kind: 'failed', failure: 'transport', fatal: context.halted };
  }
  return {
    kind: 'rendered',
    content: renderGithubCodeDocument(document),
    notes: context.notes,
  };
}

function recordSecondaryFailure(
  section: string,
  failure: WebFetchFailure,
  context: CodeContext,
): void {
  context.notes.push(omissionNote(section, failure));
  if (isFatalAdapterFailure(failure)) context.halted = failure;
}

function recordSecondaryCodeFailure(
  section: string,
  failure: 'parse' | 'binary' | 'too_large',
  context: CodeContext,
): void {
  context.notes.push(`${section} omitted: ${failure}`);
}

function primaryFailure(failure: WebFetchFailure): WebAdapterOutcome {
  const reset = rateLimitReset(failure);
  const outcome: WebAdapterOutcome = {
    kind: 'failed',
    failure: classifyFetchFailure(failure),
    ...(reset !== undefined && { reset }),
  };
  return isFatalAdapterFailure(failure)
    ? { ...outcome, fatal: failure }
    : outcome;
}

function directFailure(
  failure: 'parse' | 'binary' | 'too_large',
): WebAdapterOutcome {
  return { kind: 'failed', failure };
}

function repoPath(target: RepositoryLike): string {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
}

function treePath(
  target: GithubTreeTarget | GithubRepositoryTarget,
  ref: string,
  path: ReadonlyArray<string>,
): string {
  const suffix = encodeURIComponent(ref);
  const pathText = path.map(encodeURIComponent).join('/');
  return `${repoPath(target)}/git/trees/${suffix}${pathText === '' ? '' : `:${pathText}`}`;
}

function contentsPath(
  target: GithubBlobTarget,
  path: ReadonlyArray<string>,
): string {
  return `${repoPath(target)}/contents/${path.map(encodeURIComponent).join('/')}`;
}

function matchingRefsPath(
  target: RepositoryLike,
  namespace: 'heads' | 'tags',
  first: string,
): string {
  return `${repoPath(target)}/git/matching-refs/${namespace}/${encodeURIComponent(first)}`;
}

function refQuery(ref: string): string {
  return new URLSearchParams({ ref }).toString();
}
