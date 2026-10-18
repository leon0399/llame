import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { isString } from "@workspace/runtime-safety";
import type { JsonValue } from "@workspace/machine-protocol";
import { toJsonValue } from "../json-value";

/** One HTTP request the fixture served, as the assertions need to see it. */
export type McpHttpRequestLog = {
  readonly httpMethod: string;
  readonly protocolVersion: string | null;
  readonly sessionId: string | null;
};

export type McpHttpFixture = {
  /** The endpoint a `.mcp.json` points at. */
  readonly url: string;
  /** The session id the fixture issues, which the daemon must protect. */
  readonly sessionId: string;
  /** Every request received so far, in order. */
  readonly requests: Array<McpHttpRequestLog>;
  stop(): Promise<void>;
};

export type McpHttpFixtureOptions = {
  readonly sessionId?: string;
  readonly toolName?: string;
};

function headerOf(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return isString(value) ? value : null;
}

function readRequestBody(request: IncomingMessage): Promise<JsonValue> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (body.length === 0) {
        resolve(null);
        return;
      }
      const parsed: unknown = JSON.parse(body);
      resolve(toJsonValue(parsed));
    });
    request.on("error", reject);
  });
}

function listen(httpServer: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      if (address === null || isString(address))
        reject(new Error("the fixture has no TCP address"));
      else resolve(`http://127.0.0.1:${String(address.port)}/mcp`);
    });
  });
}

function toolDeclaration(name: string) {
  return {
    name,
    description: "A tool the relayed catalog must show.",
    inputSchema: { type: "object", properties: {} },
  };
}

/** The fixture's request handler: it logs what arrived, then hands the request
 *  to the SDK transport with its body already parsed. */
function requestHandler(
  transport: StreamableHTTPServerTransport,
  requests: Array<McpHttpRequestLog>,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    requests.push({
      httpMethod: request.method ?? "GET",
      protocolVersion: headerOf(request, "mcp-protocol-version"),
      sessionId: headerOf(request, "mcp-session-id"),
    });
    readRequestBody(request)
      .then((body) => transport.handleRequest(request, response, body))
      .catch(() => {
        response.statusCode = 500;
        response.end();
      });
  };
}

/** The SDK's own server-side Streamable HTTP transport, in this process: the
 *  Workspace server a Machine actually opens, with the session id and the
 *  protocol version every request carried made observable. */
export async function startMcpHttpFixture(
  options: McpHttpFixtureOptions = {},
): Promise<McpHttpFixture> {
  const sessionId = options.sessionId ?? "machine-fixture-session";
  const toolName = options.toolName ?? "ping";
  const requests: Array<McpHttpRequestLog> = [];
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  });
  const server = new McpServer(
    { name: "machine-http-fixture", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [toolDeclaration(toolName)],
  }));
  await server.connect(transport);
  const httpServer = createServer(requestHandler(transport, requests));
  const url = await listen(httpServer);

  return {
    url,
    sessionId,
    requests,
    stop: async () => {
      // The daemon's GET stream is still open; closing connections is what
      // keeps a test's teardown from waiting for it.
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve();
        });
      });
      await transport.close();
      await server.close();
    },
  };
}
