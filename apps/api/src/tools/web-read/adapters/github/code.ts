import {
  DIRECTORY_TRAVERSAL_BUDGET,
  fileMediaType,
} from '@workspace/native-file-tools';
import type { WebFetchFailure, WebRequestInit } from '../../http-client';

import {
  MAX_ADAPTER_DOCUMENT_BYTES,
  primaryFailure,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';
import {
  PARSE_FAILURE,
  finishRendered,
  recordSecondaryFailure,
  repoPath,
  requestJson,
  type GithubJsonResult,
  type GithubRequestContext,
} from './request';
import {
  parseGithubBlob,
  parseGithubCommit,
  parseGithubCommitFiles,
  parseGithubMatchingRefs,
  parseGithubRepository,
  parseGithubTree,
  type GithubBlobPayload,
  type GithubMatchingRef,
  type GithubRepositoryPayload,
} from './code-payload';
import {
  renderGithubCodeDocument,
  toGithubDirectoryEntries,
} from './code-document';
import type { GithubFile } from './document';
import type {
  GithubCodeDocument,
  GithubRepositoryDocument,
} from './code-document';
import type {
  GithubCommitTarget,
  GithubPathTarget,
  GithubRepositoryTarget,
} from './url';

type GithubCodeTarget =
  | GithubRepositoryTarget
  | GithubPathTarget
  | GithubCommitTarget;

const HEX_SHA = /^[0-9a-fA-F]{40}$/u;
const PAGE_SIZE = 100;
const MAX_COMMIT_FILES = 3000;

type CodeContext = GithubRequestContext & { readonly source: URL };
type ResolveResult =
  | {
      readonly kind: 'ok';
      readonly body: string;
      readonly path: ReadonlyArray<string>;
    }
  | { readonly kind: 'failed'; readonly failure: WebFetchFailure };
type CandidateResult =
  | { readonly kind: 'found'; readonly ref: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly failure: WebFetchFailure };
type CodeRequest = (
  ref: string,
  path: ReadonlyArray<string>,
) => Promise<GithubJsonResult>;
type BlobDecodeResult =
  | { readonly kind: 'ok'; readonly content: string }
  | {
      readonly kind: 'failed';
      readonly failure: 'parse' | 'binary' | 'too_large';
    };
type MatchingRefsRequest = (
  namespace: 'heads' | 'tags',
  first: string,
) => Promise<GithubJsonResult>;

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
  const context: CodeContext = { ...options, notes: [] };
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
  if (repository === undefined) return { kind: 'failed', failure: 'parse' };
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
  const entries = parseGithubTree(result.body);
  if (entries === undefined) {
    recordSecondaryFailure('tree', PARSE_FAILURE, context);
    return undefined;
  }
  if (toGithubDirectoryEntries(entries).length > DIRECTORY_TRAVERSAL_BUDGET) {
    context.notes.push('tree omitted: too_large');
    return undefined;
  }
  return entries;
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
    context.notes.push(`README omitted: ${decoded.failure}`);
    return undefined;
  }
  return decoded.content;
}

async function readTree(
  target: GithubPathTarget,
  context: CodeContext,
): Promise<WebAdapterOutcome> {
  const resolved = await resolveRef(target, context, (ref, path) =>
    requestJson(
      `${context.apiOrigin}${treePath(target, ref, path)}?recursive=1`,
      context,
    ),
  );
  if (resolved.kind === 'failed') return primaryFailure(resolved.failure);
  const entries = parseGithubTree(resolved.body);
  if (entries === undefined) return { kind: 'failed', failure: 'parse' };
  return {
    kind: 'rendered',
    content: '',
    mediaType: undefined,
    directory: {
      displayPath: context.source.href,
      entries: toGithubDirectoryEntries(entries),
    },
    notes: context.notes,
  };
}

async function readBlob(
  target: GithubPathTarget,
  context: CodeContext,
): Promise<WebAdapterOutcome> {
  const resolved = await resolveRef(target, context, (ref, path) =>
    requestJson(
      `${context.apiOrigin}${repoPath(target)}/contents/${path
        .map(encodeURIComponent)
        .join('/')}?${new URLSearchParams({ ref })}`,
      context,
    ),
  );
  if (resolved.kind === 'failed') return primaryFailure(resolved.failure);
  const decoded = decodeBlob(resolved.body);
  if (decoded.kind === 'failed') {
    return { kind: 'failed', failure: decoded.failure };
  }
  return {
    kind: 'rendered',
    content: decoded.content,
    mediaType: fileMediaType(resolved.path.join('/')),
    notes: context.notes,
  };
}

async function readCommit(
  target: GithubCommitTarget,
  context: CodeContext,
): Promise<WebAdapterOutcome> {
  const firstPage = await requestJson(
    `${context.apiOrigin}${repoPath(target)}/commits/${encodeURIComponent(
      target.sha,
    )}?per_page=${PAGE_SIZE}&page=1`,
    context,
  );
  if (firstPage.kind === 'failed') {
    return primaryFailure(firstPage.failure);
  }
  const commit = parseGithubCommit(firstPage.body);
  if (commit === undefined) return { kind: 'failed', failure: 'parse' };
  const files = await loadCommitFiles(target, commit.files, context);
  return finish(
    {
      kind: 'commit',
      sha: commit.sha,
      message: commit.message,
      author: commit.author,
      authoredAt: commit.authoredAt,
      files,
      diffUrl: `https://github.com/${target.owner}/${target.repo}/commit/${target.sha}.diff`,
    },
    context,
  );
}

async function loadCommitFiles(
  target: GithubCommitTarget,
  firstFiles: ReadonlyArray<GithubFile>,
  context: CodeContext,
): Promise<ReadonlyArray<GithubFile>> {
  const files = [...firstFiles];
  if (firstFiles.length < PAGE_SIZE) return files;
  for (let page = 2; files.length < MAX_COMMIT_FILES; page += 1) {
    const result = await requestJson(
      `${context.apiOrigin}${repoPath(target)}/commits/${encodeURIComponent(
        target.sha,
      )}?per_page=${PAGE_SIZE}&page=${page}`,
      context,
    );
    if (result.kind === 'failed') {
      recordSecondaryFailure('files', result.failure, context);
      break;
    }
    const pageFiles = parseGithubCommitFiles(result.body);
    if (pageFiles === undefined) {
      recordSecondaryFailure('files', PARSE_FAILURE, context);
      break;
    }
    files.push(...pageFiles);
    if (pageFiles.length < PAGE_SIZE) return files;
  }
  if (files.length >= MAX_COMMIT_FILES) {
    context.notes.push('files omitted: too_large');
  }
  return files.slice(0, MAX_COMMIT_FILES);
}

async function resolveRef(
  target: GithubPathTarget,
  context: CodeContext,
  request: CodeRequest,
): Promise<ResolveResult> {
  const segments = target.segments;
  const first = segments[0];
  if (first === undefined) return { kind: 'failed', failure: PARSE_FAILURE };
  const initial = await attempt(first, segments.slice(1), request);
  if (initial.kind === 'ok') return initial;
  if (!canResolveRef(first, segments, initial.failure)) return initial;
  const locator = segments.join('/');
  const lookup: MatchingRefsRequest = (namespace, lookupFirst) =>
    requestJson(
      `${context.apiOrigin}${repoPath(
        target,
      )}/git/matching-refs/${namespace}/${encodeURIComponent(lookupFirst)}`,
      context,
    );
  const heads = await matchingCandidate('heads', first, locator, lookup);
  if (heads.kind === 'failed') return heads;
  const candidate =
    heads.kind === 'found'
      ? heads
      : await matchingCandidate('tags', first, locator, lookup);
  if (candidate.kind !== 'found') {
    return candidate.kind === 'failed'
      ? candidate
      : { kind: 'failed', failure: initial.failure };
  }
  const suffix = locator.slice(candidate.ref.length);
  const path = suffix.split('/').filter((segment) => segment !== '');
  return attempt(candidate.ref, path, request);
}

async function attempt(
  ref: string,
  path: ReadonlyArray<string>,
  request: CodeRequest,
): Promise<ResolveResult> {
  const result = await request(ref, path);
  return result.kind === 'ok'
    ? { kind: 'ok', body: result.body, path }
    : result;
}

function canResolveRef(
  first: string,
  segments: ReadonlyArray<string>,
  failure: WebFetchFailure,
): boolean {
  return (
    failure.httpStatus === 404 && segments.length > 1 && !HEX_SHA.test(first)
  );
}

async function matchingCandidate(
  namespace: 'heads' | 'tags',
  first: string,
  locator: string,
  lookup: MatchingRefsRequest,
): Promise<CandidateResult> {
  const result = await lookup(namespace, first);
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
    if (locator !== candidate && !locator.startsWith(`${candidate}/`)) continue;
    if (longest === undefined || candidate.length > longest.length) {
      longest = candidate;
    }
  }
  return longest;
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

function decodeBase64(content: string): Buffer | undefined {
  const compact = content.replaceAll(/\s+/gu, '');
  if (compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) {
    return undefined;
  }
  return Buffer.from(compact, 'base64');
}

function finish(
  document: GithubCodeDocument,
  context: CodeContext,
): WebAdapterOutcome {
  return finishRendered(renderGithubCodeDocument(document), context);
}

function treePath(
  target: GithubPathTarget | GithubRepositoryTarget,
  ref: string,
  path: ReadonlyArray<string>,
): string {
  const suffix = encodeURIComponent(ref);
  const pathText = path.map(encodeURIComponent).join('/');
  return `${repoPath(target)}/git/trees/${suffix}${
    pathText === '' ? '' : `:${pathText}`
  }`;
}
