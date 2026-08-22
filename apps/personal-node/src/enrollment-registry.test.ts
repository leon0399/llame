import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateWriterIdentity } from "@workspace/federation-experiment/batch-signature";
import { createEnrollmentProof } from "@workspace/federation-experiment/node-enrollment";
import { afterEach, describe, expect, test } from "vitest";

import { SqliteEnrollmentRegistry } from "./enrollment-registry.js";

describe("durable node enrollment registry", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("consumes a Realm-bound challenge exactly once and preserves revocation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-enrollment-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "enrollment.sqlite");
    const now = new Date("2026-08-22T12:00:00.000Z");
    const node = generateWriterIdentity();
    const registry = new SqliteEnrollmentRegistry({
      databasePath,
      realmId: "realm-personal",
    });
    const challenge = registry.issueChallenge({
      nodeId: "node-desktop",
      now,
    });
    const proof = createEnrollmentProof(challenge, node.privateKeyPem);

    const grant = registry.completeEnrollment(
      proof,
      new Date(now.getTime() + 1_000),
      ["run.steer", "run.observe"],
    );

    expect(grant).toMatchObject({
      nodeId: "node-desktop",
      keyId: node.keyId,
      enrolledAt: "2026-08-22T12:00:01.000Z",
      revokedAt: null,
      scopes: ["run.observe", "run.steer"],
    });
    expect(grant.credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(() =>
      registry.completeEnrollment(proof, new Date(now.getTime() + 2_000)),
    ).toThrowError("enrollment challenge was already consumed");
    expect(registry.isActive("node-desktop", node.keyId)).toBe(true);
    expect(registry.authenticate(grant.credential)).toMatchObject({
      nodeId: "node-desktop",
      keyId: node.keyId,
      scopes: ["run.observe", "run.steer"],
    });
    expect(registry.authenticate("wrong-credential")).toBeNull();
    expect(
      registry.revoke("node-desktop", new Date(now.getTime() + 3_000)),
    ).toBe(true);
    expect(registry.isActive("node-desktop", node.keyId)).toBe(false);
    expect(registry.authenticate(grant.credential)).toBeNull();
    registry.close();

    const reopened = new SqliteEnrollmentRegistry({
      databasePath,
      realmId: "realm-personal",
    });
    expect(reopened.isActive("node-desktop", node.keyId)).toBe(false);
    reopened.close();
  });

  test("does not consume a challenge when a proof targets another Realm", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-enrollment-"));
    temporaryDirectories.push(directory);
    const now = new Date("2026-08-22T12:00:00.000Z");
    const node = generateWriterIdentity();
    const registry = new SqliteEnrollmentRegistry({
      databasePath: join(directory, "enrollment.sqlite"),
      realmId: "realm-personal",
    });
    const challenge = registry.issueChallenge({
      nodeId: "node-desktop",
      now,
    });
    const crossRealmProof = createEnrollmentProof(
      { ...challenge, realmId: "realm-work" },
      node.privateKeyPem,
    );

    expect(() =>
      registry.completeEnrollment(
        crossRealmProof,
        new Date(now.getTime() + 1_000),
      ),
    ).toThrowError("enrollment Realm mismatch");
    expect(
      registry.completeEnrollment(
        createEnrollmentProof(challenge, node.privateKeyPem),
        new Date(now.getTime() + 2_000),
      ),
    ).toMatchObject({ nodeId: "node-desktop" });
    registry.close();
  });
});
