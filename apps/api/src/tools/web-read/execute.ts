import { promises as dns } from 'node:dns';

import { IMAGE_SELECTOR_MESSAGE } from '@workspace/native-file-tools';
import { fetch as undiciFetch } from 'undici';

import { type ToolMediaStore } from '../../media/tool-media-store';
import { type ToolContext, type ToolResult } from '../types';
import {
  createAddressAdmission,
  createDerivedAdmission,
  type AdmitDerivedLocator,
} from './admission';
import {
  type ResolveHost,
  type WebFetchFailure,
  type WebFetchSession,
  type WebImageResponse,
  type WebResponse,
  createWebFetchSession,
} from './http-client';
import { parseWebLocator, type WebLocator } from './locator';
import {
  createWebAdapters,
  dispatchWebAdapters,
  type WebAdapterDispatch,
  type WebAdapterIo,
} from './adapters/contract';
import { renderWebContent } from './pipeline';
import { buildWebImageResult, buildWebReadResult } from './result';

/** The locator-bearing call the native file tools dispatch by scheme. */
type WebReadCall = {
  readonly operation: 'read' | 'edit' | 'write';
  readonly input: { readonly path: string };
};

/**
 * The collaborators a web read runs through. Production uses undici's own
 * transport and the system resolver; tests can bind scripted equivalents.
 */
export type WebReadDeps = {
  readonly parseWebLocator: typeof parseWebLocator;
  readonly createWebFetchSession: typeof createWebFetchSession;
  readonly renderWebContent: typeof renderWebContent;
  readonly buildWebReadResult: typeof buildWebReadResult;
  readonly fetch?: typeof undiciFetch;
  readonly resolve?: ResolveHost;
};

/**
 * The locator is parsed from `call.input.path` — the text the model
 * submitted, which is the text policy matched — and the request uses its
 * canonical serialization, so `HTTPS://Example.test` is fetched as
 * `https://example.test/`.
 */
export type WebReadExecutor = (
  context: ToolContext,
  call: WebReadCall,
) => Promise<ToolResult>;

const resolveHost: ResolveHost = async (hostname) => {
  const addresses = await dns.lookup(hostname, {
    all: true,
    order: 'verbatim',
  });
  return addresses.map(({ address, family }) => ({
    address,
    family: family === 4 ? 4 : 6,
  }));
};

export const realWebReadDeps: WebReadDeps = {
  parseWebLocator,
  createWebFetchSession,
  renderWebContent,
  buildWebReadResult,
  fetch: undiciFetch,
  resolve: resolveHost,
};

/** The failure the client reports for a caller abort. */
const ABORTED_FAILURE: WebFetchFailure = {
  type: 'aborted',
  message: 'The web read was cancelled.',
};

/**
 * A web locator is read-only, needs no executor identity, and is fetched by
 * the API process's own outbound HTTP. `edit` and `write` fail before any
 * request, and the Run's cancellation and per-call deadline bound the fetch.
 */
export function createWebReadExecutor(deps: WebReadDeps): WebReadExecutor {
  return async (context, call) => {
    if (call.operation !== 'read') {
      return {
        status: 'error',
        type: 'invalid_path',
        message: 'A web locator is read-only; edit and write cannot target it.',
      };
    }
    const locator = deps.parseWebLocator(call.input.path);
    if ('type' in locator) {
      return { status: 'error', type: locator.type, message: locator.message };
    }
    const userAgent = context.productUserAgent;
    if (userAgent === undefined) {
      return {
        status: 'error',
        type: 'executor_unavailable',
        message:
          'A web read needs the instance identity this process sends as its User-Agent, which instance configuration did not resolve.',
      };
    }
    return fetchAndRender(context, locator, userAgent, deps);
  };
}

export const executeWebRead: WebReadExecutor =
  createWebReadExecutor(realWebReadDeps);

async function fetchAndRender(
  context: ToolContext,
  locator: WebLocator,
  userAgent: string,
  deps: WebReadDeps,
): Promise<ToolResult> {
  const admit = createDerivedAdmission(context);
  const session = createSession(context, userAgent, deps, admit);
  try {
    const raw = isRawSelector(locator.selector);
    let notes: ReadonlyArray<string> = [];
    if (!raw) {
      const adapters = await dispatchFor(context, locator.url, session, admit);
      if (adapters.kind === 'fatal')
        return { status: 'error', ...adapters.failure };
      if (adapters.kind === 'rendered')
        return await deps.buildWebReadResult(
          locator,
          locator.url,
          adapters.render,
        );
      notes = adapters.notes;
    }
    const response = await fetchPage(context, session, locator.url);
    if ('type' in response) return { status: 'error', ...response };
    if ('image' in response) return await readImage(locator, response, notes);
    const render = await deps.renderWebContent(
      response,
      { raw },
      { fetch: session.fetch, admit },
    );
    if ('type' in render) return { status: 'error', ...render };
    // The envelope drops an empty notes list, so an unclaimed read is unchanged.
    return await deps.buildWebReadResult(locator, response.finalUrl, {
      ...render,
      notes: [...notes, ...(render.notes ?? [])],
    });
  } finally {
    session.dispose();
  }
}

/** A page image body and the store that ingests it. */
type WebImagePage = {
  readonly image: WebImageResponse;
  readonly media: ToolMediaStore;
};

/** The page response, or the abort that landed while it arrived: neither a
 *  synchronous render nor an ingest starts after a caller abort. Only a read
 *  that can store an image accepts one; without a media store an image body
 *  stays `unsupported_content_type`. */
async function fetchPage(
  context: ToolContext,
  session: WebFetchSession,
  url: string,
): Promise<WebResponse | WebImagePage | WebFetchFailure> {
  const { media } = context;
  let response: WebResponse | WebImagePage | WebFetchFailure;
  if (media === undefined) {
    response = await session.fetch(url);
  } else {
    const page = await session.fetchPage(url);
    response = 'bytes' in page ? { image: page, media } : page;
  }
  if ('type' in response) return response;
  return context.abortSignal?.aborted === true ? ABORTED_FAILURE : response;
}

/** An image page is stored, never rendered (vision-media D7). A selector is
 *  refused before anything is ingested, `:raw` included, and the store refuses
 *  bytes that match no image format, whatever the declared type. */
async function readImage(
  locator: WebLocator,
  { image, media }: WebImagePage,
  notes: ReadonlyArray<string>,
): Promise<ToolResult> {
  if (locator.selector !== undefined) {
    return {
      status: 'error',
      type: 'invalid_selector',
      message: IMAGE_SELECTOR_MESSAGE,
    };
  }
  const { bytes } = image;
  const ingested = await media.ingestImage(locator.url)({
    byteSize: bytes.byteLength,
    readBytes: () =>
      Promise.resolve(
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      ),
  });
  if (ingested.status === 'error') return ingested;
  return buildWebImageResult(locator, image.finalUrl, ingested, notes);
}

function createSession(
  context: ToolContext,
  userAgent: string,
  deps: WebReadDeps,
  admit: AdmitDerivedLocator,
): WebFetchSession {
  // One session per call: its 30-second bound and 20-hop budget cover adapter
  // requests, the source request, every redirect, and every generic probe.
  return deps.createWebFetchSession(
    {
      userAgent,
      signal: context.abortSignal,
      deadlineMs: context.timeoutMs,
    },
    {
      fetch: deps.fetch ?? undiciFetch,
      admit,
      admitAddress: createAddressAdmission(context),
      resolve: deps.resolve ?? resolveHost,
    },
  );
}

async function dispatchFor(
  context: ToolContext,
  sourceUrl: string,
  session: WebFetchSession,
  admit: AdmitDerivedLocator,
): Promise<WebAdapterDispatch> {
  const adapterIo: WebAdapterIo = {
    fetch: async (url, init) => {
      if (admit('adapter', url).decision === 'reject') {
        return {
          type: 'permission_denied',
          message: 'The adapter target was refused by operator permissions.',
        };
      }
      const result = await session.fetch(url, init);
      // A caller abort can land after an adapter response resolves; do not
      // let a synchronous adapter render start in that case.
      return context.abortSignal?.aborted ? ABORTED_FAILURE : result;
    },
  };
  return dispatchWebAdapters(
    new URL(sourceUrl),
    createWebAdapters(context.webAdapters ?? []),
    adapterIo,
  );
}

/** `:raw` skips every probe and conversion. The selector excludes its
 *  leading colon, as it does for the `kb://` and `skill://` locators. */
function isRawSelector(selector: string | undefined): boolean {
  if (selector === undefined) return false;
  return selector === 'raw' || selector.startsWith('raw:');
}
