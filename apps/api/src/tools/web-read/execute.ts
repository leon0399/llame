import { type ToolContext, type ToolResult } from '../types';
import { fetchWebDocument } from './http-client';
import { parseWebLocator, type WebLocator } from './locator';
import { renderWebDocument } from './pipeline';
import { buildWebReadResult } from './result';

/** The locator-bearing call the native file tools dispatch by scheme. */
type WebReadCall = {
  readonly operation: 'read' | 'edit' | 'write';
  readonly input: { readonly path: string };
};

/**
 * The collaborators a web read runs through. `fetch` is the runtime's own
 * unless a caller binds one, so a test drives the tool without the network.
 */
export type WebReadDeps = {
  readonly parseWebLocator: typeof parseWebLocator;
  readonly fetchWebDocument: typeof fetchWebDocument;
  readonly renderWebDocument: typeof renderWebDocument;
  readonly buildWebReadResult: typeof buildWebReadResult;
  readonly fetch?: typeof globalThis.fetch;
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

const REAL_WEB_READ_DEPS: WebReadDeps = {
  parseWebLocator,
  fetchWebDocument,
  renderWebDocument,
  buildWebReadResult,
};

/** The failure `fetchWebDocument` reports for a caller abort, repeated for the
 *  window that client cannot cover: it disposes its deadline, and with it the
 *  listener that turns an abort into that failure, before this layer renders. */
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
  createWebReadExecutor(REAL_WEB_READ_DEPS);

async function fetchAndRender(
  context: ToolContext,
  locator: WebLocator,
  userAgent: string,
  deps: WebReadDeps,
): Promise<ToolResult> {
  const response = await deps.fetchWebDocument(
    locator.url,
    {
      userAgent,
      signal: context.abortSignal,
      deadlineMs: context.timeoutMs,
    },
    // Resolved at call time, so a replaced runtime `fetch` still reaches the
    // request rather than the one captured when this module loaded.
    { fetch: deps.fetch ?? globalThis.fetch },
  );
  if ('type' in response) {
    return { status: 'error', type: response.type, message: response.message };
  }
  // The client's deadline is disposed with the fetch, and the render below runs
  // synchronously over a body of up to 5 MiB, where no abort can interrupt it,
  // so a call the Run has already given up on must not start that render.
  if (context.abortSignal?.aborted === true) return ABORTED;
  return deps.buildWebReadResult(
    locator,
    response,
    deps.renderWebDocument(response, { raw: isRawSelector(locator.selector) }),
  );
}

/** `:raw` skips every probe and conversion. The selector excludes its
 *  leading colon, as it does for the `kb://` and `skill://` locators. */
function isRawSelector(selector: string | undefined): boolean {
  if (selector === undefined) return false;
  return selector === 'raw' || selector.startsWith('raw:');
}
