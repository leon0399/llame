import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";

import { z } from "zod";

import { parseChangeBatch, type ChangeBatch } from "./reconciliation.js";

const SIGNATURE_DOMAIN = "llame.change-batch.signature.v1\0";

const signatureSchema = z.strictObject({
  algorithm: z.literal("Ed25519"),
  keyId: z.string().min(1),
  value: z.string().regex(/^[A-Za-z0-9_-]+$/),
});
const signedChangeBatchSchema = z.strictObject({
  batch: z.unknown(),
  signature: signatureSchema,
});

export interface WriterIdentity {
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
}

export interface SignedChangeBatch {
  readonly batch: ChangeBatch;
  readonly signature: {
    readonly algorithm: "Ed25519";
    readonly keyId: string;
    readonly value: string;
  };
}

function publicKeyId(publicKeyPem: string): string {
  const publicKey = createPublicKey(publicKeyPem);
  const spki = publicKey.export({ format: "der", type: "spki" });
  return createHash("sha256").update(spki).digest("base64url");
}

function signaturePayload(batch: ChangeBatch): Buffer {
  const canonical = {
    realmId: batch.realmId,
    writerStreamId: batch.writerStreamId,
    writerEpoch: batch.writerEpoch,
    sequence: batch.sequence,
    dependencies: [...batch.dependencies],
    operations: batch.operations.map((operation) =>
      operation.type === "append-message"
        ? {
            type: operation.type,
            chatId: operation.chatId,
            messageId: operation.messageId,
            parentMessageId: operation.parentMessageId,
            text: operation.text,
          }
        : { type: operation.type },
    ),
  };
  return Buffer.from(`${SIGNATURE_DOMAIN}${JSON.stringify(canonical)}`, "utf8");
}

export function generateWriterIdentity(): WriterIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ format: "pem", type: "spki" })
    .toString();
  return {
    keyId: publicKeyId(publicKeyPem),
    publicKeyPem,
    privateKeyPem: privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
  };
}

export function signChangeBatch(
  input: ChangeBatch,
  privateKeyPem: string,
): SignedChangeBatch {
  const batch = parseChangeBatch(input);
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKeyPem = createPublicKey(privateKey)
    .export({ format: "pem", type: "spki" })
    .toString();
  return {
    batch,
    signature: {
      algorithm: "Ed25519",
      keyId: publicKeyId(publicKeyPem),
      value: sign(null, signaturePayload(batch), privateKey).toString(
        "base64url",
      ),
    },
  };
}

export function parseSignedChangeBatch(input: unknown): SignedChangeBatch {
  const parsed = signedChangeBatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("invalid SignedChangeBatch", { cause: parsed.error });
  }
  return {
    batch: parseChangeBatch(parsed.data.batch),
    signature: parsed.data.signature,
  };
}

export function verifySignedChangeBatch(
  input: unknown,
  trustedPublicKeys: Readonly<Record<string, string>>,
): ChangeBatch {
  const parsed = parseSignedChangeBatch(input);
  const batch = parsed.batch;
  const publicKeyPem =
    trustedPublicKeys[`${batch.writerStreamId}:${batch.writerEpoch}`];
  if (publicKeyPem === undefined) {
    throw new Error("writer stream has no trusted signing key");
  }
  if (publicKeyId(publicKeyPem) !== parsed.signature.keyId) {
    throw new Error("signature key is not authorized for writer stream");
  }
  const valid = verify(
    null,
    signaturePayload(batch),
    createPublicKey(publicKeyPem),
    Buffer.from(parsed.signature.value, "base64url"),
  );
  if (!valid) throw new Error("invalid ChangeBatch signature");
  return batch;
}
