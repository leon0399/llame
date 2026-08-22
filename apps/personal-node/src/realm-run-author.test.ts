import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateWriterIdentity } from "@workspace/federation-experiment/batch-signature";
import { afterEach, describe, expect, test } from "vitest";

import { SignedRealmRunAuthor } from "./realm-run-author.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";

describe("signed local Run authoring", () => {
  const directories: string[] = [];
  const stores: SqlitePersonalRealmStore[] = [];

  afterEach(async () => {
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  test("authors control semantics under distinct controller and executor writers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-run-author-"));
    directories.push(directory);
    const controllerIdentity = generateWriterIdentity();
    const executorIdentity = generateWriterIdentity();
    const store = new SqlitePersonalRealmStore({
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { controller: 1, executor: 1 },
      trustedWriterKeys: {
        "controller:1": controllerIdentity.publicKeyPem,
        "executor:1": executorIdentity.publicKeyPem,
      },
      runControlGrants: {
        controller: { scopes: ["run.control", "run.steer"] },
        executor: {
          scopes: ["run.execute"],
          executorNodeIds: ["node-workstation"],
        },
      },
    });
    stores.push(store);
    const controller = new SignedRealmRunAuthor({
      store,
      writerStreamId: "controller",
      writerEpoch: 1,
      privateKeyPem: controllerIdentity.privateKeyPem,
    });
    const executor = new SignedRealmRunAuthor({
      store,
      writerStreamId: "executor",
      writerEpoch: 1,
      privateKeyPem: executorIdentity.privateKeyPem,
    });

    controller.createRun({
      runId: "run-1",
      executorNodeId: "node-workstation",
    });
    executor.appendEvent({
      realmId: "realm-personal",
      runId: "run-1",
      executorNodeId: "node-workstation",
      authorityEpoch: 1,
      sequence: 1,
      eventId: "event-running",
      event: { type: "status", status: "running" },
    });
    controller.submitCommand({
      realmId: "realm-personal",
      runId: "run-1",
      commandId: "command-controller",
      authorityEpoch: 1,
      command: { type: "steer", text: "Run focused tests" },
    });
    controller.transferAuthority({
      runId: "run-1",
      expectedAuthorityEpoch: 1,
      targetExecutorNodeId: "node-laptop",
      reason: "handoff",
    });

    expect(store.frontier()).toEqual({ controller: 3, executor: 1 });
    expect(store.runSnapshot("run-1")).toMatchObject({
      executorNodeId: "node-laptop",
      authorityEpoch: 2,
      status: "running",
      cursor: 2,
    });
    expect(store.exportSignedMissing({})).toHaveLength(4);
    expect(store.runCommandsAfter("run-1", 0)).toEqual([
      expect.objectContaining({ commandId: "command-controller" }),
    ]);
  });

  test("rejects a private key that does not belong to the configured writer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-run-author-"));
    directories.push(directory);
    const trusted = generateWriterIdentity();
    const attacker = generateWriterIdentity();
    const store = new SqlitePersonalRealmStore({
      databasePath: join(directory, "realm.sqlite"),
      realmId: "realm-personal",
      writerEpochs: { controller: 1 },
      trustedWriterKeys: { "controller:1": trusted.publicKeyPem },
      runControlGrants: {
        controller: { scopes: ["run.control"] },
      },
    });
    stores.push(store);
    const author = new SignedRealmRunAuthor({
      store,
      writerStreamId: "controller",
      writerEpoch: 1,
      privateKeyPem: attacker.privateKeyPem,
    });

    expect(() =>
      author.createRun({
        runId: "run-forged",
        executorNodeId: "node-workstation",
      }),
    ).toThrowError("signature key is not authorized for writer stream");
    expect(store.frontier()).toEqual({});
  });
});
