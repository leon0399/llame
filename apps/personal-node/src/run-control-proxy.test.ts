import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateWriterIdentity } from "@workspace/federation-experiment/batch-signature";
import { createEnrollmentProof } from "@workspace/federation-experiment/node-enrollment";
import { afterEach, describe, expect, test } from "vitest";

import { SqliteEnrollmentRegistry } from "./enrollment-registry.js";
import { createPersonalNodeServer } from "./node-server.js";
import { createRunControlProxyServer } from "./run-control-proxy.js";
import { SqliteRunControlProxyCache } from "./run-control-proxy-cache.js";
import { SqliteRunControlStore } from "./run-control-store.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";

describe("same-contract Run-control proxy", () => {
  const temporaryDirectories: string[] = [];
  const servers: Server[] = [];
  const stores: SqlitePersonalRealmStore[] = [];
  const registries: SqliteEnrollmentRegistry[] = [];
  const runStores: SqliteRunControlStore[] = [];
  const proxyCaches: SqliteRunControlProxyCache[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error === undefined) resolve();
              else reject(error);
            });
          }),
      ),
    );
    for (const proxyCache of proxyCaches.splice(0)) proxyCache.close();
    for (const runStore of runStores.splice(0)) runStore.close();
    for (const registry of registries.splice(0)) registry.close();
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("recovers remote semantic state after a stateless proxy restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-run-proxy-"));
    temporaryDirectories.push(directory);
    const realmStore = new SqlitePersonalRealmStore({
      databasePath: join(directory, "remote-realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { remote: 1 },
    });
    const registry = new SqliteEnrollmentRegistry({
      databasePath: join(directory, "remote-enrollment.sqlite"),
      realmId: "realm-personal",
    });
    const runStore = new SqliteRunControlStore({
      databasePath: join(directory, "remote-runs.sqlite"),
      realmId: "realm-personal",
    });
    stores.push(realmStore);
    registries.push(registry);
    runStores.push(runStore);
    const proxyIdentity = generateWriterIdentity();
    const proxyGrant = registry.completeEnrollment(
      createEnrollmentProof(
        registry.issueChallenge({ nodeId: "node-personal-realm" }),
        proxyIdentity.privateKeyPem,
      ),
      new Date(),
      ["run.observe", "run.steer", "run.control"],
    );
    runStore.createRun({ runId: "run-remote", executorNodeId: "node-remote" });
    runStore.appendExecutorEvent({
      realmId: "realm-personal",
      runId: "run-remote",
      executorNodeId: "node-remote",
      authorityEpoch: 1,
      sequence: 1,
      eventId: "event-running",
      event: { type: "status", status: "running" },
    });
    const remote = createPersonalNodeServer({
      nodeId: "node-remote",
      bearerToken: "remote-owner-secret",
      store: realmStore,
      enrollmentRegistry: registry,
      runControlStore: runStore,
    });
    servers.push(remote);
    await new Promise<void>((resolve) =>
      remote.listen(0, "127.0.0.1", resolve),
    );
    const remoteAddress = remote.address();
    if (remoteAddress === null || typeof remoteAddress === "string") {
      throw new Error("remote test node did not bind a TCP address");
    }
    const proxyOptions = {
      localBearerToken: "phone-facing-secret",
      peerUrl: `http://127.0.0.1:${remoteAddress.port}`,
      peerBearerToken: proxyGrant.credential,
    } as const;
    const proxy = createRunControlProxyServer(proxyOptions);
    servers.push(proxy);
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const proxyAddress = proxy.address();
    if (proxyAddress === null || typeof proxyAddress === "string") {
      throw new Error("proxy test node did not bind a TCP address");
    }
    const proxyOrigin = `http://127.0.0.1:${proxyAddress.port}`;
    const localHeaders = {
      authorization: "Bearer phone-facing-secret",
      "content-type": "application/json",
    };

    const firstObservation = await fetch(
      `${proxyOrigin}/v1/runs/run-remote/control?after=0`,
      { headers: localHeaders },
    );
    const steered = await fetch(`${proxyOrigin}/v1/runs/run-remote/commands`, {
      method: "POST",
      headers: localHeaders,
      body: JSON.stringify({
        commandId: "command-phone",
        authorityEpoch: 1,
        command: { type: "steer", text: "Continue from the phone" },
      }),
    });
    await new Promise<void>((resolve, reject) => {
      proxy.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
    servers.splice(servers.indexOf(proxy), 1);
    const restartedProxy = createRunControlProxyServer(proxyOptions);
    servers.push(restartedProxy);
    await new Promise<void>((resolve) =>
      restartedProxy.listen(0, "127.0.0.1", resolve),
    );
    const restartedAddress = restartedProxy.address();
    if (restartedAddress === null || typeof restartedAddress === "string") {
      throw new Error("restarted proxy did not bind a TCP address");
    }
    const recoveredObservation = await fetch(
      `http://127.0.0.1:${restartedAddress.port}/v1/runs/run-remote/control?after=1`,
      { headers: localHeaders },
    );
    const forbiddenExecutorWrite = await fetch(
      `http://127.0.0.1:${restartedAddress.port}/v1/runs/run-remote/events`,
      {
        method: "POST",
        headers: localHeaders,
        body: "{}",
      },
    );

    expect(firstObservation.status).toBe(200);
    expect(await firstObservation.json()).toMatchObject({
      status: "running",
      cursor: 1,
      events: [{ eventId: "event-running" }],
    });
    expect(steered.status).toBe(202);
    expect(runStore.commandsAfter("run-remote", 0)).toMatchObject([
      { commandId: "command-phone" },
    ]);
    expect(recoveredObservation.status).toBe(200);
    expect(await recoveredObservation.json()).toMatchObject({
      status: "running",
      cursor: 1,
      events: [],
    });
    expect(forbiddenExecutorWrite.status).toBe(404);
  });

  test("reports outcome_unknown only for an ambiguous upstream mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-run-proxy-"));
    temporaryDirectories.push(directory);
    const cache = new SqliteRunControlProxyCache({
      databasePath: join(directory, "proxy-cache.sqlite"),
    });
    proxyCaches.push(cache);
    cache.put(
      "/v1/runs/run-1/control?after=0",
      {
        runId: "run-1",
        status: "running",
        cursor: 3,
        events: [],
      },
      new Date("2026-08-22T13:00:00.000Z"),
    );
    const disconnectingUpstream = createServer((request) => {
      request.resume();
      request.once("end", () => request.socket.destroy());
    });
    servers.push(disconnectingUpstream);
    await new Promise<void>((resolve) =>
      disconnectingUpstream.listen(0, "127.0.0.1", resolve),
    );
    const upstreamAddress = disconnectingUpstream.address();
    if (upstreamAddress === null || typeof upstreamAddress === "string") {
      throw new Error("disconnecting upstream did not bind a TCP address");
    }
    const proxy = createRunControlProxyServer({
      localBearerToken: "phone-facing-secret",
      peerUrl: `http://127.0.0.1:${upstreamAddress.port}`,
      peerBearerToken: "scoped-upstream-secret",
      cache,
    });
    servers.push(proxy);
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const proxyAddress = proxy.address();
    if (proxyAddress === null || typeof proxyAddress === "string") {
      throw new Error("proxy did not bind a TCP address");
    }
    const origin = `http://127.0.0.1:${proxyAddress.port}`;
    const headers = {
      authorization: "Bearer phone-facing-secret",
      "content-type": "application/json",
    };

    const mutation = await fetch(`${origin}/v1/runs/run-1/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        commandId: "command-ambiguous",
        authorityEpoch: 1,
        command: { type: "cancel" },
      }),
    });
    const observation = await fetch(`${origin}/v1/runs/run-1/control?after=0`, {
      headers,
    });

    expect(mutation.status).toBe(503);
    expect(await mutation.json()).toEqual({
      error: "upstream_unavailable",
      outcome: "outcome_unknown",
    });
    expect(observation.status).toBe(503);
    expect(await observation.json()).toEqual({
      error: "upstream_unavailable",
      lastKnown: {
        observedAt: "2026-08-22T13:00:00.000Z",
        state: {
          runId: "run-1",
          status: "running",
          cursor: 3,
          events: [],
        },
      },
    });
  });
});
