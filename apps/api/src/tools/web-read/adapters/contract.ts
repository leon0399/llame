import type { z } from 'zod';

import { type WebAdapterConfig } from '../../../instance-config/llame-config';
import { REJECTED_ADDRESS_MESSAGE } from '../../permissions/messages';
import type {
  WebFetchFailure,
  WebRequestInit,
  WebResponse,
} from '../http-client';
import {
  CANDIDATE_FAILURES,
  type WebDirectory,
  type WebRender,
} from '../pipeline';
import { createArxivAdapter } from './arxiv/adapter';
import { createBlueskyAdapter } from './bluesky/adapter';
import { createGithubAdapter } from './github/adapter';
import { createHuggingfaceAdapter } from './huggingface/adapter';
import { createNpmAdapter } from './npm/adapter';
import { createRewriteAdapter } from './rewrite';
import { createStackexchangeAdapter } from './stackexchange/adapter';

export type WebAdapterRoute = 'native' | 'rewrite';

export type WebAdapterFailure =
  | 'permission'
  | 'address'
  | 'status'
  | 'rate_limit'
  | 'transport'
  | 'parse'
  | 'empty'
  | 'binary'
  | 'too_large'
  | 'content_type';

export type WebAdapterProvenance = {
  readonly id: string;
  readonly route: WebAdapterRoute;
  readonly origin?: string;
};

export type WebAdapterIo = {
  /** Admit `url` as derived kind `adapter` before using the shared session;
   * refused targets return a permission failure without issuing a request.
   * Accepted targets use that session's deadline, redirects, and pinning. */
  readonly fetch: (
    url: string,
    init?: WebRequestInit,
  ) => Promise<WebResponse | WebFetchFailure>;
};

export type WebAdapterOutcome =
  | {
      readonly kind: 'rendered';
      readonly content: string;
      readonly origin?: string;
      readonly mediaType: string | undefined;
      readonly notes: ReadonlyArray<string>;
      readonly directory?: WebDirectory;
    }
  | {
      readonly kind: 'failed';
      readonly failure: WebAdapterFailure;
      readonly reset?: string;
      /** A call-bound or caller-abort failure ends the whole web read. */
      readonly fatal?: WebFetchFailure;
    };

export interface WebAdapter {
  readonly id: string;
  readonly route: WebAdapterRoute;
  /** Pure and synchronous: matching cannot perform network I/O. */
  match(source: URL): boolean;
  read(source: URL, io: WebAdapterIo): Promise<WebAdapterOutcome>;
}

export const MAX_ADAPTER_DOCUMENT_BYTES = 5 * 1024 * 1024;

/**
 * Maps the bounded failures emitted by the shared HTTP client to the adapter
 * vocabulary. Address refusal uses the client's distinct fixed message; a
 * redirect target refusal has a different message even when it carries a
 * rejectedUrl, so it remains an ordinary URL permission failure.
 */
export function classifyFetchFailure(
  failure: WebFetchFailure,
): WebAdapterFailure {
  switch (failure.type) {
    case 'permission_denied':
      return failure.message === REJECTED_ADDRESS_MESSAGE
        ? 'address'
        : 'permission';
    case 'http_status':
      return classifyHttpStatusFailure(failure);
    case 'body_too_large':
      return 'too_large';
    case 'unsupported_content_type':
      return 'content_type';
    case 'parse':
      return 'parse';
    default:
      return 'transport';
  }
}

function classifyHttpStatusFailure(
  failure: WebFetchFailure,
): WebAdapterFailure {
  const rateLimit = failure.rateLimit;
  if (failure.httpStatus === 429) return 'rate_limit';
  if (
    failure.httpStatus === 403 &&
    (rateLimit?.remaining === '0' || rateLimit?.retryAfter !== undefined)
  ) {
    return 'rate_limit';
  }
  if (
    failure.httpStatus === undefined &&
    /\bHTTP\s+429(?:\D|$)/u.test(failure.message)
  ) {
    return 'rate_limit';
  }
  return 'status';
}

export function rateLimitReset(failure: WebFetchFailure): string | undefined {
  if (classifyFetchFailure(failure) !== 'rate_limit') return undefined;
  return resetTimestamp(failure.rateLimit?.reset);
}

export function omissionNote(
  section: string,
  failure: WebFetchFailure,
): string {
  const category = classifyFetchFailure(failure);
  const reset = rateLimitReset(failure);
  return `${section} omitted: ${category}${
    reset === undefined ? '' : `, resets ${reset}`
  }`;
}

function resetTimestamp(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** The outcome of a failed request an adapter cannot render without; a
 *  call-bound or caller-abort failure is marked fatal. */
export function primaryFailure(failure: WebFetchFailure): WebAdapterOutcome {
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

/**
 * A secondary section's body, or none with an omission note. A call deadline
 * keeps what already arrived and is returned as `spent`, so later sections
 * are skipped with the same note; any other call-ending failure is returned
 * so the read ends, as GitHub's secondary sections do.
 */
export async function loadSection(
  section: string,
  request: Promise<WebResponse | WebFetchFailure>,
  notes: Array<string>,
): Promise<
  | { readonly body?: string; readonly spent?: WebFetchFailure }
  | { readonly fatal: WebFetchFailure }
> {
  const fetched = await request;
  if (!('type' in fetched)) return { body: fetched.body };
  if (fetched.type === 'call_timeout') {
    notes.push(omissionNote(section, fetched));
    return { spent: fetched };
  }
  if (isFatalAdapterFailure(fetched)) return { fatal: fetched };
  notes.push(omissionNote(section, fetched));
  return {};
}

/** A JSON body validated by `schema`, or `undefined` when either fails. */
export function parseJsonBody<T>(
  body: string,
  schema: z.ZodType<T>,
): T | undefined {
  try {
    return schema.safeParse(JSON.parse(body)).data;
  } catch {
    return undefined;
  }
}

/** An adapter's own report that a response it received could not be parsed. */
const ADAPTER_PARSE_FAILURE = 'parse';

/**
 * Only adapter-primary failures in this allowlist may fall through. Call
 * timeout, abort, redirect-budget exhaustion, and unknown failures end calls.
 */
export function isFatalAdapterFailure(failure: WebFetchFailure): boolean {
  return (
    !Object.hasOwn(CANDIDATE_FAILURES, failure.type) &&
    failure.type !== ADAPTER_PARSE_FAILURE
  );
}

export type WebAdapterDispatch =
  | {
      readonly kind: 'rendered';
      readonly render: WebRender;
    }
  | {
      readonly kind: 'fallthrough';
      readonly notes: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'fatal';
      readonly failure: WebFetchFailure;
    };

/**
 * Runs matching adapters in configuration order. A mismatch performs no I/O;
 * a non-fatal failure is recorded and the next claimant (or generic ladder)
 * may still provide the content.
 */
export async function dispatchWebAdapters(
  source: URL,
  adapters: ReadonlyArray<WebAdapter>,
  io: WebAdapterIo,
): Promise<WebAdapterDispatch> {
  const fallthroughNotes: Array<string> = [];
  for (const adapter of adapters) {
    if (!adapter.match(source)) continue;

    const outcome = await adapter.read(source, io);
    if (outcome.kind === 'failed') {
      if (outcome.fatal !== undefined) {
        return { kind: 'fatal', failure: outcome.fatal };
      }
      const reset =
        outcome.reset === undefined ? '' : `, resets ${outcome.reset}`;
      fallthroughNotes.push(
        `web adapter "${adapter.id}" fell through: ${outcome.failure}${reset}`,
      );
      continue;
    }

    return {
      kind: 'rendered',
      render: renderAdapter(source, adapter, outcome, fallthroughNotes),
    };
  }

  return { kind: 'fallthrough', notes: fallthroughNotes };
}

function renderAdapter(
  source: URL,
  adapter: WebAdapter,
  outcome: Extract<WebAdapterOutcome, { kind: 'rendered' }>,
  fallthroughNotes: ReadonlyArray<string>,
): WebRender {
  const bounded = truncateAdapterDocument(outcome.content);
  const notes = [...fallthroughNotes, ...outcome.notes];
  if (bounded.truncated) notes.push('document truncated: too_large');
  return {
    method: 'adapter',
    content: bounded.content,
    ...(outcome.mediaType !== undefined && {
      mediaType: outcome.mediaType,
    }),
    ...(bounded.truncated && { truncated: true }),
    finalUrl: source.href,
    ...(notes.length > 0 && { notes }),
    adapter: {
      id: adapter.id,
      route: adapter.route,
      ...(adapter.route === 'rewrite' &&
        outcome.origin !== undefined && { origin: outcome.origin }),
    },
    ...(outcome.directory !== undefined && {
      directory: outcome.directory,
    }),
  };
}
function truncateAdapterDocument(content: string) {
  const buffer = new Uint8Array(MAX_ADAPTER_DOCUMENT_BYTES);
  const { read } = new TextEncoder().encodeInto(content, buffer);
  if (read === content.length) {
    return { content, truncated: false };
  }
  const newline = content.lastIndexOf('\n', read - 1);
  return {
    content:
      newline === -1 ? content.slice(0, read) : content.slice(0, newline + 1),
    truncated: true,
  };
}

/** Builds configured adapters while preserving operator order. */
export function createWebAdapters(
  configs: ReadonlyArray<WebAdapterConfig>,
): ReadonlyArray<WebAdapter> {
  return configs.map((config) => {
    switch (config.use) {
      case 'github':
        return createGithubAdapter(config);
      case 'bluesky':
        return createBlueskyAdapter(config);
      case 'npm':
        return createNpmAdapter(config);
      case 'huggingface':
        return createHuggingfaceAdapter(config);
      case 'arxiv':
        return createArxivAdapter(config);
      case 'stackexchange':
        return createStackexchangeAdapter(config);
      case 'rewrite':
        return createRewriteAdapter(config);
    }
  });
}
