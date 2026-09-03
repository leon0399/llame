/**
 * Deterministic Streamable HTTP MCP search server for browser E2E.
 *
 * This is a process fixture, not an application mock: the API and worker use
 * their production MCP client/runtime against this endpoint. It exposes only
 * a readiness probe and a secret-free call count used to prove that history
 * reload does not execute the remote tool again.
 */

import http, {
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";

const port = Number(process.env.E2E_MCP_PORT ?? "4304");

const TOOL_NAME = "search";
const SESSION_ID = "llame-e2e-session";
const FIXTURE_RESULT = [
  "FIXTURE_EVIDENCE_SENTINEL",
  "Current fixture evidence: deterministic operator MCP search succeeded.",
  "Source: https://fixture.invalid/operator-mcp/current",
].join("\n");

let toolCalls = 0;
let sessionBoundRequests = 0;

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type JsonRpcResult = {
  jsonrpc: "2.0";
  id: unknown;
  result: unknown;
};

type JsonRpcError = {
  jsonrpc: "2.0";
  id: unknown;
  error: { code: number; message: string };
};

type JsonRpcResponse = JsonRpcResult | JsonRpcError;

type StatsResponse = {
  toolCalls: number;
  sessionBoundRequests: number;
};

type ToolCallParams = {
  name?: unknown;
};

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isToolCallParams(value: unknown): value is ToolCallParams {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJson(request: IncomingMessage): Promise<JsonRpcRequest> {
  const chunks: Array<Uint8Array> = [];
  for await (const chunk of request) {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("request body is not binary");
    }
    chunks.push(chunk);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isJsonRpcRequest(parsed)) {
    throw new TypeError("request body is not a JSON-RPC object");
  }
  return parsed;
}

function sendJson(
  response: ServerResponse,
  body: JsonRpcResponse | StatsResponse,
  headers: OutgoingHttpHeaders = {},
): void {
  response.writeHead(200, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendResult(
  response: ServerResponse,
  message: JsonRpcResult,
  headers?: OutgoingHttpHeaders,
): void {
  sendJson(response, message, headers);
}

async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let rpc: JsonRpcRequest;
  try {
    rpc = await readJson(request);
  } catch {
    response.writeHead(400).end("invalid request");
    return;
  }

  if (rpc.method === "initialize") {
    sendResult(
      response,
      {
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "llame-e2e-fixture", version: "1.0.0" },
        },
      },
      { "mcp-session-id": SESSION_ID },
    );
    return;
  }

  if (request.headers["mcp-session-id"] !== SESSION_ID) {
    response.writeHead(404).end("invalid session");
    return;
  }
  sessionBoundRequests += 1;

  if (rpc.method === "notifications/initialized") {
    response.writeHead(204).end();
    return;
  }

  if (rpc.method === "tools/list") {
    sendResult(response, {
      jsonrpc: "2.0",
      id: rpc.id,
      result: {
        tools: [
          {
            name: TOOL_NAME,
            description: "Search the deterministic current fixture evidence.",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false,
            },
          },
        ],
      },
    });
    return;
  }

  if (rpc.method === "tools/call") {
    if (!isToolCallParams(rpc.params) || rpc.params.name !== TOOL_NAME) {
      sendJson(response, {
        jsonrpc: "2.0",
        id: rpc.id,
        error: { code: -32_602, message: "unknown fixture tool" },
      });
      return;
    }

    toolCalls += 1;
    sendResult(response, {
      jsonrpc: "2.0",
      id: rpc.id,
      result: {
        content: [{ type: "text", text: FIXTURE_RESULT }],
      },
    });
    return;
  }

  sendJson(response, {
    jsonrpc: "2.0",
    id: rpc.id ?? null,
    error: { code: -32_601, message: "unsupported fixture method" },
  });
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/ready") {
    response.writeHead(200).end("ok");
    return;
  }

  if (request.method === "GET" && request.url === "/stats") {
    sendJson(response, { toolCalls, sessionBoundRequests });
    return;
  }

  // The Streamable HTTP transport probes the optional server-initiated SSE
  // stream. This fixture has no notifications, so the protocol-defined 405
  // keeps the request-local connection closed without withdrawing the server.
  if (request.method === "GET" && request.url === "/mcp") {
    response.writeHead(405).end();
    return;
  }

  if (request.method === "POST" && request.url === "/mcp") {
    void handleMcpRequest(request, response);
    return;
  }

  response.writeHead(404).end();
});

server.listen(port, () => {
  console.log(`[e2e MCP server] listening on :${port}`);
});
