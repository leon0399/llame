import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { generateWriterIdentity } from "@workspace/federation-experiment/batch-signature";

import {
  appendLocalMessage,
  appendSignedLocalMessage,
} from "./local-authoring.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";

describe("local offline authoring", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("appends on the local writer stream with the current causal frontier", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-personal-node-"));
    temporaryDirectories.push(directory);
    const store = new SqlitePersonalRealmStore({
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1, phone: 1 },
    });
    store.receive({
      realmId: "realm-personal",
      writerStreamId: "phone",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      operations: [
        {
          type: "append-message",
          chatId: "chat-1",
          messageId: "message-phone",
          parentMessageId: null,
          text: "Created on phone",
        },
      ],
    });

    const result = appendLocalMessage({
      store,
      writerStreamId: "desktop",
      writerEpoch: 1,
      chatId: "chat-1",
      messageId: "message-desktop",
      parentMessageId: "message-phone",
      text: "Continued offline",
    });

    expect(result).toEqual({
      messageId: "message-desktop",
      batchRef: "desktop:1",
      frontier: { phone: 1, desktop: 1 },
    });
    expect(store.exportMissing({ phone: 1 })).toEqual([
      expect.objectContaining({
        writerStreamId: "desktop",
        sequence: 1,
        dependencies: ["phone:1"],
      }),
    ]);
    store.close();
  });

  test("signs an offline append with the local writer identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-personal-node-"));
    temporaryDirectories.push(directory);
    const desktop = generateWriterIdentity();
    const store = new SqlitePersonalRealmStore({
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
      trustedWriterKeys: { "desktop:1": desktop.publicKeyPem },
    });

    const result = appendSignedLocalMessage({
      store,
      writerStreamId: "desktop",
      writerEpoch: 1,
      privateKeyPem: desktop.privateKeyPem,
      chatId: "chat-signed",
      messageId: "message-signed",
      parentMessageId: null,
      text: "Signed offline",
    });

    expect(result.batchRef).toBe("desktop:1");
    expect(store.exportSignedMissing({})).toEqual([
      expect.objectContaining({
        batch: expect.objectContaining({ writerStreamId: "desktop" }),
        signature: expect.objectContaining({
          algorithm: "Ed25519",
          keyId: desktop.keyId,
        }),
      }),
    ]);
    store.close();
  });
});
