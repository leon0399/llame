import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { messageBatch } from "@workspace/federation-experiment";
import {
  generateWriterIdentity,
  signChangeBatch,
} from "@workspace/federation-experiment/batch-signature";
import { afterEach, describe, expect, test } from "vitest";

import { createPersonalNodeServer } from "./node-server.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";
import { PeerSyncOutcomeUnknownError, syncFromPeer } from "./sync-client.js";

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

  test("reconciles durable signed envelopes without trusting the peer token as writer identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-signed-sync-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
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
    cleanup.push(
      () => target.close(),
      () => source.close(),
    );
    const signed = signChangeBatch(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-signed",
        messageId: "message-signed",
        parentMessageId: null,
        text: "Signed on desktop",
      }),
      desktop.privateKeyPem,
    );
    source.receiveSigned(signed);
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
      mode: "signed",
    });

    expect(result.coverage).toBe("verified-complete");
    expect(target.exportSignedMissing({})).toEqual([signed]);
  });

  test("runs another round when the peer advances during reconciliation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-peer-sync-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const local = new SqlitePersonalRealmStore({
      databasePath: join(directory, "local.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    cleanup.push(() => local.close());
    const first = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      chatId: "chat-1",
      messageId: "message-root",
      parentMessageId: null,
      text: "First peer message",
    });
    const second = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 2,
      dependencies: ["desktop:1"],
      chatId: "chat-1",
      messageId: "message-second",
      parentMessageId: "message-root",
      text: "Arrived during synchronization",
    });
    let exportRequests = 0;
    const server = createServer((request, response) => {
      request.resume();
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/sync/export") {
        exportRequests += 1;
        response.end(
          JSON.stringify(
            exportRequests === 1
              ? { batches: [first], sourceFrontier: { desktop: 1 } }
              : { batches: [second], sourceFrontier: { desktop: 2 } },
          ),
        );
        return;
      }
      response.end(JSON.stringify({ applied: 0, frontier: { desktop: 2 } }));
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
      rounds: 2,
      outcomeUnknownRecoveries: 0,
      pulled: 2,
      pushed: 0,
      localFrontier: { desktop: 2 },
      peerFrontier: { desktop: 2 },
      coverage: "verified-complete",
    });
    expect(exportRequests).toBe(2);
  });

  test("recovers when the peer commits an apply before disconnecting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-peer-sync-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const local = new SqlitePersonalRealmStore({
      databasePath: join(directory, "local.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1, phone: 1 },
    });
    cleanup.push(() => local.close());
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
        text: "Offline phone message",
      }),
    );
    const remoteBatch = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      chatId: "chat-remote",
      messageId: "message-desktop",
      parentMessageId: null,
      text: "Concurrent desktop message",
    });
    let accepted = false;
    let exportRequests = 0;
    let applyRequests = 0;
    const server = createServer((request, response) => {
      request.resume();
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/sync/export") {
        exportRequests += 1;
        response.end(
          JSON.stringify({
            batches: exportRequests === 1 ? [remoteBatch] : [],
            sourceFrontier: accepted
              ? { desktop: 1, phone: 1 }
              : { desktop: 1 },
          }),
        );
        return;
      }
      applyRequests += 1;
      if (applyRequests === 1) {
        accepted = true;
        request.socket.destroy();
        return;
      }
      response.end(
        JSON.stringify({
          applied: 0,
          frontier: { desktop: 1, phone: 1 },
        }),
      );
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
      rounds: 2,
      outcomeUnknownRecoveries: 1,
      pulled: 1,
      pushed: 0,
      localFrontier: { phone: 1, desktop: 1 },
      peerFrontier: { desktop: 1, phone: 1 },
      coverage: "verified-complete",
    });
    expect(applyRequests).toBe(2);
  });

  test("surfaces outcome_unknown after bounded apply recovery is exhausted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-peer-sync-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const local = new SqlitePersonalRealmStore({
      databasePath: join(directory, "local.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { phone: 1 },
    });
    cleanup.push(() => local.close());
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
        text: "Offline phone message",
      }),
    );
    let applyRequests = 0;
    const server = createServer((request, response) => {
      request.resume();
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/sync/export") {
        response.end(JSON.stringify({ batches: [], sourceFrontier: {} }));
        return;
      }
      applyRequests += 1;
      request.socket.destroy();
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

    const sync = syncFromPeer({
      store: local,
      peerUrl: `http://127.0.0.1:${address.port}`,
      bearerToken: "source-node-secret",
    });

    await expect(sync).rejects.toMatchObject({
      name: "PeerSyncOutcomeUnknownError",
      rounds: 3,
      localFrontier: { phone: 1 },
    });
    await expect(sync).rejects.toBeInstanceOf(PeerSyncOutcomeUnknownError);
    expect(applyRequests).toBe(3);
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
      rounds: 1,
      outcomeUnknownRecoveries: 0,
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
      rounds: 1,
      outcomeUnknownRecoveries: 0,
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
