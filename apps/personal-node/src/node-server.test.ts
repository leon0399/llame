import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import {
  generateWriterIdentity,
  signChangeBatch,
} from "@workspace/federation-experiment/batch-signature";
import { createEnrollmentProof } from "@workspace/federation-experiment/node-enrollment";

import { createPersonalNodeServer } from "./node-server.js";
import { SqliteEnrollmentRegistry } from "./enrollment-registry.js";
import { SqliteRunControlStore } from "./run-control-store.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";

describe("personal Node Protocol server", () => {
  const temporaryDirectories: string[] = [];
  const servers: Server[] = [];
  const stores: SqlitePersonalRealmStore[] = [];
  const enrollmentRegistries: SqliteEnrollmentRegistry[] = [];
  const runControlStores: SqliteRunControlStore[] = [];

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
    for (const runControlStore of runControlStores.splice(0)) {
      runControlStore.close();
    }
    for (const registry of enrollmentRegistries.splice(0)) {
      registry.close();
    }
    for (const store of stores.splice(0)) {
      store.close();
    }
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("requires the node credential before disclosing capabilities", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-personal-node-"));
    temporaryDirectories.push(directory);
    const store = new SqlitePersonalRealmStore({
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    stores.push(store);
    const server = createPersonalNodeServer({
      nodeId: "node-desktop",
      bearerToken: "test-node-secret",
      store,
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not bind a TCP address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/capabilities`,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  test("advertises the common contract and honest local capability subset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-personal-node-"));
    temporaryDirectories.push(directory);
    const store = new SqlitePersonalRealmStore({
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    stores.push(store);
    const server = createPersonalNodeServer({
      nodeId: "node-desktop",
      bearerToken: "test-node-secret",
      store,
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not bind a TCP address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/capabilities`,
      { headers: { authorization: "Bearer test-node-secret" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      protocol: { name: "llame-node", version: 1 },
      node: {
        id: "node-desktop",
        profile: "single-owner-personal",
      },
      realm: { id: "realm-personal" },
      modules: {
        "sync.personal-realm": { version: 1, mode: "read-write" },
        "sync.signed-personal-realm": { available: false },
        "enrollment.node": { available: false },
        "execution.run-control": { available: false },
        "execution.workspace": { available: false },
      },
    });
  });

  test("reconciles a Chat between two durable nodes through the common API", async () => {
    const sourceDirectory = await mkdtemp(
      join(tmpdir(), "llame-personal-node-source-"),
    );
    const targetDirectory = await mkdtemp(
      join(tmpdir(), "llame-personal-node-target-"),
    );
    temporaryDirectories.push(sourceDirectory, targetDirectory);
    const storeOptions = {
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    } as const;
    const sourceStore = new SqlitePersonalRealmStore({
      ...storeOptions,
      databasePath: join(sourceDirectory, "realm.sqlite"),
    });
    const targetStore = new SqlitePersonalRealmStore({
      ...storeOptions,
      databasePath: join(targetDirectory, "realm.sqlite"),
    });
    stores.push(sourceStore, targetStore);
    sourceStore.receive({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      operations: [
        {
          type: "append-message",
          chatId: "chat-1",
          messageId: "message-root",
          parentMessageId: null,
          text: "Synced over the Node Protocol",
        },
      ],
    });
    const sourceServer = createPersonalNodeServer({
      nodeId: "node-source",
      bearerToken: "source-node-secret",
      store: sourceStore,
    });
    const targetServer = createPersonalNodeServer({
      nodeId: "node-target",
      bearerToken: "target-node-secret",
      store: targetStore,
    });
    servers.push(sourceServer, targetServer);
    await Promise.all([
      new Promise<void>((resolve) =>
        sourceServer.listen(0, "127.0.0.1", resolve),
      ),
      new Promise<void>((resolve) =>
        targetServer.listen(0, "127.0.0.1", resolve),
      ),
    ]);
    const sourceAddress = sourceServer.address();
    const targetAddress = targetServer.address();
    if (
      sourceAddress === null ||
      typeof sourceAddress === "string" ||
      targetAddress === null ||
      typeof targetAddress === "string"
    ) {
      throw new Error("test nodes did not bind TCP addresses");
    }
    const targetAuthorization = {
      authorization: "Bearer target-node-secret",
    };
    const sourceAuthorization = {
      authorization: "Bearer source-node-secret",
    };

    const frontierResponse = await fetch(
      `http://127.0.0.1:${targetAddress.port}/v1/realm/frontier`,
      { headers: targetAuthorization },
    );
    const frontierBody: unknown = await frontierResponse.json();
    const exportResponse = await fetch(
      `http://127.0.0.1:${sourceAddress.port}/v1/sync/export`,
      {
        method: "POST",
        headers: {
          ...sourceAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify(frontierBody),
      },
    );
    const exportBody: unknown = await exportResponse.json();
    const applyResponse = await fetch(
      `http://127.0.0.1:${targetAddress.port}/v1/sync/apply`,
      {
        method: "POST",
        headers: {
          ...targetAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify(exportBody),
      },
    );
    const branchesResponse = await fetch(
      `http://127.0.0.1:${targetAddress.port}/v1/chats/chat-1/branches`,
      { headers: targetAuthorization },
    );

    expect(frontierResponse.status).toBe(200);
    expect(exportResponse.status).toBe(200);
    expect(applyResponse.status).toBe(200);
    expect(await applyResponse.json()).toEqual({
      applied: 1,
      frontier: { desktop: 1 },
    });
    expect(branchesResponse.status).toBe(200);
    expect(await branchesResponse.json()).toEqual({
      branches: [
        {
          branchId: "message-root",
          headMessageId: "message-root",
          messageIds: ["message-root"],
        },
      ],
    });
  });

  test("reconciles only verified writer envelopes through signed sync", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-signed-node-"));
    temporaryDirectories.push(directory);
    const desktop = generateWriterIdentity();
    const storeOptions = {
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
      trustedWriterKeys: { "desktop:1": desktop.publicKeyPem },
    } as const;
    const source = new SqlitePersonalRealmStore({
      ...storeOptions,
      databasePath: join(directory, "source.sqlite"),
    });
    const target = new SqlitePersonalRealmStore({
      ...storeOptions,
      databasePath: join(directory, "target.sqlite"),
    });
    stores.push(source, target);
    const signed = signChangeBatch(
      {
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        operations: [
          {
            type: "append-message",
            chatId: "chat-signed",
            messageId: "message-signed",
            parentMessageId: null,
            text: "Authenticated offline event",
          },
        ],
      },
      desktop.privateKeyPem,
    );
    source.receiveSigned(signed);
    const sourceServer = createPersonalNodeServer({
      nodeId: "node-source",
      bearerToken: "source-node-secret",
      store: source,
    });
    const targetServer = createPersonalNodeServer({
      nodeId: "node-target",
      bearerToken: "target-node-secret",
      store: target,
    });
    servers.push(sourceServer, targetServer);
    await Promise.all([
      new Promise<void>((resolve) =>
        sourceServer.listen(0, "127.0.0.1", resolve),
      ),
      new Promise<void>((resolve) =>
        targetServer.listen(0, "127.0.0.1", resolve),
      ),
    ]);
    const sourceAddress = sourceServer.address();
    const targetAddress = targetServer.address();
    if (
      sourceAddress === null ||
      typeof sourceAddress === "string" ||
      targetAddress === null ||
      typeof targetAddress === "string"
    ) {
      throw new Error("test nodes did not bind TCP addresses");
    }

    const exported = await fetch(
      `http://127.0.0.1:${sourceAddress.port}/v1/signed-sync/export`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer source-node-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ frontier: {} }),
      },
    );
    const applied = await fetch(
      `http://127.0.0.1:${targetAddress.port}/v1/signed-sync/apply`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer target-node-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(await exported.json()),
      },
    );

    expect(exported.status).toBe(200);
    expect(applied.status).toBe(200);
    expect(target.exportSignedMissing({})).toEqual([signed]);
    expect(target.chatBranches("chat-signed")).toHaveLength(1);
  });

  test("enrolls and explicitly revokes a cryptographic node identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-node-enrollment-"));
    temporaryDirectories.push(directory);
    const store = new SqlitePersonalRealmStore({
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    stores.push(store);
    const registry = new SqliteEnrollmentRegistry({
      databasePath: join(directory, "enrollment.sqlite"),
      realmId: "realm-personal",
    });
    enrollmentRegistries.push(registry);
    const server = createPersonalNodeServer({
      nodeId: "node-home",
      bearerToken: "owner-control-secret",
      store,
      enrollmentRegistry: registry,
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not bind a TCP address");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = {
      authorization: "Bearer owner-control-secret",
      "content-type": "application/json",
    };
    const node = generateWriterIdentity();

    const challengeResponse = await fetch(
      `${origin}/v1/enrollment/challenges`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ nodeId: "node-desktop" }),
      },
    );
    const challenge: unknown = await challengeResponse.json();
    const completeResponse = await fetch(`${origin}/v1/enrollment/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        proof: createEnrollmentProof(challenge, node.privateKeyPem),
      }),
    });
    const completeBody: unknown = await completeResponse.json();
    if (
      typeof completeBody !== "object" ||
      completeBody === null ||
      !("credential" in completeBody) ||
      typeof completeBody.credential !== "string"
    ) {
      throw new Error("enrollment did not return a node credential");
    }
    const enrolledHeaders = {
      authorization: `Bearer ${completeBody.credential}`,
    };
    const beforeRevocation = await fetch(`${origin}/v1/realm/frontier`, {
      headers: enrolledHeaders,
    });
    const forbiddenControlRequest = await fetch(
      `${origin}/v1/enrollment/challenges`,
      {
        method: "POST",
        headers: {
          ...enrolledHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({ nodeId: "node-attacker" }),
      },
    );
    const revokeResponse = await fetch(
      `${origin}/v1/enrollments/node-desktop`,
      { method: "DELETE", headers },
    );
    const afterRevocation = await fetch(`${origin}/v1/realm/frontier`, {
      headers: enrolledHeaders,
    });

    expect(challengeResponse.status).toBe(201);
    expect(completeResponse.status).toBe(201);
    expect(completeBody).toMatchObject({
      nodeId: "node-desktop",
      keyId: node.keyId,
      revokedAt: null,
    });
    expect(beforeRevocation.status).toBe(200);
    expect(forbiddenControlRequest.status).toBe(401);
    expect(revokeResponse.status).toBe(200);
    expect(await revokeResponse.json()).toEqual({ revoked: true });
    expect(afterRevocation.status).toBe(401);
    expect(await afterRevocation.json()).toEqual({ error: "unauthorized" });
    expect(registry.isActive("node-desktop", node.keyId)).toBe(false);
  });

  test("observes and steers a remote Run while fencing its prior executor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-run-control-api-"));
    temporaryDirectories.push(directory);
    const store = new SqlitePersonalRealmStore({
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { home: 1 },
    });
    const registry = new SqliteEnrollmentRegistry({
      databasePath: join(directory, "enrollment.sqlite"),
      realmId: "realm-personal",
    });
    const runControlStore = new SqliteRunControlStore({
      databasePath: join(directory, "runs.sqlite"),
      realmId: "realm-personal",
    });
    stores.push(store);
    enrollmentRegistries.push(registry);
    runControlStores.push(runControlStore);
    const executor = generateWriterIdentity();
    const controller = generateWriterIdentity();
    const fallback = generateWriterIdentity();
    const executorGrant = registry.completeEnrollment(
      createEnrollmentProof(
        registry.issueChallenge({ nodeId: "node-workstation" }),
        executor.privateKeyPem,
      ),
    );
    const controllerGrant = registry.completeEnrollment(
      createEnrollmentProof(
        registry.issueChallenge({ nodeId: "node-phone" }),
        controller.privateKeyPem,
      ),
    );
    const fallbackGrant = registry.completeEnrollment(
      createEnrollmentProof(
        registry.issueChallenge({ nodeId: "node-fallback" }),
        fallback.privateKeyPem,
      ),
    );
    const server = createPersonalNodeServer({
      nodeId: "node-home",
      bearerToken: "owner-control-secret",
      store,
      enrollmentRegistry: registry,
      runControlStore,
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not bind a TCP address");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const jsonHeaders = (credential: string) => ({
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
    });

    const created = await fetch(`${origin}/v1/runs`, {
      method: "POST",
      headers: jsonHeaders("owner-control-secret"),
      body: JSON.stringify({
        runId: "run-remote",
        executorNodeId: "node-workstation",
      }),
    });
    const running = await fetch(`${origin}/v1/runs/run-remote/events`, {
      method: "POST",
      headers: jsonHeaders(executorGrant.credential),
      body: JSON.stringify({
        authorityEpoch: 1,
        sequence: 1,
        eventId: "event-running",
        event: { type: "status", status: "running" },
      }),
    });
    const observed = await fetch(
      `${origin}/v1/runs/run-remote/control?after=0`,
      { headers: jsonHeaders(controllerGrant.credential) },
    );
    const steered = await fetch(`${origin}/v1/runs/run-remote/commands`, {
      method: "POST",
      headers: jsonHeaders(controllerGrant.credential),
      body: JSON.stringify({
        commandId: "command-phone",
        authorityEpoch: 1,
        command: { type: "steer", text: "Run the focused test first" },
      }),
    });
    const commands = await fetch(
      `${origin}/v1/runs/run-remote/commands?after=0`,
      { headers: jsonHeaders(executorGrant.credential) },
    );
    const forbiddenCommandPoll = await fetch(
      `${origin}/v1/runs/run-remote/commands?after=0`,
      { headers: jsonHeaders(controllerGrant.credential) },
    );
    const forbiddenTransfer = await fetch(
      `${origin}/v1/runs/run-remote/authority`,
      {
        method: "POST",
        headers: jsonHeaders(controllerGrant.credential),
        body: JSON.stringify({
          expectedAuthorityEpoch: 1,
          targetExecutorNodeId: "node-phone",
          reason: "handoff",
        }),
      },
    );
    const forbiddenWorkspaceAuthority = await fetch(
      `${origin}/v1/runs/run-remote/workspace`,
      {
        method: "POST",
        headers: jsonHeaders(controllerGrant.credential),
        body: JSON.stringify({
          workspaceId: "workspace-code",
          policy: "ask",
        }),
      },
    );
    const transferred = await fetch(`${origin}/v1/runs/run-remote/authority`, {
      method: "POST",
      headers: jsonHeaders("owner-control-secret"),
      body: JSON.stringify({
        expectedAuthorityEpoch: 1,
        targetExecutorNodeId: "node-fallback",
        reason: "fallback",
      }),
    });
    const fallbackSteering = await fetch(
      `${origin}/v1/runs/run-remote/commands`,
      {
        method: "POST",
        headers: jsonHeaders(controllerGrant.credential),
        body: JSON.stringify({
          commandId: "command-fallback",
          authorityEpoch: 2,
          command: { type: "steer", text: "Continue from durable state" },
        }),
      },
    );
    const fallbackCommands = await fetch(
      `${origin}/v1/runs/run-remote/commands?after=0`,
      { headers: jsonHeaders(fallbackGrant.credential) },
    );
    const staleExecutor = await fetch(`${origin}/v1/runs/run-remote/events`, {
      method: "POST",
      headers: jsonHeaders(executorGrant.credential),
      body: JSON.stringify({
        authorityEpoch: 1,
        sequence: 3,
        eventId: "event-stale",
        event: { type: "status", status: "completed" },
      }),
    });

    expect(created.status).toBe(201);
    expect(running.status).toBe(202);
    expect(observed.status).toBe(200);
    expect(await observed.json()).toMatchObject({
      runId: "run-remote",
      executorNodeId: "node-workstation",
      authorityEpoch: 1,
      status: "running",
      cursor: 1,
    });
    expect(steered.status).toBe(202);
    expect(commands.status).toBe(200);
    expect(await commands.json()).toMatchObject({
      commands: [
        {
          commandId: "command-phone",
          command: { type: "steer", text: "Run the focused test first" },
        },
      ],
    });
    expect(forbiddenCommandPoll.status).toBe(403);
    expect(forbiddenTransfer.status).toBe(401);
    expect(forbiddenWorkspaceAuthority.status).toBe(401);
    expect(transferred.status).toBe(202);
    expect(fallbackSteering.status).toBe(202);
    expect(fallbackCommands.status).toBe(200);
    expect(await fallbackCommands.json()).toEqual({
      cursor: 2,
      commands: [
        {
          realmId: "realm-personal",
          runId: "run-remote",
          commandId: "command-fallback",
          authorityEpoch: 2,
          command: { type: "steer", text: "Continue from durable state" },
          commandSequence: 2,
        },
      ],
    });
    expect(staleExecutor.status).toBe(409);
  });

  test("recovers a temporarily unavailable Workspace through durable authority transfers", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "llame-workspace-recovery-api-"),
    );
    temporaryDirectories.push(directory);
    const store = new SqlitePersonalRealmStore({
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { home: 1 },
    });
    const runControlStore = new SqliteRunControlStore({
      databasePath: join(directory, "runs.sqlite"),
      realmId: "realm-personal",
    });
    stores.push(store);
    runControlStores.push(runControlStore);
    const server = createPersonalNodeServer({
      nodeId: "node-home",
      bearerToken: "owner-control-secret",
      store,
      runControlStore,
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not bind a TCP address");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = {
      authorization: "Bearer owner-control-secret",
      "content-type": "application/json",
    };
    await fetch(`${origin}/v1/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        runId: "run-workspace",
        executorNodeId: "node-workstation",
      }),
    });

    const attached = await fetch(`${origin}/v1/runs/run-workspace/workspace`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: "workspace-code",
        policy: "fallback",
      }),
    });
    const unavailable = await fetch(
      `${origin}/v1/runs/run-workspace/workspace/unavailable`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          executorNodeId: "node-workstation",
          continuationExecutorNodeId: "node-home",
          egressAllowsFallback: true,
        }),
      },
    );
    const fallbackState = await fetch(
      `${origin}/v1/runs/run-workspace/workspace`,
      { headers },
    );
    const recovered = await fetch(
      `${origin}/v1/runs/run-workspace/workspace/recovered`,
      { method: "POST", headers, body: "{}" },
    );
    const runState = await fetch(
      `${origin}/v1/runs/run-workspace/control?after=0`,
      { headers },
    );

    expect(attached.status).toBe(201);
    expect(unavailable.status).toBe(202);
    expect(await unavailable.json()).toMatchObject({
      state: {
        mode: "temporary-fallback",
        activeExecutorNodeId: "node-home",
        authorityEpoch: 2,
        workspaceAttached: false,
      },
    });
    expect(fallbackState.status).toBe(200);
    expect(await fallbackState.json()).toMatchObject({
      mode: "temporary-fallback",
      preferredExecutorAvailable: false,
    });
    expect(recovered.status).toBe(202);
    expect(await recovered.json()).toMatchObject({
      state: {
        mode: "attached",
        activeExecutorNodeId: "node-workstation",
        authorityEpoch: 3,
        workspaceAttached: true,
      },
    });
    expect(await runState.json()).toMatchObject({
      executorNodeId: "node-workstation",
      authorityEpoch: 3,
      cursor: 2,
    });
  });
});
