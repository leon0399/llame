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
    executor.appendStatus({
      runId: "run-1",
      eventId: "event-running",
      status: "running",
    });
    controller.steer({
      runId: "run-1",
      commandId: "command-controller",
      text: "Run focused tests",
    });
    controller.transferTo({
      runId: "run-1",
      targetExecutorNodeId: "node-laptop",
      reason: "handoff",
    });
    controller.attachWorkspace({
      runId: "run-1",
      workspaceId: "workspace-code",
      policy: "ask",
    });
    controller.workspaceExecutorUnavailable({
      runId: "run-1",
      executorNodeId: "node-laptop",
      continuationExecutorNodeId: "node-home",
      egressAllowsFallback: true,
    });
    controller.chooseWorkspaceRecovery({
      runId: "run-1",
      action: "fallback",
      continuationExecutorNodeId: "node-home",
      egressAllowsFallback: true,
    });
    controller.workspaceExecutorRecovered({ runId: "run-1" });
    controller.exitWorkspace({ runId: "run-1" });

    expect(store.frontier()).toEqual({ controller: 8, executor: 1 });
    expect(store.runSnapshot("run-1")).toMatchObject({
      executorNodeId: "node-laptop",
      authorityEpoch: 4,
      status: "running",
      cursor: 4,
    });
    expect(store.workspaceRecoveryState("run-1")).toMatchObject({
      workspaceId: "workspace-code",
      mode: "exited",
      workspaceAttached: false,
      activeExecutorNodeId: "node-laptop",
      authorityEpoch: 4,
    });
    expect(store.exportSignedMissing({})).toHaveLength(9);
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
