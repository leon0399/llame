import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  isAllowedRunControlRequest,
  parseRunControlPeerOrigin,
  readRunControlRequestBody,
  readRunControlResponseBody,
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
const verifiedRebindRequestSchema = z.strictObject({
  targetPeerId: z.string().min(1),
  expectedRouteEpoch: z.number().int().positive(),
});
const runSnapshotSchema = z.strictObject({
  realmId: z.string().min(1),
  runId: z.string().min(1),
  executorNodeId: z.string().min(1),
  authorityEpoch: z.number().int().positive(),
  status: z.enum([
    "queued",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ]),
  cursor: z.number().int().nonnegative(),
  events: z.array(z.unknown()),
});
const moduleCapabilitySchema = z.union([
  z.strictObject({ available: z.literal(false) }),
  z.strictObject({
    version: z.number().int().positive(),
    mode: z.string().min(1).max(64),
  }),
]);
const peerCapabilitiesSchema = z.object({
  protocol: z.strictObject({
    name: z.literal("llame-node"),
    version: z.number().int().positive(),
  }),
  node: z
    .object({
      id: z.string().min(1).max(128).optional(),
      profile: z.string().min(1).max(128),
    })
    .optional(),
  modules: z.record(z.string().min(1).max(200), moduleCapabilitySchema),
});

type RunSnapshot = z.infer<typeof runSnapshotSchema>;

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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const body = await readRunControlRequestBody(request);
  try {
    const input: unknown = JSON.parse(body.toString("utf8"));
    return input;
  } catch {
    throw new Error("invalid_json");
  }
}

async function observePeerRun(
  peer: RunControlProxyPeer,
  runId: string,
): Promise<RunSnapshot> {
  let response: Response;
  try {
    response = await fetch(
      new URL(
        `/v1/runs/${encodeURIComponent(runId)}/control?after=0`,
        parseRunControlPeerOrigin(peer.peerUrl),
      ),
      {
        headers: { authorization: `Bearer ${peer.peerBearerToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new Error("route_verification_unavailable");
  }
  if (!response.ok) throw new Error("run_snapshot_unavailable");
  let input: unknown;
  try {
    input = JSON.parse(
      (await readRunControlResponseBody(response)).toString("utf8"),
    );
  } catch {
    throw new Error("invalid_run_snapshot");
  }
  const parsed = runSnapshotSchema.safeParse(input);
  if (!parsed.success || parsed.data.cursor !== parsed.data.events.length) {
    throw new Error("invalid_run_snapshot");
  }
  return parsed.data;
}

async function observePeerCapabilities(peer: RunControlProxyPeer): Promise<{
  readonly peerId: string;
  readonly status: "available" | "unavailable";
  readonly capabilities?: z.infer<typeof peerCapabilitiesSchema>;
}> {
  try {
    const response = await fetch(
      new URL("/v1/capabilities", parseRunControlPeerOrigin(peer.peerUrl)),
      {
        headers: { authorization: `Bearer ${peer.peerBearerToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return { peerId: peer.peerId, status: "unavailable" };
    const input: unknown = JSON.parse(
      (await readRunControlResponseBody(response)).toString("utf8"),
    );
    const parsed = peerCapabilitiesSchema.safeParse(input);
    return parsed.success
      ? {
          peerId: peer.peerId,
          status: "available",
          capabilities: parsed.data,
        }
      : { peerId: peer.peerId, status: "unavailable" };
  } catch {
    return { peerId: peer.peerId, status: "unavailable" };
  }
}

function targetExtendsCurrentRun(
  current: RunSnapshot,
  target: RunSnapshot,
): boolean {
  return (
    target.realmId === current.realmId &&
    target.runId === current.runId &&
    target.executorNodeId === current.executorNodeId &&
    target.authorityEpoch === current.authorityEpoch &&
    target.status === current.status &&
    target.cursor >= current.cursor &&
    isDeepStrictEqual(target.events.slice(0, current.cursor), current.events)
  );
}

async function verifiedRebind(
  request: IncomingMessage,
  runId: string,
  options: RunControlProxyRouterServerOptions,
  peers: ReadonlyMap<string, RunControlProxyPeer>,
): Promise<
  RunRoute & {
    readonly verified: {
      readonly authorityEpoch: number;
      readonly cursor: number;
    };
  }
> {
  const parsed = verifiedRebindRequestSchema.safeParse(
    await readJsonBody(request),
  );
  if (!parsed.success) throw new Error("invalid_verified_rebind_request");
  const route = options.routes.resolve(runId);
  if (route === null) throw new Error("run_route_required");
  if (route.routeEpoch !== parsed.data.expectedRouteEpoch) {
    throw new Error("Run route epoch conflict");
  }
  const currentPeer = peers.get(route.peerId);
  const targetPeer = peers.get(parsed.data.targetPeerId);
  if (targetPeer === undefined) throw new Error("unknown_peer");
  if (currentPeer === undefined)
    throw new Error("route_verification_unavailable");
  const [currentSnapshot, targetSnapshot] = await Promise.all([
    observePeerRun(currentPeer, runId),
    observePeerRun(targetPeer, runId),
  ]);
  if (!targetExtendsCurrentRun(currentSnapshot, targetSnapshot)) {
    throw new Error("target_run_mismatch");
  }
  const rebound = options.routes.rebind(
    runId,
    targetPeer.peerId,
    parsed.data.expectedRouteEpoch,
  );
  return {
    ...rebound,
    verified: {
      authorityEpoch: targetSnapshot.authorityEpoch,
      cursor: targetSnapshot.cursor,
    },
  };
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
    if (request.method === "GET" && url.pathname === "/v1/proxy/peers") {
      void Promise.all(
        [...peers.values()]
          .sort((left, right) => left.peerId.localeCompare(right.peerId))
          .map((peer) => observePeerCapabilities(peer)),
      ).then((peerStatuses) => {
        sendRunControlProxyJson(response, 200, {
          observedAt: new Date().toISOString(),
          peers: peerStatuses,
        });
      });
      return;
    }
    const verifiedRebindMatch =
      /^\/v1\/proxy\/routes\/([^/]+)\/verified-rebind$/.exec(url.pathname);
    if (request.method === "POST" && verifiedRebindMatch !== null) {
      const runId = decodeRunId(verifiedRebindMatch[1]);
      if (runId === null) {
        sendRunControlProxyJson(response, 400, { error: "invalid_run_id" });
        return;
      }
      void verifiedRebind(request, runId, options, peers)
        .then((result) => sendRunControlProxyJson(response, 200, result))
        .catch((error) => {
          const code =
            error instanceof Error ? error.message : "route_rejected";
          if (
            code === "unknown_peer" ||
            code === "invalid_verified_rebind_request" ||
            code === "invalid_json"
          ) {
            sendRunControlProxyJson(response, 400, { error: code });
            return;
          }
          if (
            code === "route_verification_unavailable" ||
            code === "run_snapshot_unavailable"
          ) {
            sendRunControlProxyJson(response, 503, {
              error: "route_verification_unavailable",
            });
            return;
          }
          if (
            code === "target_run_mismatch" ||
            code === "invalid_run_snapshot"
          ) {
            sendRunControlProxyJson(response, 409, {
              error: "target_run_mismatch",
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
            failureContext: {
              peerId: route.peerId,
              routeEpoch: route.routeEpoch,
            },
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
