import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { messageBatch } from "@workspace/federation-experiment";
import {
  generateWriterIdentity,
  signChangeBatch,
} from "@workspace/federation-experiment/batch-signature";
import { afterEach, describe, expect, test } from "vitest";

import { SqlitePersonalRealmStore } from "./sqlite-replica.js";

describe("SQLite personal Realm store", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("creates the local Realm database as owner-readable only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-personal-node-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "realm.sqlite");
    const store = new SqlitePersonalRealmStore({
      databasePath,
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    store.receive(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-root",
        parentMessageId: null,
        text: "Private local state",
      }),
    );

    expect((await stat(databasePath)).mode & 0o777).toBe(0o600);
    expect((await stat(`${databasePath}-wal`)).mode & 0o777).toBe(0o600);
    expect((await stat(`${databasePath}-shm`)).mode & 0o777).toBe(0o600);
    store.close();
  });

  test("reconstructs accepted batches and branches after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-personal-node-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "realm.sqlite");
    const options = {
      databasePath,
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    } as const;
    const root = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      chatId: "chat-1",
      messageId: "message-root",
      parentMessageId: null,
      text: "Durable root",
    });

    const first = new SqlitePersonalRealmStore(options);
    first.receive(root);
    first.close();

    const reopened = new SqlitePersonalRealmStore(options);
    expect(reopened.frontier()).toEqual({ desktop: 1 });
    expect(reopened.chatBranches("chat-1")).toEqual([
      {
        branchId: "message-root",
        headMessageId: "message-root",
        messageIds: ["message-root"],
      },
    ]);
    expect(reopened.exportMissing({})).toEqual([root]);
    reopened.close();
  });

  test("persists and forwards a verified writer signature after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-personal-node-"));
    temporaryDirectories.push(directory);
    const desktop = generateWriterIdentity();
    const options = {
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
      trustedWriterKeys: { "desktop:1": desktop.publicKeyPem },
    } as const;
    const signed = signChangeBatch(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-signed",
        parentMessageId: null,
        text: "Durably signed",
      }),
      desktop.privateKeyPem,
    );

    const first = new SqlitePersonalRealmStore(options);
    first.receiveSigned(signed);
    first.close();

    const reopened = new SqlitePersonalRealmStore(options);
    expect(reopened.exportSignedMissing({})).toEqual([signed]);
    expect(reopened.frontier()).toEqual({ desktop: 1 });
    reopened.close();
  });

  test("rejects a tampered signed batch without advancing durable state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-personal-node-"));
    temporaryDirectories.push(directory);
    const desktop = generateWriterIdentity();
    const store = new SqlitePersonalRealmStore({
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
      trustedWriterKeys: { "desktop:1": desktop.publicKeyPem },
    });
    const signed = signChangeBatch(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-signed",
        parentMessageId: null,
        text: "Original",
      }),
      desktop.privateKeyPem,
    );

    expect(() =>
      store.receiveSigned({
        ...signed,
        batch: {
          ...signed.batch,
          operations: [
            {
              type: "append-message",
              chatId: "chat-1",
              messageId: "message-signed",
              parentMessageId: null,
              text: "Tampered",
            },
          ],
        },
      }),
    ).toThrowError("invalid ChangeBatch signature");
    expect(store.frontier()).toEqual({});
    store.close();
  });

  test("persists a writer fence across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-personal-node-"));
    temporaryDirectories.push(directory);
    const options = {
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    } as const;
    const first = new SqlitePersonalRealmStore(options);
    first.receive(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-root",
        parentMessageId: null,
        text: "Root",
      }),
    );
    first.advanceWriterEpoch({
      writerStreamId: "desktop",
      expectedEpoch: 1,
      nextEpoch: 2,
    });
    first.close();

    const reopened = new SqlitePersonalRealmStore(options);
    expect(() =>
      reopened.receive(
        messageBatch({
          realmId: "realm-personal",
          writerStreamId: "desktop",
          writerEpoch: 1,
          sequence: 2,
          dependencies: ["desktop:1"],
          chatId: "chat-1",
          messageId: "message-stale",
          parentMessageId: "message-root",
          text: "Stale writer",
        }),
      ),
    ).toThrowError("writer is not authorized for this epoch");
    reopened.close();
  });

  test("serializes writers that opened the same database before either mutated it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-personal-node-"));
    temporaryDirectories.push(directory);
    const options = {
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    } as const;
    const first = new SqlitePersonalRealmStore(options);
    const staleSecond = new SqlitePersonalRealmStore(options);
    const accepted = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      chatId: "chat-1",
      messageId: "message-accepted",
      parentMessageId: null,
      text: "Accepted by the first process",
    });
    const conflicting = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      chatId: "chat-1",
      messageId: "message-conflicting",
      parentMessageId: null,
      text: "Stale second process",
    });

    first.receive(accepted);
    expect(() => staleSecond.receive(conflicting)).toThrowError(
      "batch reference reused with different payload",
    );
    first.close();
    staleSecond.close();

    const reopened = new SqlitePersonalRealmStore(options);
    expect(reopened.exportMissing({})).toEqual([accepted]);
    reopened.close();
  });
});
