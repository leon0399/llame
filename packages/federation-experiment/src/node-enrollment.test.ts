import { describe, expect, test } from "vitest";

import { generateWriterIdentity } from "./batch-signature.js";
import {
  createEnrollmentChallenge,
  createEnrollmentProof,
  verifyEnrollmentProof,
} from "./node-enrollment.js";

describe("cryptographic node enrollment proof", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");

  test("binds a node identity to one Realm and short-lived challenge", () => {
    const node = generateWriterIdentity();
    const challenge = createEnrollmentChallenge({
      realmId: "realm-personal",
      nodeId: "node-desktop",
      now,
      nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      lifetimeMs: 60_000,
    });
    const proof = createEnrollmentProof(challenge, node.privateKeyPem);

    expect(
      verifyEnrollmentProof(proof, {
        expectedRealmId: "realm-personal",
        now: new Date(now.getTime() + 30_000),
      }),
    ).toEqual({
      realmId: "realm-personal",
      nodeId: "node-desktop",
      nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      expiresAt: "2026-08-22T12:01:00.000Z",
      keyId: node.keyId,
      publicKeyPem: node.publicKeyPem,
    });
  });

  test("rejects an expired challenge even when its signature is valid", () => {
    const node = generateWriterIdentity();
    const proof = createEnrollmentProof(
      createEnrollmentChallenge({
        realmId: "realm-personal",
        nodeId: "node-desktop",
        now,
        nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        lifetimeMs: 60_000,
      }),
      node.privateKeyPem,
    );

    expect(() =>
      verifyEnrollmentProof(proof, {
        expectedRealmId: "realm-personal",
        now: new Date(now.getTime() + 60_001),
      }),
    ).toThrowError("enrollment challenge expired");
  });

  test("rejects cross-Realm replay and node-id tampering", () => {
    const node = generateWriterIdentity();
    const proof = createEnrollmentProof(
      createEnrollmentChallenge({
        realmId: "realm-personal",
        nodeId: "node-desktop",
        now,
        nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        lifetimeMs: 60_000,
      }),
      node.privateKeyPem,
    );

    expect(() =>
      verifyEnrollmentProof(proof, {
        expectedRealmId: "realm-work",
        now,
      }),
    ).toThrowError("enrollment Realm mismatch");
    expect(() =>
      verifyEnrollmentProof(
        {
          ...proof,
          challenge: { ...proof.challenge, nodeId: "node-forged" },
        },
        { expectedRealmId: "realm-personal", now },
      ),
    ).toThrowError("invalid enrollment proof signature");
  });
});
