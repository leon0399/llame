import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateWriterIdentity } from "@workspace/federation-experiment/batch-signature";
import { afterEach, describe, expect, test } from "vitest";

import { enrollWithPeer } from "./enrollment-client.js";
import { SqliteEnrollmentRegistry } from "./enrollment-registry.js";
import { createPersonalNodeServer } from "./node-server.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";

describe("peer node enrollment client", () => {
  const temporaryDirectories: string[] = [];
  const servers: Server[] = [];
  const stores: SqlitePersonalRealmStore[] = [];
  const registries: SqliteEnrollmentRegistry[] = [];

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
    for (const registry of registries.splice(0)) registry.close();
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("proves a local node key and receives a revocable credential", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-enroll-client-"));
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
    stores.push(store);
    registries.push(registry);
    const server = createPersonalNodeServer({
      nodeId: "home",
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
    const node = generateWriterIdentity();

    const grant = await enrollWithPeer({
      peerUrl: `http://127.0.0.1:${address.port}`,
      ownerBearerToken: "owner-control-secret",
      nodeId: "desktop",
      realmId: "realm-personal",
      privateKeyPem: node.privateKeyPem,
    });

    expect(grant).toMatchObject({
      nodeId: "desktop",
      keyId: node.keyId,
      revokedAt: null,
    });
    expect(registry.authenticate(grant.credential)).toMatchObject({
      nodeId: "desktop",
      keyId: node.keyId,
    });
    expect(grant).not.toHaveProperty("userId");
  });
});
