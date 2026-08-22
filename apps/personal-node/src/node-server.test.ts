import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createPersonalNodeServer } from "./node-server.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";

describe("personal Node Protocol server", () => {
  const temporaryDirectories: string[] = [];
  const servers: Server[] = [];
  const stores: SqlitePersonalRealmStore[] = [];

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
});
