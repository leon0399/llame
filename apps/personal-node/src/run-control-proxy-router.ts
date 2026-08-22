import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

import { z } from "zod";

import {
  isAllowedRunControlRequest,
  parseRunControlPeerOrigin,
  readRunControlRequestBody,
  runControlProxyBearerMatches,
  sendRunControlProxyJson,
  tunnelRunControlRequest,
  type RunControlProxyPeer,
} from "./run-control-proxy.js";
import type { SqliteRunControlProxyCache } from "./run-control-proxy-cache.js";
import type { RunRoute, RunRouteRegistry } from "./run-route-registry.js";

const routeRequestSchema = z.strictObject({
  peerId: z.string().min(1),
  expectedRouteEpoch: z.number().int().positive().optional(),
});
const createRunRequestSchema = z.strictObject({
  runId: z.string().min(1).max(200),
  executorNodeId: z.string().min(1),
});

export interface RunControlProxyRouterServerOptions {
  readonly localBearerToken: string;
  readonly peers: readonly RunControlProxyPeer[];
  readonly routes: RunRouteRegistry;
  readonly cache?: SqliteRunControlProxyCache;
}

function decodeRunId(encoded: string | undefined): string | null {
  if (encoded === undefined) return null;
  try {
    const runId = decodeURIComponent(encoded);
    return runId.length === 0 || runId.length > 200 || runId.includes("/")
      ? null
      : runId;
  } catch {
    return null;
  }
}

function routeError(error: unknown): {
  readonly status: number;
  readonly code: string;
} {
  if (error instanceof Error) {
    if (error.message === "Run route epoch conflict") {
      return { status: 409, code: "route_epoch_conflict" };
    }
    if (error.message === "Run is already routed to another peer") {
      return { status: 409, code: "run_already_routed" };
    }
  }
  return { status: 409, code: "route_rejected" };
}

async function routeControlRequest(
  request: IncomingMessage,
  runId: string,
  options: RunControlProxyRouterServerOptions,
  peers: ReadonlyMap<string, RunControlProxyPeer>,
): Promise<RunRoute> {
  const body = await readRunControlRequestBody(request);
  let input: unknown;
  try {
    input = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("invalid_route_request");
  }
  const parsed = routeRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_route_request");
  if (!peers.has(parsed.data.peerId)) throw new Error("unknown_peer");
  return parsed.data.expectedRouteEpoch === undefined
    ? options.routes.bind(runId, parsed.data.peerId)
    : options.routes.rebind(
        runId,
        parsed.data.peerId,
        parsed.data.expectedRouteEpoch,
      );
}

async function forwardedRunId(
  request: IncomingMessage,
  pathname: string,
): Promise<{ readonly runId: string | null; readonly body?: Buffer }> {
  const pathMatch = /^\/v1\/runs\/([^/]+)\//.exec(pathname);
  if (pathMatch !== null) return { runId: decodeRunId(pathMatch[1]) };
  if (request.method !== "POST" || pathname !== "/v1/runs") {
    return { runId: null };
  }
  const body = await readRunControlRequestBody(request);
  let input: unknown;
  try {
    input = JSON.parse(body.toString("utf8"));
  } catch {
    return { runId: null, body };
  }
  const parsed = createRunRequestSchema.safeParse(input);
  return { runId: parsed.success ? parsed.data.runId : null, body };
}

export function createRunControlProxyRouterServer(
  options: RunControlProxyRouterServerOptions,
): Server {
  if (options.localBearerToken.length < 16) {
    throw new Error("local bearer token must contain at least 16 characters");
  }
  const peers = new Map<string, RunControlProxyPeer>();
  for (const peer of options.peers) {
    if (peer.peerId.length === 0 || peers.has(peer.peerId)) {
      throw new Error("peer ids must be non-empty and unique");
    }
    if (peer.peerBearerToken.length < 16) {
      throw new Error("peer bearer token must contain at least 16 characters");
    }
    parseRunControlPeerOrigin(peer.peerUrl);
    peers.set(peer.peerId, peer);
  }
  if (peers.size === 0) throw new Error("at least one proxy peer is required");
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
    const url = new URL(request.url ?? "/", "http://run-router.local");
    if (request.method === "GET" && url.pathname === "/v1/capabilities") {
      sendRunControlProxyJson(response, 200, {
        protocol: { name: "llame-node", version: 1 },
        node: { profile: "single-owner-run-control-router" },
        modules: {
          "execution.run-control": { version: 1, mode: "proxy-router" },
        },
      });
      return;
    }
    const routeMatch = /^\/v1\/proxy\/routes\/([^/]+)$/.exec(url.pathname);
    if (routeMatch !== null) {
      const runId = decodeRunId(routeMatch[1]);
      if (runId === null) {
        sendRunControlProxyJson(response, 400, { error: "invalid_run_id" });
        return;
      }
      if (request.method === "GET") {
        const route = options.routes.resolve(runId);
        sendRunControlProxyJson(
          response,
          route === null ? 404 : 200,
          route ?? { error: "route_not_found" },
        );
        return;
      }
      if (request.method === "PUT") {
        void routeControlRequest(request, runId, options, peers)
          .then((route) => sendRunControlProxyJson(response, 200, route))
          .catch((error) => {
            if (error instanceof Error && error.message === "unknown_peer") {
              sendRunControlProxyJson(response, 400, { error: "unknown_peer" });
              return;
            }
            if (
              error instanceof Error &&
              error.message === "invalid_route_request"
            ) {
              sendRunControlProxyJson(response, 400, {
                error: "invalid_route_request",
              });
              return;
            }
            const failure = routeError(error);
            sendRunControlProxyJson(response, failure.status, {
              error: failure.code,
            });
          });
        return;
      }
    }
    if (!isAllowedRunControlRequest(request.method, url.pathname)) {
      sendRunControlProxyJson(response, 404, { error: "not_found" });
      return;
    }
    void forwardedRunId(request, url.pathname)
      .then(({ runId, body }) => {
        if (runId === null) {
          sendRunControlProxyJson(response, 400, { error: "invalid_run_id" });
          return;
        }
        const route = options.routes.resolve(runId);
        if (route === null) {
          sendRunControlProxyJson(response, 409, {
            error: "run_route_required",
          });
          return;
        }
        const peer = peers.get(route.peerId);
        if (peer === undefined) {
          sendRunControlProxyJson(response, 503, {
            error: "routed_peer_unavailable",
          });
          return;
        }
        return tunnelRunControlRequest(
          request,
          response,
          {
            peerUrl: peer.peerUrl,
            peerBearerToken: peer.peerBearerToken,
            ...(options.cache === undefined ? {} : { cache: options.cache }),
            cacheKeyPrefix: `${route.peerId}:${route.routeEpoch}:`,
          },
          body,
        );
      })
      .catch((error) => {
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
