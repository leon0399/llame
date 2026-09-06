import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { isRecord, isString } from '@workspace/runtime-safety';

type FixtureResponseBase = {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly delayMs?: number;
};

export type McpFixtureResponse =
  | (FixtureResponseBase & { readonly kind: 'json'; readonly body: unknown })
  | (FixtureResponseBase & {
      readonly kind: 'raw';
      readonly body: string | Uint8Array;
      readonly contentType?: string;
    })
  | (FixtureResponseBase & {
      readonly kind: 'sse';
      readonly events: ReadonlyArray<{
        readonly id?: string;
        readonly data: unknown;
        readonly rawData?: boolean;
      }>;
    })
  | { readonly kind: 'disconnect'; readonly delayMs?: number };

export const MCP_STREAMABLE_HTTP_PROTOCOL_VERSIONS = [
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
] as const;

export type McpStreamableHttpProtocolVersion =
  (typeof MCP_STREAMABLE_HTTP_PROTOCOL_VERSIONS)[number];

type McpStreamableHttpInitializeOptions = {
  // Widened (not just the supported literals) so a fixture caller can
  // exercise the runtime rejection of an unsupported version — this
  // function validates the value at runtime regardless of its static type.
  readonly protocolVersion?: McpStreamableHttpProtocolVersion | (string & {});
  readonly sessionId?: string;
};

export function mcpStreamableHttpInitialize(
  input: McpStreamableHttpInitializeOptions = {},
): McpFixtureResponse {
  const protocolVersion: string = input.protocolVersion ?? '2025-11-25';
  if (
    !MCP_STREAMABLE_HTTP_PROTOCOL_VERSIONS.some(
      (supportedVersion) => supportedVersion === protocolVersion,
    )
  ) {
    throw new Error('unsupported Streamable HTTP protocol version');
  }

  return {
    kind: 'json',
    ...(input.sessionId !== undefined && {
      headers: { 'mcp-session-id': input.sessionId },
    }),
    body: {
      jsonrpc: '2.0',
      id: 0,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1.0.0' },
      },
    },
  };
}

export type McpFixtureRequestSummary = {
  readonly httpMethod: string;
  readonly rpcMethod: string | null;
  readonly cursor: string | null;
  readonly headerNames: ReadonlyArray<string>;
};

type RecordedRequest = {
  readonly summary: McpFixtureRequestSummary;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
};

export type McpTestFixture = {
  readonly url: string;
  requestSummaries(): ReadonlyArray<McpFixtureRequestSummary>;
  receivedHeader(index: number, name: string, expectedValue: string): boolean;
  receivedHeaderMatching(
    predicate: (summary: McpFixtureRequestSummary) => boolean,
    name: string,
    expectedValue: string,
  ): boolean;
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- type of the caller-supplied `predicate` callback parameter: the fixture records an arbitrary JSON request body and lets each call site define its own shape check, so there is no single validation to place at this type-declaration site.
  requestMatches(index: number, predicate: (body: unknown) => boolean): boolean;
  close(): Promise<void>;
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readRequestBody(request: IncomingMessage) {
  const chunks: Array<Uint8Array> = [];
  for await (const chunk of request) {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError('MCP fixture request body is not binary.');
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  // SAFETY: JSON.parse returns any; asserting unknown forces callers to
  // narrow before use rather than silently inheriting any.
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function readRpcMethod(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const method = body['method'];
  return isString(method) ? method : null;
}

function readCursor(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const params = body['params'];
  if (!isRecord(params)) return null;
  const cursor = params['cursor'];
  return isString(cursor) ? cursor : null;
}

function responseKey(httpMethod: string, rpcMethod: string | null): string {
  return rpcMethod ?? `$${httpMethod.toLowerCase()}`;
}

function writeHeaders(
  response: ServerResponse,
  action: Exclude<McpFixtureResponse, { kind: 'disconnect' }>,
): void {
  response.statusCode = action.status ?? 200;
  for (const [name, value] of Object.entries(action.headers ?? {})) {
    response.setHeader(name, value);
  }
}

function sseBody(
  events: Extract<McpFixtureResponse, { kind: 'sse' }>['events'],
): string {
  return events
    .map((event) => {
      const data = event.rawData
        ? String(event.data)
        : JSON.stringify(event.data);
      const lines = data.split('\n').map((line) => `data: ${line}`);
      return [...(event.id === undefined ? [] : [`id: ${event.id}`]), ...lines]
        .join('\n')
        .concat('\n\n');
    })
    .join('');
}

async function sendFixtureResponse(
  request: IncomingMessage,
  response: ServerResponse,
  action: McpFixtureResponse,
): Promise<void> {
  if ((action.delayMs ?? 0) > 0) {
    await wait(action.delayMs ?? 0);
  }
  if (action.kind === 'disconnect') {
    request.socket.destroy();
    return;
  }

  writeHeaders(response, action);
  if (action.kind === 'json') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(action.body));
    return;
  }
  if (action.kind === 'raw') {
    response.setHeader(
      'content-type',
      action.contentType ?? 'application/octet-stream',
    );
    response.end(action.body);
    return;
  }
  response.setHeader('content-type', 'text/event-stream');
  response.end(sseBody(action.events));
}

/** How the fixture server answers one request: log it, then dispatch the next scripted action. */
function fixtureRequestListener(
  queues: Map<string, Array<McpFixtureResponse>>,
  requests: Array<RecordedRequest>,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void (async () => {
      let body: unknown;
      try {
        body = await readRequestBody(request);
      } catch {
        response.statusCode = 400;
        response.end('invalid request');
        return;
      }
      const httpMethod = request.method ?? 'GET';
      const rpcMethod = readRpcMethod(body);
      requests.push({
        headers: request.headers,
        body,
        summary: {
          httpMethod,
          rpcMethod,
          cursor: readCursor(body),
          headerNames: Object.keys(request.headers).sort(),
        },
      });
      const queue = queues.get(responseKey(httpMethod, rpcMethod));
      const action = queue?.shift();
      if (action === undefined) {
        response.statusCode = 500;
        response.end('unscripted request');
        return;
      }
      await sendFixtureResponse(request, response, action);
    })();
  };
}

/** Starts `server` on an ephemeral loopback port and returns it, closing the server first on failure. */
async function listenOnLoopbackPort(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null) {
    throw new TypeError('MCP fixture server did not start listening.');
  }
  if (isString(address)) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    throw new TypeError('MCP fixture server did not start listening.');
  }
  return address.port;
}

function hasHeader(
  record: RecordedRequest | undefined,
  name: string,
  expectedValue: string,
): boolean {
  const value = record?.headers[name.toLowerCase()];
  return Array.isArray(value)
    ? value.includes(expectedValue)
    : value === expectedValue;
}

export async function createMcpTestFixture(
  scripts: Readonly<Record<string, ReadonlyArray<McpFixtureResponse>>>,
): Promise<McpTestFixture> {
  const queues = new Map(
    Object.entries(scripts).map(([key, actions]) => [key, [...actions]]),
  );
  const requests: Array<RecordedRequest> = [];
  const server = createServer(fixtureRequestListener(queues, requests));
  const port = await listenOnLoopbackPort(server);
  let closePromise: Promise<void> | undefined;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    requestSummaries: () => requests.map(({ summary }) => ({ ...summary })),
    receivedHeader: (index, name, expectedValue) =>
      hasHeader(requests[index], name, expectedValue),
    receivedHeaderMatching: (predicate, name, expectedValue) =>
      requests.some(
        (request) =>
          predicate(request.summary) && hasHeader(request, name, expectedValue),
      ),
    requestMatches: (index, predicate) =>
      requests[index] !== undefined && predicate(requests[index].body),
    close: () => {
      closePromise ??= new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return closePromise;
    },
  };
}
