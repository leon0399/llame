import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { messageBatch } from "@workspace/federation-experiment";
import { afterEach, describe, expect, test } from "vitest";

import { createPersonalNodeServer } from "./node-server.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";
import { syncFromPeer } from "./sync-client.js";

describe("personal Node peer synchronization", () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  });

  test("refuses to send a peer credential over remote plaintext HTTP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-peer-sync-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const local = new SqlitePersonalRealmStore({
      databasePath: join(directory, "local.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    cleanup.push(() => local.close());

    await expect(
      syncFromPeer({
        store: local,
        peerUrl: "http://personal.example.test",
        bearerToken: "source-node-secret",
      }),
    ).rejects.toThrowError("plaintext peer URL must use a loopback host");
  });

  test("reconciles missing batches with an authenticated peer into durable state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-peer-sync-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const source = new SqlitePersonalRealmStore({
      databasePath: join(directory, "source.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    const target = new SqlitePersonalRealmStore({
      databasePath: join(directory, "target.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    cleanup.push(
      () => target.close(),
      () => source.close(),
    );
    source.receive(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-root",
        parentMessageId: null,
        text: "Pulled from peer",
      }),
    );
    const server = createPersonalNodeServer({
      nodeId: "node-source",
      bearerToken: "source-node-secret",
      store: source,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        }),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test peer did not bind a TCP address");
    }

    const result = await syncFromPeer({
      store: target,
      peerUrl: `http://127.0.0.1:${address.port}`,
      bearerToken: "source-node-secret",
    });

    expect(result).toEqual({
      pulled: 1,
      pushed: 0,
      localFrontier: { desktop: 1 },
      peerFrontier: { desktop: 1 },
      coverage: "verified-complete",
    });
    expect(target.chatBranches("chat-1")).toHaveLength(1);
  });

  test("pushes local offline work while pulling concurrent peer work", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-peer-sync-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const storeOptions = {
      realmId: "realm-personal",
      writerEpochs: { desktop: 1, phone: 1 },
    } as const;
    const peer = new SqlitePersonalRealmStore({
      ...storeOptions,
      databasePath: join(directory, "peer.sqlite"),
    });
    const local = new SqlitePersonalRealmStore({
      ...storeOptions,
      databasePath: join(directory, "local.sqlite"),
    });
    cleanup.push(
      () => local.close(),
      () => peer.close(),
    );
    peer.receive(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-desktop",
        parentMessageId: null,
        text: "Desktop continuation",
      }),
    );
    local.receive(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "phone",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-phone",
        parentMessageId: null,
        text: "Phone continuation",
      }),
    );
    const server = createPersonalNodeServer({
      nodeId: "node-peer",
      bearerToken: "source-node-secret",
      store: peer,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        }),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test peer did not bind a TCP address");
    }

    const result = await syncFromPeer({
      store: local,
      peerUrl: `http://127.0.0.1:${address.port}`,
      bearerToken: "source-node-secret",
    });

    expect(result).toEqual({
      pulled: 1,
      pushed: 1,
      localFrontier: { phone: 1, desktop: 1 },
      peerFrontier: { desktop: 1, phone: 1 },
      coverage: "verified-complete",
    });
    expect(local.chatBranches("chat-1")).toHaveLength(2);
    expect(peer.chatBranches("chat-1")).toHaveLength(2);
  });
});
