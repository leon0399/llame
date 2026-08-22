import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEnrollmentProof } from "@workspace/federation-experiment/node-enrollment";
import { generateWriterIdentity } from "@workspace/federation-experiment/batch-signature";
import { afterEach, describe, expect, test } from "vitest";

import { SqliteEnrollmentRegistry } from "./enrollment-registry.js";
import { createPersonalNodeServer } from "./node-server.js";
import { SignedRealmRunAuthor } from "./realm-run-author.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";

describe("journal-backed Run-control API", () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  });

  test("authors owner mutations locally but refuses to impersonate an enrolled controller", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-journal-runs-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const databasePath = join(directory, "realm.sqlite");
    const writer = generateWriterIdentity();
    const store = new SqlitePersonalRealmStore({
      databasePath,
      realmId: "realm-personal",
      writerEpochs: { controller: 1 },
      trustedWriterKeys: { "controller:1": writer.publicKeyPem },
      runControlGrants: {
        controller: { scopes: ["run.control", "run.steer"] },
      },
    });
    const registry = new SqliteEnrollmentRegistry({
      databasePath,
      realmId: "realm-personal",
    });
    cleanup.push(
      () => registry.close(),
      () => store.close(),
    );
    const remoteController = generateWriterIdentity();
    const remoteGrant = registry.completeEnrollment(
      createEnrollmentProof(
        registry.issueChallenge({ nodeId: "node-phone" }),
        remoteController.privateKeyPem,
      ),
      new Date(),
      ["run.observe", "run.steer"],
    );
    const server = createPersonalNodeServer({
      nodeId: "node-controller",
      bearerToken: "owner-control-secret",
      store,
      enrollmentRegistry: registry,
      journalRunAuthor: new SignedRealmRunAuthor({
        store,
        writerStreamId: "controller",
        writerEpoch: 1,
        privateKeyPem: writer.privateKeyPem,
      }),
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
      throw new Error("test server did not bind");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = (token: string) => ({
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    });

    const created = await fetch(`${origin}/v1/runs`, {
      method: "POST",
      headers: headers("owner-control-secret"),
      body: JSON.stringify({
        runId: "run-1",
        executorNodeId: "node-workstation",
      }),
    });
    const forbiddenRemoteSteer = await fetch(
      `${origin}/v1/runs/run-1/commands`,
      {
        method: "POST",
        headers: headers(remoteGrant.credential),
        body: JSON.stringify({
          commandId: "command-remote",
          authorityEpoch: 1,
          command: { type: "steer", text: "Do not impersonate me" },
        }),
      },
    );
    const steered = await fetch(`${origin}/v1/runs/run-1/commands`, {
      method: "POST",
      headers: headers("owner-control-secret"),
      body: JSON.stringify({
        commandId: "command-local",
        authorityEpoch: 1,
        command: { type: "steer", text: "Signed locally" },
      }),
    });
    const transferred = await fetch(`${origin}/v1/runs/run-1/authority`, {
      method: "POST",
      headers: headers("owner-control-secret"),
      body: JSON.stringify({
        expectedAuthorityEpoch: 1,
        targetExecutorNodeId: "node-laptop",
        reason: "handoff",
      }),
    });
    const observed = await fetch(`${origin}/v1/runs/run-1/control?after=0`, {
      headers: headers(remoteGrant.credential),
    });

    expect(created.status).toBe(201);
    expect(forbiddenRemoteSteer.status).toBe(403);
    expect(await forbiddenRemoteSteer.json()).toEqual({
      error: "local_writer_authority_required",
    });
    expect(steered.status).toBe(202);
    expect(transferred.status).toBe(202);
    expect(observed.status).toBe(200);
    expect(await observed.json()).toMatchObject({
      runId: "run-1",
      executorNodeId: "node-laptop",
      authorityEpoch: 2,
      status: "queued",
    });
    expect(store.exportSignedMissing({})).toHaveLength(3);
  });
});
