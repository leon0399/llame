import { type WebAdapterConfig } from '../../../instance-config/llame-config';
import { REJECTED_ADDRESS_MESSAGE } from '../../permissions/messages';
import type { WebFetchFailure, WebResponse } from '../http-client';
import { CANDIDATE_FAILURES, type WebRender } from '../pipeline';
import { createRewriteAdapter } from './rewrite';

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
  readonly fetch: (url: string) => Promise<WebResponse | WebFetchFailure>;
};

export type WebAdapterOutcome =
  | {
      readonly kind: 'rendered';
      readonly content: string;
      readonly origin?: string;
      readonly notes: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'failed';
      readonly failure: WebAdapterFailure;
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
      return /\bHTTP\s+429(?:\D|$)/u.test(failure.message)
        ? 'rate_limit'
        : 'status';
    case 'body_too_large':
      return 'too_large';
    case 'unsupported_content_type':
      return 'content_type';
    default:
      return 'transport';
  }
}

/**
 * Only adapter-primary failures in this allowlist may fall through. Call
 * timeout, abort, redirect-budget exhaustion, and unknown failures end calls.
 */
export function isFatalAdapterFailure(failure: WebFetchFailure): boolean {
  return !Object.hasOwn(CANDIDATE_FAILURES, failure.type);
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
      fallthroughNotes.push(
        `web adapter "${adapter.id}" fell through: ${outcome.failure}`,
      );
      continue;
    }

    const bounded = truncateAdapterDocument(outcome.content);
    const notes = [...fallthroughNotes, ...outcome.notes];
    if (bounded.truncated) notes.push('document truncated: too_large');
    const provenance: WebAdapterProvenance = {
      id: adapter.id,
      route: adapter.route,
      ...(adapter.route === 'rewrite' &&
        outcome.origin !== undefined && { origin: outcome.origin }),
    };
    const render: WebRender = {
      method: 'adapter',
      content: bounded.content,
      finalUrl: source.href,
      ...(notes.length > 0 && { notes }),
      adapter: provenance,
    };
    return { kind: 'rendered', render };
  }

  return { kind: 'fallthrough', notes: fallthroughNotes };
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

/** Builds the shipped rewrite-only adapter set while preserving operator order. */
export function createWebAdapters(
  configs: ReadonlyArray<WebAdapterConfig>,
): ReadonlyArray<WebAdapter> {
  return configs.map(createRewriteAdapter);
}
