import { promises as dns } from 'node:dns';

import { fetch as undiciFetch } from 'undici';

import { type ToolContext, type ToolResult } from '../types';
import {
  createAddressAdmission,
  createDerivedAdmission,
  type AdmitDerivedLocator,
} from './admission';
import {
  type ResolveHost,
  type WebFetchSession,
  type WebResponse,
  createWebFetchSession,
} from './http-client';
import { parseWebLocator, type WebLocator } from './locator';
import {
  createWebAdapters,
  dispatchWebAdapters,
  type WebAdapterIo,
} from './adapters/contract';
import { renderWebContent } from './pipeline';
import { buildWebReadResult } from './result';

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
  readonly createWebAdapters?: typeof createWebAdapters;
  readonly renderWebContent: typeof renderWebContent;
  readonly buildWebReadResult: typeof buildWebReadResult;
  readonly fetch?: typeof undiciFetch;
  readonly resolve?: ResolveHost;
};
type WebRenderState = {
  readonly context: ToolContext;
  readonly locator: WebLocator;
  readonly response: WebResponse;
  readonly session: WebFetchSession;
  readonly admit: AdmitDerivedLocator;
  readonly deps: WebReadDeps;
};

type WebFetchedRenderOptions = WebRenderState & {
  readonly raw: boolean;
  readonly prefixNotes?: ReadonlyArray<string>;
};

/**
 * The locator is parsed from `call.input.path` — the text the model
 * submitted, which is the text policy matched — never from a lower-cased
 * scheme, so an uppercase scheme is refused instead of fetched.
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

/** The failure the client reports for a caller abort, repeated for the window
 *  the client's own deadline cannot cover: the session is disposed with the
 *  call, so an abort that lands after the fetch resolved and before the render
 *  starts is visible only to this guard. */
const ABORTED: ToolResult = {
  status: 'error',
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
  const session = deps.createWebFetchSession(
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
  try {
    const response = await session.fetch(locator.url);
    if ('type' in response) return { status: 'error', ...response };
    if (context.abortSignal?.aborted === true) return ABORTED;

    const state: WebRenderState = {
      context,
      locator,
      response,
      session,
      admit,
      deps,
    };
    if (isRawSelector(locator.selector)) {
      return renderFetchedResponse({ ...state, raw: true });
    }
    return renderWithAdapters(state);
  } finally {
    session.dispose();
  }
}

async function renderWithAdapters(state: WebRenderState): Promise<ToolResult> {
  const { context, locator, response, session, admit, deps } = state;
  const adapterIo: WebAdapterIo = {
    fetch: (url) => {
      if (admit('adapter', url).decision === 'reject') {
        return Promise.resolve({
          type: 'permission_denied',
          message: 'The adapter target was refused by operator permissions.',
        });
      }
      return session.fetch(url);
    },
  };
  const adapterResult = await dispatchWebAdapters(
    new URL(locator.url),
    (deps.createWebAdapters ?? createWebAdapters)(context.webAdapters ?? []),
    adapterIo,
  );
  if (adapterResult.kind === 'fatal') {
    return { status: 'error', ...adapterResult.failure };
  }
  if (adapterResult.kind === 'rendered') {
    return deps.buildWebReadResult(locator, response, adapterResult.render);
  }
  return renderFetchedResponse({
    ...state,
    raw: false,
    prefixNotes: adapterResult.notes,
  });
}

async function renderFetchedResponse(
  options: WebFetchedRenderOptions,
): Promise<ToolResult> {
  const { locator, response, raw, session, admit, deps } = options;
  const render = await deps.renderWebContent(
    response,
    { raw },
    { fetch: session.fetch, admit },
  );
  if ('type' in render) return { status: 'error', ...render };
  const prefixNotes = options.prefixNotes ?? [];
  if (prefixNotes.length === 0) {
    return deps.buildWebReadResult(locator, response, render);
  }
  return deps.buildWebReadResult(locator, response, {
    ...render,
    notes: [...prefixNotes, ...(render.notes ?? [])],
  });
}

/** `:raw` skips every probe and conversion. The selector excludes its
 *  leading colon, as it does for the `kb://` and `skill://` locators. */
function isRawSelector(selector: string | undefined): boolean {
  if (selector === undefined) return false;
  return selector === 'raw' || selector.startsWith('raw:');
}
