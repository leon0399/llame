import { promises as dns } from 'node:dns';

import {
  MEDIA_SELECTOR_MESSAGE,
  NativeFileError,
  applySelectorSuffix,
  type MediaReadHook,
} from '@workspace/native-file-tools';
import { fetch as undiciFetch } from 'undici';

import { MEDIA_REFUSAL } from '../../media/media-ingest';
import { isPdfSignature } from '../../media/pdf-preparation';
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
  type WebMediaResponse,
  type WebResponse,
  createWebFetchSession,
} from './http-client';
import { anchorSelector, parseWebLocator, type WebLocator } from './locator';
import {
  createWebAdapters,
  dispatchWebAdapters,
  type WebAdapter,
  type WebAdapterDispatch,
  type WebAdapterIo,
} from './adapters/contract';
import { renderWebContent } from './pipeline';
import { buildWebMediaResult, buildWebReadResult } from './result';

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
  readonly createWebAdapters: typeof createWebAdapters;
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
  createWebAdapters,
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
 * A selector shape the shared grammar admits for a source split but no reader
 * serves, refused before anything is requested: the page's own line count
 * cannot make `:P3`, `:M2`, or `:L-5` readable, so a refused shape costs no
 * fetch. A selector whose refusal depends on the rendered count stays with
 * the renderer, which alone holds that count.
 */
function refusedSelector(locator: WebLocator): ToolResult | undefined {
  try {
    applySelectorSuffix(locator.url, locator.selector);

    return undefined;
  } catch (error) {
    if (!(error instanceof NativeFileError)) throw error;

    return { status: 'error', type: error.type, message: error.message };
  }
}

/**
 * A GitHub line anchor is refused before any request when the read also
 * writes a selector (including `:raw`, which would otherwise skip the adapter
 * that claims the lines) or when the anchor names no selectable lines. The
 * anchors' lines are applied later, to the adapter render alone, so a read
 * that no enabled adapter claims keeps the shipped fragment rule: the anchor
 * is dropped and the request never carries it.
 */
function lineAnchorRefusal(
  locator: WebLocator,
  adapters: ReadonlyArray<WebAdapter>,
): ToolResult | undefined {
  const { lineAnchor } = locator;

  if (lineAnchor === undefined) return undefined;

  const source = new URL(locator.url);

  const claimed = adapters.some(
    (adapter) => adapter.lineAddressed?.(source) === true,
  );

  if (!claimed) return undefined;

  if (locator.selector !== undefined) {
    return {
      status: 'error',
      type: 'invalid_selector',
      message: `This locator selects lines twice, with #${lineAnchor} and with :${locator.selector}. Write one of them.`,
    };
  }

  try {
    applySelectorSuffix(locator.url, anchorSelector(lineAnchor));

    return undefined;
  } catch (error) {
    if (!(error instanceof NativeFileError)) throw error;

    return { status: 'error', type: error.type, message: error.message };
  }
}

/** The locator and adapters a read proceeds with, or the refusal that ends it. */
type AdmittedRead =
  | {
      readonly locator: WebLocator;
      readonly adapters: ReadonlyArray<WebAdapter>;
    }
  | { readonly refusal: ToolResult };

/**
 * Admits one submitted locator before any request: the operation, the locator
 * grammar, the selector shape, and the adapter-claimed line anchor. The
 * adapters are built here because the anchor decision needs their hooks.
 */
function admitRead(
  context: ToolContext,
  call: WebReadCall,
  deps: WebReadDeps,
): AdmittedRead {
  if (call.operation !== 'read') {
    return {
      refusal: {
        status: 'error',
        type: 'invalid_path',
        message: 'A web locator is read-only; edit and write cannot target it.',
      },
    };
  }

  const locator = deps.parseWebLocator(call.input.path);

  if ('type' in locator) {
    return {
      refusal: {
        status: 'error',
        type: locator.type,
        message: locator.message,
      },
    };
  }

  const refused = refusedSelector(locator);

  if (refused !== undefined) return { refusal: refused };

  const adapters = deps.createWebAdapters(context.webAdapters ?? []);
  const anchorRefused = lineAnchorRefusal(locator, adapters);

  if (anchorRefused !== undefined) return { refusal: anchorRefused };

  return { locator, adapters };
}

/**
 * A web locator is read-only, needs no executor identity, and is fetched by
 * the API process's own outbound HTTP. `edit` and `write` fail before any
 * request, and the Run's cancellation and per-call deadline bound the fetch.
 */
export function createWebReadExecutor(deps: WebReadDeps): WebReadExecutor {
  return async (context, call) => {
    const admitted = admitRead(context, call, deps);

    if ('refusal' in admitted) return admitted.refusal;

    const { locator, adapters } = admitted;
    const userAgent = context.productUserAgent;

    if (userAgent === undefined) {
      return {
        status: 'error',
        type: 'executor_unavailable',
        message:
          'A web read needs the instance identity this process sends as its User-Agent, which instance configuration did not resolve.',
      };
    }

    const admit = createDerivedAdmission(context);
    const session = createSession(context, userAgent, deps, admit);

    try {
      const pageRead = {
        locator,
        media: context.media?.readMedia(call.input.path, context.toolCallId),
        session,
        admit,
      };

      return await fetchAndRender(context, pageRead, adapters, deps);
    } finally {
      session.dispose();
    }
  };
}

export const executeWebRead: WebReadExecutor =
  createWebReadExecutor(realWebReadDeps);

/** One web read, with media preparation bound to its submitted locator and call id. */
type WebPageRead = {
  readonly locator: WebLocator;
  readonly session: WebFetchSession;
  readonly admit: AdmitDerivedLocator;
  readonly media: MediaReadHook | undefined;
};

/** One non-raw read's adapter pass: a final result, or the fall-through notes. */
type AdapterAttempt =
  | { readonly result: ToolResult }
  | { readonly notes: ReadonlyArray<string> };

/**
 * The adapter pass of a non-raw read: the render of the first claimant that
 * wins, or the notes the generic ladder reports alongside its own render.
 */
async function adapterAttempt(
  context: ToolContext,
  pageRead: WebPageRead,
  adapters: ReadonlyArray<WebAdapter>,
  deps: WebReadDeps,
): Promise<AdapterAttempt> {
  const { locator } = pageRead;
  const dispatched = await dispatchFor(context, pageRead, adapters);

  if (dispatched.kind === 'fatal')
    return { result: { status: 'error', ...dispatched.failure } };

  if (dispatched.kind === 'rendered') {
    return {
      result: await deps.buildWebReadResult(
        locator,
        locator.url,
        dispatched.render,
      ),
    };
  }

  return { notes: dispatched.notes };
}

async function fetchAndRender(
  context: ToolContext,
  pageRead: WebPageRead,
  adapters: ReadonlyArray<WebAdapter>,
  deps: WebReadDeps,
): Promise<ToolResult> {
  const { locator, media, session, admit } = pageRead;
  const raw = isRawSelector(locator.selector);
  let notes: ReadonlyArray<string> = [];

  if (!raw) {
    const attempted = await adapterAttempt(context, pageRead, adapters, deps);

    if ('result' in attempted) return attempted.result;
    notes = attempted.notes;
  }

  const response = await fetchPage(context, session, locator.url, media);

  if ('type' in response) return { status: 'error', ...response };

  if ('bytes' in response)
    return await readMedia(pageRead, response, notes, session);

  const render = await deps.renderWebContent(
    response,
    { raw },
    { fetch: session.fetch, admit },
  );

  if ('type' in render) return { status: 'error', ...render };

  return await deps.buildWebReadResult(locator, response.finalUrl, {
    ...render,
    notes: [...notes, ...(render.notes ?? [])],
  });
}

/** No rendering or preparation starts after a caller abort. Without the
 *  media hook, a binary page remains an unsupported content type. */
async function fetchPage(
  context: ToolContext,
  session: WebFetchSession,
  url: string,
  media: MediaReadHook | undefined,
): Promise<WebResponse | WebMediaResponse | WebFetchFailure> {
  const response =
    media === undefined
      ? await session.fetch(url)
      : await session.fetchPage(url);

  if ('type' in response) return response;

  return context.abortSignal?.aborted === true ? ABORTED_FAILURE : response;
}

/** Page media uses local preparation without rendering or storage. */
async function readMedia(
  { locator, media }: WebPageRead,
  page: WebMediaResponse,
  notes: ReadonlyArray<string>,
  session: WebFetchSession,
): Promise<ToolResult> {
  const result = await session.untilDeadline<ToolResult>(async (signal) => {
    if (locator.selector !== undefined) {
      return {
        status: 'error',
        type: 'invalid_selector',
        message: MEDIA_SELECTOR_MESSAGE,
      };
    }

    const { bytes } = page;

    if (page.kind === 'pdf' && !isPdfSignature(bytes)) {
      return {
        status: 'error',
        type: MEDIA_REFUSAL.unopenablePdf.code,
        message: MEDIA_REFUSAL.unopenablePdf.message,
      };
    }

    // Only a page fetched with this hook can return media bytes.
    const decoded = await media!({
      kind: page.kind,
      signal,
      byteSize: bytes.byteLength,
      readBytes: () =>
        Promise.resolve(
          Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        ),
    });

    if (decoded.status === 'error') return decoded;

    if (decoded.kind !== page.kind)
      throw new Error('Expected matching media preparation.');

    return buildWebMediaResult(locator, page.finalUrl, decoded, notes);
  });

  return 'status' in result ? result : { status: 'error', ...result };
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
  pageRead: WebPageRead,
  adapters: ReadonlyArray<WebAdapter>,
): Promise<WebAdapterDispatch> {
  const { locator, session, admit } = pageRead;

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

  return dispatchWebAdapters(new URL(locator.url), adapters, adapterIo);
}

/** `:raw` skips every probe and conversion. The selector excludes its
 *  leading colon, as it does for the `kb://` and `skill://` locators. */
function isRawSelector(selector: string | undefined): boolean {
  if (selector === undefined) return false;

  return (
    selector === 'raw' ||
    selector.startsWith('raw:') ||
    selector.endsWith(':raw')
  );
}
