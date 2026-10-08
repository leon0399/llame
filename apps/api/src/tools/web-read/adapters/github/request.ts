import type { WebFetchFailure, WebRequestInit } from '../../http-client';
import {
  isFatalAdapterFailure,
  omissionNote,
  primaryFailure,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';

export const PARSE_FAILURE: WebFetchFailure = {
  type: 'parse',
  message: 'The GitHub response was not valid JSON.',
};

export type GithubJsonResult =
  | { readonly kind: 'ok'; readonly body: string }
  | { readonly kind: 'failed'; readonly failure: WebFetchFailure };

export type GithubRequestContext = {
  readonly io: WebAdapterIo;
  readonly init: WebRequestInit;
  readonly apiOrigin: string;
  readonly notes: Array<string>;
  halted?: WebFetchFailure;
};

/** What a GitHub family reader receives from the adapter. */
export type GithubReadOptions = Pick<
  GithubRequestContext,
  'io' | 'init' | 'apiOrigin'
>;

export async function requestJson(
  url: string,
  context: GithubRequestContext,
): Promise<GithubJsonResult> {
  if (context.halted !== undefined) {
    return { kind: 'failed', failure: context.halted };
  }
  const fetched = await context.io.fetch(url, context.init);
  if ('type' in fetched) return { kind: 'failed', failure: fetched };
  return { kind: 'ok', body: fetched.body };
}

export function recordSecondaryFailure(
  section: string,
  failure: WebFetchFailure,
  context: GithubRequestContext,
): void {
  context.notes.push(omissionNote(section, failure));
  if (isFatalAdapterFailure(failure)) context.halted = failure;
}

export function finishRendered(
  content: string,
  context: GithubRequestContext,
): WebAdapterOutcome {
  if (context.halted !== undefined && context.halted.type !== 'call_timeout') {
    return primaryFailure(context.halted);
  }
  return {
    kind: 'rendered',
    content,
    mediaType: 'text/markdown',
    notes: context.notes,
  };
}

export function repoPath(target: {
  readonly owner: string;
  readonly repo: string;
}): string {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
}
