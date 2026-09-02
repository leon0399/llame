import { isRecord, isString } from '../unknown-record';

export class McpBodyLimitError extends Error {
  constructor(limit: number) {
    super(`MCP response exceeded the ${limit}-byte transport limit.`);
    this.name = 'McpBodyLimitError';
  }
}

export class McpRequestLimitError extends Error {
  constructor() {
    super('MCP request exceeded the transport limit.');
    this.name = 'McpRequestLimitError';
  }
}

export type McpFetchRequestContext = {
  readonly httpMethod: string;
  readonly rpcMethod: string | null;
};

type McpFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function requestContext(
  request: RequestInfo | URL,
  init: RequestInit | undefined,
): McpFetchRequestContext {
  const httpMethod = (
    init?.method ?? (request instanceof Request ? request.method : 'GET')
  ).toUpperCase();
  if (!isString(init?.body)) {
    return { httpMethod, rpcMethod: null };
  }
  try {
    // SAFETY: JSON.parse returns any; asserting unknown forces isRecord's
    // check below rather than silently inheriting any.
    const body = JSON.parse(init.body) as unknown;
    if (!isRecord(body)) {
      return { httpMethod, rpcMethod: null };
    }
    const method = body['method'];
    return {
      httpMethod,
      rpcMethod: isString(method) ? method : null,
    };
  } catch {
    return { httpMethod, rpcMethod: null };
  }
}

function requestBodySize(
  body: BodyInit | null | undefined,
): number | undefined {
  if (body === undefined || body === null) return 0;
  if (isString(body)) return new TextEncoder().encode(body).byteLength;
  if (body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString()).byteLength;
  }
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof Blob) return body.size;
  return undefined;
}

/**
 * Builds the per-chunk byte accountant for one bounded response body: a flat
 * byte count outside an SSE stream, or an SSE-event-boundary-aware count
 * within one — a blank line (bare CRLF/LF) resets the running event size, so
 * a stream of small events never accumulates against a large one's budget —
 * both throwing once `maxResponseBytes` is exceeded.
 */
function throwIfOverLimit(bytes: number, maxResponseBytes: number): void {
  if (bytes > maxResponseBytes) throw new McpBodyLimitError(maxResponseBytes);
}

function createByteInspector(
  isEventStream: boolean | undefined,
  context: McpFetchRequestContext,
  maxResponseBytes: number,
  onBytes:
    | ((count: number, request: McpFetchRequestContext) => void)
    | undefined,
): (chunk: Uint8Array) => void {
  let responseBytes = 0;
  let eventBytes = 0;
  let lineBytes = 0;
  let previousWasCarriageReturn = false;
  const onLineEnd = (): void => {
    if (lineBytes === 0) eventBytes = 0;
    lineBytes = 0;
  };

  return (chunk) => {
    onBytes?.(chunk.byteLength, context);
    if (!isEventStream) {
      responseBytes += chunk.byteLength;
      throwIfOverLimit(responseBytes, maxResponseBytes);
      return;
    }

    for (const byte of chunk) {
      eventBytes += 1;
      throwIfOverLimit(eventBytes, maxResponseBytes);
      if (byte === 0x0d) {
        onLineEnd();
        previousWasCarriageReturn = true;
      } else if (byte === 0x0a) {
        if (!previousWasCarriageReturn) onLineEnd();
        previousWasCarriageReturn = false;
      } else {
        previousWasCarriageReturn = false;
        lineBytes += 1;
      }
    }
  };
}

/** Wraps `response`'s non-null body in a stream that reports every chunk to
 * `inspect` before passing it through, cancelling the source reader on error
 * or downstream cancellation. */
function boundResponseBody(
  response: Response,
  body: ReadableStream<Uint8Array>,
  inspect: (chunk: Uint8Array) => void,
): Response {
  const reader = body.getReader();
  const boundedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          return;
        }
        inspect(next.value);
        controller.enqueue(next.value);
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        controller.error(error);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
  const boundedResponse = new Response(boundedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  Object.defineProperties(boundedResponse, {
    redirected: { value: response.redirected },
    type: { value: response.type },
    url: { value: response.url },
  });
  return boundedResponse;
}

function assertWithinRequestBytes(
  bodySize: number | undefined,
  maxRequestBytes: number | undefined,
): void {
  if (
    maxRequestBytes !== undefined &&
    (bodySize === undefined || bodySize > maxRequestBytes)
  ) {
    throw new McpRequestLimitError();
  }
}

/** Rejects outright when the server's declared Content-Length already
 * exceeds the bound, before any of the body is read. An SSE response's
 * eventual size isn't knowable upfront, so this only ever applies to a
 * non-streaming body. */
async function rejectIfContentLengthExceeds(
  response: Response,
  isEventStream: boolean | undefined,
  maxResponseBytes: number,
): Promise<void> {
  const contentLength = response.headers.get('content-length');
  if (
    isEventStream ||
    contentLength === null ||
    !/^\d+$/u.test(contentLength) ||
    Number(contentLength) <= maxResponseBytes
  ) {
    return;
  }
  await response.body?.cancel().catch(() => undefined);
  throw new McpBodyLimitError(maxResponseBytes);
}

export function createMcpBoundedFetch(input: {
  readonly fetch: McpFetch;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes: number;
  readonly onBytes?: (count: number, request: McpFetchRequestContext) => void;
  readonly onSessionId?: (sessionId: string) => void;
}): McpFetch {
  return async (request, init) => {
    const context = requestContext(request, init);
    assertWithinRequestBytes(
      requestBodySize(init?.body),
      input.maxRequestBytes,
    );

    const response = await input.fetch(request, {
      ...init,
      redirect: 'error',
    });
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) input.onSessionId?.(sessionId);

    const isEventStream =
      response.ok &&
      response.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('text/event-stream');
    await rejectIfContentLengthExceeds(
      response,
      isEventStream,
      input.maxResponseBytes,
    );
    if (response.body === null) return response;

    const inspect = createByteInspector(
      isEventStream,
      context,
      input.maxResponseBytes,
      input.onBytes,
    );
    return boundResponseBody(response, response.body, inspect);
  };
}
