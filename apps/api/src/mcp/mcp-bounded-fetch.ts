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

export function createMcpBoundedFetch(input: {
  readonly fetch: McpFetch;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes: number;
  readonly onBytes?: (count: number, request: McpFetchRequestContext) => void;
  readonly onSessionId?: (sessionId: string) => void;
}): McpFetch {
  return async (request, init) => {
    const context = requestContext(request, init);
    const bodySize = requestBodySize(init?.body);
    if (
      input.maxRequestBytes !== undefined &&
      (bodySize === undefined || bodySize > input.maxRequestBytes)
    ) {
      throw new McpRequestLimitError();
    }
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
    const contentLength = response.headers.get('content-length');
    if (
      !isEventStream &&
      contentLength !== null &&
      /^\d+$/u.test(contentLength) &&
      Number(contentLength) > input.maxResponseBytes
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new McpBodyLimitError(input.maxResponseBytes);
    }
    if (response.body === null) return response;

    const reader = response.body.getReader();
    let responseBytes = 0;
    let eventBytes = 0;
    let lineBytes = 0;
    let previousWasCarriageReturn = false;

    const inspect = (chunk: Uint8Array): void => {
      input.onBytes?.(chunk.byteLength, context);
      if (!isEventStream) {
        responseBytes += chunk.byteLength;
        if (responseBytes > input.maxResponseBytes) {
          throw new McpBodyLimitError(input.maxResponseBytes);
        }
        return;
      }

      for (const byte of chunk) {
        eventBytes += 1;
        if (eventBytes > input.maxResponseBytes) {
          throw new McpBodyLimitError(input.maxResponseBytes);
        }
        if (byte === 0x0d) {
          if (lineBytes === 0) eventBytes = 0;
          lineBytes = 0;
          previousWasCarriageReturn = true;
        } else if (byte === 0x0a) {
          if (!previousWasCarriageReturn) {
            if (lineBytes === 0) eventBytes = 0;
            lineBytes = 0;
          }
          previousWasCarriageReturn = false;
        } else {
          previousWasCarriageReturn = false;
          lineBytes += 1;
        }
      }
    };

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
  };
}
