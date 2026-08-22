import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { SqliteRunControlProxyCache } from "./run-control-proxy-cache.js";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface RunControlProxyServerOptions {
  readonly localBearerToken: string;
  readonly peerUrl: string;
  readonly peerBearerToken: string;
  readonly cache?: SqliteRunControlProxyCache;
}

export interface RunControlProxyPeer {
  readonly peerId: string;
  readonly peerUrl: string;
  readonly peerBearerToken: string;
}

export interface RunControlProxyTunnelOptions {
  readonly peerUrl: string;
  readonly peerBearerToken: string;
  readonly cache?: SqliteRunControlProxyCache;
  readonly cacheKeyPrefix?: string;
}

export function parseRunControlPeerOrigin(input: string): URL {
  const url = new URL(input);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "peer URL must be an HTTP origin without credentials or path",
    );
  }
  if (
    url.protocol === "http:" &&
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "localhost" &&
    url.hostname !== "[::1]"
  ) {
    throw new Error("plaintext peer URL must use a loopback host");
  }
  return url;
}

export function runControlProxyBearerMatches(
  request: IncomingMessage,
  expectedDigest: Buffer,
): boolean {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ") !== true) return false;
  const digest = createHash("sha256")
    .update(authorization.slice("Bearer ".length))
    .digest();
  return timingSafeEqual(digest, expectedDigest);
}

export function sendRunControlProxyJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

export function isAllowedRunControlRequest(
  method: string | undefined,
  pathname: string,
): boolean {
  return (
    (method === "POST" && pathname === "/v1/runs") ||
    (method === "GET" && /^\/v1\/runs\/[^/]+\/control$/.test(pathname)) ||
    (method === "POST" && /^\/v1\/runs\/[^/]+\/commands$/.test(pathname)) ||
    (method === "POST" && /^\/v1\/runs\/[^/]+\/authority$/.test(pathname)) ||
    (method === "GET" && /^\/v1\/runs\/[^/]+\/workspace$/.test(pathname)) ||
    (method === "POST" &&
      /^\/v1\/runs\/[^/]+\/workspace(?:\/(?:unavailable|recovered|choice))?$/.test(
        pathname,
      ))
  );
}

export async function readRunControlRequestBody(
  request: IncomingMessage,
): Promise<Buffer> {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new Error("json_content_type_required");
  }
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_REQUEST_BYTES) {
    throw new Error("request_body_too_large");
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > MAX_REQUEST_BYTES) {
      request.resume();
      throw new Error("request_body_too_large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readRunControlResponseBody(
  response: Response,
): Promise<Buffer> {
  if (!response.headers.get("content-type")?.startsWith("application/json")) {
    throw new Error("upstream_response_not_json");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("upstream_response_too_large");
  }
  if (response.body === null) throw new Error("upstream_response_missing_body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    received += result.value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("upstream_response_too_large");
    }
    chunks.push(result.value);
  }
  const body = Buffer.concat(chunks);
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    if (parsed === undefined) throw new Error("unreachable");
  } catch {
    throw new Error("upstream_response_not_json");
  }
  return body;
}

export async function tunnelRunControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: RunControlProxyTunnelOptions,
  preparedBody?: Buffer,
): Promise<void> {
  const localUrl = new URL(request.url ?? "/", "http://run-proxy.local");
  if (!isAllowedRunControlRequest(request.method, localUrl.pathname)) {
    sendRunControlProxyJson(response, 404, { error: "not_found" });
    return;
  }
  const method = request.method === "POST" ? "POST" : "GET";
  const requestKey = `${options.cacheKeyPrefix ?? ""}${localUrl.pathname}${localUrl.search}`;
  const body =
    method === "POST"
      ? (preparedBody ?? (await readRunControlRequestBody(request)))
      : undefined;
  const origin = parseRunControlPeerOrigin(options.peerUrl);
  let upstream: Response;
  try {
    upstream = await fetch(
      new URL(`${localUrl.pathname}${localUrl.search}`, origin),
      {
        method,
        headers: {
          authorization: `Bearer ${options.peerBearerToken}`,
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        ...(body === undefined ? {} : { body: body.toString("utf8") }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    const lastKnown =
      method === "GET" ? options.cache?.get(requestKey) : undefined;
    sendRunControlProxyJson(response, 503, {
      error: "upstream_unavailable",
      ...(method === "POST" ? { outcome: "outcome_unknown" } : {}),
      ...(lastKnown === undefined || lastKnown === null ? {} : { lastKnown }),
    });
    return;
  }
  let responseBody: Buffer;
  try {
    responseBody = await readRunControlResponseBody(upstream);
  } catch {
    const lastKnown =
      method === "GET" ? options.cache?.get(requestKey) : undefined;
    sendRunControlProxyJson(response, 502, {
      error: "invalid_upstream_response",
      ...(method === "POST" ? { outcome: "outcome_unknown" } : {}),
      ...(lastKnown === undefined || lastKnown === null ? {} : { lastKnown }),
    });
    return;
  }
  if (method === "GET" && upstream.ok && options.cache !== undefined) {
    const state: unknown = JSON.parse(responseBody.toString("utf8"));
    options.cache.put(requestKey, state);
  }
  response.writeHead(upstream.status, {
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  response.end(responseBody);
}

export function createRunControlProxyServer(
  options: RunControlProxyServerOptions,
): Server {
  if (options.localBearerToken.length < 16) {
    throw new Error("local bearer token must contain at least 16 characters");
  }
  if (options.peerBearerToken.length < 16) {
    throw new Error("peer bearer token must contain at least 16 characters");
  }
  parseRunControlPeerOrigin(options.peerUrl);
  const expectedDigest = createHash("sha256")
    .update(options.localBearerToken)
    .digest();
  return createServer((request, response) => {
    if (!runControlProxyBearerMatches(request, expectedDigest)) {
      sendRunControlProxyJson(
        response,
        401,
        { error: "unauthorized" },
        { "www-authenticate": "Bearer" },
      );
      return;
    }
    if (request.method === "GET" && request.url === "/v1/capabilities") {
      sendRunControlProxyJson(response, 200, {
        protocol: { name: "llame-node", version: 1 },
        node: { profile: "single-owner-run-control-proxy" },
        modules: {
          "execution.run-control": { version: 1, mode: "proxy" },
        },
      });
      return;
    }
    void tunnelRunControlRequest(request, response, options).catch((error) => {
      const code =
        error instanceof Error &&
        (error.message === "json_content_type_required" ||
          error.message === "request_body_too_large")
          ? error.message
          : "proxy_rejected";
      const status =
        code === "json_content_type_required"
          ? 415
          : code === "request_body_too_large"
            ? 413
            : 502;
      sendRunControlProxyJson(response, status, { error: code });
    });
  });
}
