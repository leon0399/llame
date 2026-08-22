import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from "node:crypto";

import { z } from "zod";

import { keyIdForPublicKey } from "./batch-signature.js";
import { WRITER_STREAM_ID_PATTERN } from "./reconciliation.js";

const ENROLLMENT_DOMAIN = "llame.node-enrollment-proof.v1\0";
const MAX_CHALLENGE_LIFETIME_MS = 5 * 60_000;
const nodeScopeSchema = z.enum([
  "realm.sync",
  "run.observe",
  "run.steer",
  "run.execute",
  "run.control",
]);

const enrollmentChallengeSchema = z.strictObject({
  version: z.literal(1),
  realmId: z.string().min(1),
  nodeId: z.string().regex(WRITER_STREAM_ID_PATTERN),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.string().datetime({ offset: true }),
});
const enrollmentProofSchema = z.strictObject({
  challenge: enrollmentChallengeSchema,
  publicKeyPem: z.string().min(1),
  signature: z.strictObject({
    algorithm: z.literal("Ed25519"),
    keyId: z.string().min(1),
    value: z.string().regex(/^[A-Za-z0-9_-]+$/),
  }),
});

export type EnrollmentChallenge = z.infer<typeof enrollmentChallengeSchema>;
export type EnrollmentProof = z.infer<typeof enrollmentProofSchema>;
export type NodeScope = z.infer<typeof nodeScopeSchema>;

export interface CreateEnrollmentChallengeOptions {
  readonly realmId: string;
  readonly nodeId: string;
  readonly lifetimeMs: number;
  readonly now?: Date;
  readonly nonce?: string;
}

export interface VerifiedEnrollment {
  readonly realmId: string;
  readonly nodeId: string;
  readonly nonce: string;
  readonly expiresAt: string;
  readonly keyId: string;
  readonly publicKeyPem: string;
}

export function parseNodeScopes(input: unknown): readonly NodeScope[] {
  const parsed = z.array(nodeScopeSchema).min(1).max(5).safeParse(input);
  if (!parsed.success) {
    throw new Error("invalid node enrollment scopes", { cause: parsed.error });
  }
  return [...new Set(parsed.data)].sort();
}

function proofPayload(challenge: EnrollmentChallenge): Buffer {
  return Buffer.from(
    `${ENROLLMENT_DOMAIN}${JSON.stringify({
      version: challenge.version,
      realmId: challenge.realmId,
      nodeId: challenge.nodeId,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
    })}`,
    "utf8",
  );
}

export function createEnrollmentChallenge(
  options: CreateEnrollmentChallengeOptions,
): EnrollmentChallenge {
  if (
    !Number.isInteger(options.lifetimeMs) ||
    options.lifetimeMs <= 0 ||
    options.lifetimeMs > MAX_CHALLENGE_LIFETIME_MS
  ) {
    throw new Error("enrollment challenge lifetime must be 1ms to 5 minutes");
  }
  return enrollmentChallengeSchema.parse({
    version: 1,
    realmId: options.realmId,
    nodeId: options.nodeId,
    nonce: options.nonce ?? randomBytes(32).toString("base64url"),
    expiresAt: new Date(
      (options.now ?? new Date()).getTime() + options.lifetimeMs,
    ).toISOString(),
  });
}

export function createEnrollmentProof(
  challengeInput: unknown,
  privateKeyPem: string,
): EnrollmentProof {
  const challenge = enrollmentChallengeSchema.parse(challengeInput);
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKeyPem = createPublicKey(privateKey)
    .export({ format: "pem", type: "spki" })
    .toString();
  return {
    challenge,
    publicKeyPem,
    signature: {
      algorithm: "Ed25519",
      keyId: keyIdForPublicKey(publicKeyPem),
      value: sign(null, proofPayload(challenge), privateKey).toString(
        "base64url",
      ),
    },
  };
}

export function verifyEnrollmentProof(
  input: unknown,
  options: { readonly expectedRealmId: string; readonly now?: Date },
): VerifiedEnrollment {
  const parsed = enrollmentProofSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("invalid enrollment proof", { cause: parsed.error });
  }
  const proof = parsed.data;
  if (proof.challenge.realmId !== options.expectedRealmId) {
    throw new Error("enrollment Realm mismatch");
  }
  if (
    Date.parse(proof.challenge.expiresAt) <=
    (options.now ?? new Date()).getTime()
  ) {
    throw new Error("enrollment challenge expired");
  }
  if (keyIdForPublicKey(proof.publicKeyPem) !== proof.signature.keyId) {
    throw new Error("enrollment proof key id mismatch");
  }
  const valid = verify(
    null,
    proofPayload(proof.challenge),
    createPublicKey(proof.publicKeyPem),
    Buffer.from(proof.signature.value, "base64url"),
  );
  if (!valid) throw new Error("invalid enrollment proof signature");
  return {
    realmId: proof.challenge.realmId,
    nodeId: proof.challenge.nodeId,
    nonce: proof.challenge.nonce,
    expiresAt: proof.challenge.expiresAt,
    keyId: proof.signature.keyId,
    publicKeyPem: proof.publicKeyPem,
  };
}
