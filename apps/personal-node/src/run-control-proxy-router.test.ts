import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createRunControlProxyRouterServer } from "./run-control-proxy-router.js";
import { SqliteRunControlProxyCache } from "./run-control-proxy-cache.js";
import type { RunControlProxyPeer } from "./run-control-proxy.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not bind");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe("multi-peer Run-control proxy", () => {
  const servers: Server[] = [];
  const directories: string[] = [];
  const caches: SqliteRunControlProxyCache[] = [];

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
    );
    for (const cache of caches.splice(0)) cache.close();
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function peer(
    peerId: string,
    expectedToken: string,
  ): Promise<RunControlProxyPeer> {
    const server = createServer((request, response) => {
      response.writeHead(
        request.headers.authorization === `Bearer ${expectedToken}` ? 200 : 401,
        { "content-type": "application/json" },
      );
      response.end(
        JSON.stringify({ peerId, path: request.url, method: request.method }),
      );
    });
    servers.push(server);
    return {
      peerId,
      peerUrl: await listen(server),
      peerBearerToken: expectedToken,
    };
  }

  test("pins different Runs to explicit configured peers", async () => {
    const routes = new Map<
      string,
      {
        readonly runId: string;
        readonly peerId: string;
        readonly routeEpoch: number;
      }
    >();
    const workstation = await peer("workstation", "workstation-secret");
    const laptop = await peer("laptop", "laptop-peer-secret");
    const router = createRunControlProxyRouterServer({
      localBearerToken: "phone-facing-secret",
      peers: [workstation, laptop],
      routes: {
        resolve: (runId) => routes.get(runId) ?? null,
        bind: (runId, peerId) => {
          const route = { runId, peerId, routeEpoch: 1 };
          routes.set(runId, route);
          return route;
        },
        rebind: (runId, peerId, expectedRouteEpoch) => {
          const current = routes.get(runId);
          if (current?.routeEpoch !== expectedRouteEpoch) {
            throw new Error("Run route epoch conflict");
          }
          const route = { runId, peerId, routeEpoch: expectedRouteEpoch + 1 };
          routes.set(runId, route);
          return route;
        },
      },
    });
    servers.push(router);
    const origin = await listen(router);
    const headers = {
      authorization: "Bearer phone-facing-secret",
      "content-type": "application/json",
    };

    expect(
      await (
        await fetch(`${origin}/v1/proxy/routes/run-a`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ peerId: "workstation" }),
        })
      ).json(),
    ).toEqual({ runId: "run-a", peerId: "workstation", routeEpoch: 1 });
    await fetch(`${origin}/v1/proxy/routes/run-b`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ peerId: "laptop" }),
    });

    const runA = await fetch(`${origin}/v1/runs/run-a/control?after=0`, {
      headers,
    });
    const runB = await fetch(`${origin}/v1/runs/run-b/workspace`, { headers });
    expect(await runA.json()).toMatchObject({
      peerId: "workstation",
      path: "/v1/runs/run-a/control?after=0",
    });
    expect(await runB.json()).toMatchObject({
      peerId: "laptop",
      path: "/v1/runs/run-b/workspace",
    });
  });

  test("rejects unknown peers and requires an epoch-checked explicit rebind", async () => {
    const route = {
      runId: "run-a",
      peerId: "workstation",
      routeEpoch: 1,
    };
    let current = route;
    const router = createRunControlProxyRouterServer({
      localBearerToken: "phone-facing-secret",
      peers: [
        await peer("workstation", "workstation-secret"),
        await peer("laptop", "laptop-peer-secret"),
      ],
      routes: {
        resolve: () => current,
        bind: () => current,
        rebind: (runId, peerId, expectedRouteEpoch) => {
          if (expectedRouteEpoch !== current.routeEpoch) {
            throw new Error("Run route epoch conflict");
          }
          current = { runId, peerId, routeEpoch: current.routeEpoch + 1 };
          return current;
        },
      },
    });
    servers.push(router);
    const origin = await listen(router);
    const headers = {
      authorization: "Bearer phone-facing-secret",
      "content-type": "application/json",
    };

    const unknown = await fetch(`${origin}/v1/proxy/routes/run-x`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ peerId: "caller.example.test" }),
    });
    const stale = await fetch(`${origin}/v1/proxy/routes/run-a`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ peerId: "laptop", expectedRouteEpoch: 2 }),
    });
    const moved = await fetch(`${origin}/v1/proxy/routes/run-a`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ peerId: "laptop", expectedRouteEpoch: 1 }),
    });

    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "unknown_peer" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "route_epoch_conflict" });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toEqual({
      runId: "run-a",
      peerId: "laptop",
      routeEpoch: 2,
    });
  });

  test("requires a route before forwarding and routes Run creation by body id", async () => {
    const routes = new Map<
      string,
      {
        readonly runId: string;
        readonly peerId: string;
        readonly routeEpoch: number;
      }
    >();
    const router = createRunControlProxyRouterServer({
      localBearerToken: "phone-facing-secret",
      peers: [await peer("workstation", "workstation-secret")],
      routes: {
        resolve: (runId) => routes.get(runId) ?? null,
        bind: (runId, peerId) => {
          const bound = { runId, peerId, routeEpoch: 1 };
          routes.set(runId, bound);
          return bound;
        },
        rebind: () => {
          throw new Error("not used");
        },
      },
    });
    servers.push(router);
    const origin = await listen(router);
    const headers = {
      authorization: "Bearer phone-facing-secret",
      "content-type": "application/json",
    };

    const unrouted = await fetch(`${origin}/v1/runs/run-missing/control`, {
      headers,
    });
    await fetch(`${origin}/v1/proxy/routes/run-new`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ peerId: "workstation" }),
    });
    const created = await fetch(`${origin}/v1/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ runId: "run-new", executorNodeId: "worker" }),
    });

    expect(unrouted.status).toBe(409);
    expect(await unrouted.json()).toEqual({ error: "run_route_required" });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      peerId: "workstation",
      method: "POST",
      path: "/v1/runs",
    });
  });

  test("does not reuse a stale observation after an explicit peer rebind", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-router-cache-"));
    directories.push(directory);
    const cache = new SqliteRunControlProxyCache({
      databasePath: join(directory, "cache.sqlite"),
    });
    caches.push(cache);
    const healthy = await peer("workstation", "workstation-secret");
    const disconnectedServer = createServer((request) => {
      request.socket.destroy();
    });
    servers.push(disconnectedServer);
    const disconnected: RunControlProxyPeer = {
      peerId: "laptop",
      peerUrl: await listen(disconnectedServer),
      peerBearerToken: "laptop-peer-secret",
    };
    let current = {
      runId: "run-a",
      peerId: "workstation",
      routeEpoch: 1,
    };
    const router = createRunControlProxyRouterServer({
      localBearerToken: "phone-facing-secret",
      peers: [healthy, disconnected],
      cache,
      routes: {
        resolve: () => current,
        bind: () => current,
        rebind: (runId, peerId, expectedRouteEpoch) => {
          if (expectedRouteEpoch !== current.routeEpoch) {
            throw new Error("Run route epoch conflict");
          }
          current = { runId, peerId, routeEpoch: current.routeEpoch + 1 };
          return current;
        },
      },
    });
    servers.push(router);
    const origin = await listen(router);
    const headers = {
      authorization: "Bearer phone-facing-secret",
      "content-type": "application/json",
    };

    const observed = await fetch(`${origin}/v1/runs/run-a/control?after=0`, {
      headers,
    });
    await fetch(`${origin}/v1/proxy/routes/run-a`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ peerId: "laptop", expectedRouteEpoch: 1 }),
    });
    const afterMove = await fetch(`${origin}/v1/runs/run-a/control?after=0`, {
      headers,
    });

    expect(observed.status).toBe(200);
    expect(afterMove.status).toBe(503);
    expect(await afterMove.json()).toEqual({ error: "upstream_unavailable" });
  });

  test("verifies replicated semantic state before changing a peer route", async () => {
    const snapshot = {
      realmId: "realm-personal",
      runId: "run-a",
      executorNodeId: "worker",
      authorityEpoch: 3,
      status: "running",
      cursor: 1,
      events: [
        {
          realmId: "realm-personal",
          runId: "run-a",
          executorNodeId: "worker",
          authorityEpoch: 3,
          sequence: 1,
          eventId: "event-running",
          event: { type: "status", status: "running" },
        },
      ],
    };
    const snapshotPeer = async (
      peerId: string,
      peerSnapshot: unknown,
    ): Promise<RunControlProxyPeer> => {
      const server = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(peerSnapshot));
      });
      servers.push(server);
      return {
        peerId,
        peerUrl: await listen(server),
        peerBearerToken: `${peerId}-credential-secret`,
      };
    };
    let current = {
      runId: "run-a",
      peerId: "workstation",
      routeEpoch: 1,
    };
    const router = createRunControlProxyRouterServer({
      localBearerToken: "phone-facing-secret",
      peers: [
        await snapshotPeer("workstation", snapshot),
        await snapshotPeer("laptop", snapshot),
        await snapshotPeer("stale-laptop", {
          ...snapshot,
          authorityEpoch: 2,
        }),
      ],
      routes: {
        resolve: () => current,
        bind: () => current,
        rebind: (runId, peerId, expectedRouteEpoch) => {
          if (expectedRouteEpoch !== current.routeEpoch) {
            throw new Error("Run route epoch conflict");
          }
          current = { runId, peerId, routeEpoch: current.routeEpoch + 1 };
          return current;
        },
      },
    });
    servers.push(router);
    const origin = await listen(router);
    const headers = {
      authorization: "Bearer phone-facing-secret",
      "content-type": "application/json",
    };

    const mismatch = await fetch(
      `${origin}/v1/proxy/routes/run-a/verified-rebind`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          targetPeerId: "stale-laptop",
          expectedRouteEpoch: 1,
        }),
      },
    );
    const moved = await fetch(
      `${origin}/v1/proxy/routes/run-a/verified-rebind`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          targetPeerId: "laptop",
          expectedRouteEpoch: 1,
        }),
      },
    );

    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toEqual({ error: "target_run_mismatch" });
    expect(current).toMatchObject({ peerId: "laptop", routeEpoch: 2 });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toEqual({
      runId: "run-a",
      peerId: "laptop",
      routeEpoch: 2,
      verified: {
        authorityEpoch: 3,
        cursor: 1,
      },
    });
  });
});
