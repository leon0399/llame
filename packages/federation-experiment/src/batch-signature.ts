import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";

import { z } from "zod";

import {
  parseChangeBatch,
  type ChangeBatch,
  type SemanticOperation,
} from "./reconciliation.js";

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

export function keyIdForPublicKey(publicKeyPem: string): string {
  const publicKey = createPublicKey(publicKeyPem);
  const spki = publicKey.export({ format: "der", type: "spki" });
  return createHash("sha256").update(spki).digest("base64url");
}

function canonicalOperation(operation: SemanticOperation): unknown {
  if (operation.type === "append-message") {
    return {
      type: operation.type,
      chatId: operation.chatId,
      messageId: operation.messageId,
      parentMessageId: operation.parentMessageId,
      text: operation.text,
    };
  }
  if (operation.type === "create-run") {
    return {
      type: operation.type,
      runId: operation.runId,
      executorNodeId: operation.executorNodeId,
    };
  }
  if (operation.type === "append-run-event") {
    const semanticEvent =
      operation.event.event.type === "status"
        ? {
            type: operation.event.event.type,
            status: operation.event.event.status,
          }
        : operation.event.event.type === "assistant-output"
          ? {
              type: operation.event.event.type,
              messageId: operation.event.event.messageId,
              text: operation.event.event.text,
            }
          : {
              type: operation.event.event.type,
              previousExecutorNodeId:
                operation.event.event.previousExecutorNodeId,
              reason: operation.event.event.reason,
            };
    return {
      type: operation.type,
      event: {
        realmId: operation.event.realmId,
        runId: operation.event.runId,
        executorNodeId: operation.event.executorNodeId,
        authorityEpoch: operation.event.authorityEpoch,
        sequence: operation.event.sequence,
        eventId: operation.event.eventId,
        event: semanticEvent,
      },
    };
  }
  if (operation.type === "submit-run-command") {
    const command =
      operation.command.command.type === "steer"
        ? {
            type: operation.command.command.type,
            text: operation.command.command.text,
          }
        : { type: operation.command.command.type };
    return {
      type: operation.type,
      command: {
        realmId: operation.command.realmId,
        runId: operation.command.runId,
        commandId: operation.command.commandId,
        authorityEpoch: operation.command.authorityEpoch,
        command,
      },
    };
  }
  if (operation.type === "transfer-run-authority") {
    return {
      type: operation.type,
      runId: operation.runId,
      expectedAuthorityEpoch: operation.expectedAuthorityEpoch,
      targetExecutorNodeId: operation.targetExecutorNodeId,
      reason: operation.reason,
    };
  }
  if (operation.type === "attach-workspace") {
    return {
      type: operation.type,
      runId: operation.runId,
      workspaceId: operation.workspaceId,
      policy: operation.policy,
    };
  }
  if (operation.type === "workspace-executor-unavailable") {
    return {
      type: operation.type,
      runId: operation.runId,
      executorNodeId: operation.executorNodeId,
      continuationExecutorNodeId: operation.continuationExecutorNodeId,
      egressAllowsFallback: operation.egressAllowsFallback,
    };
  }
  if (operation.type === "choose-workspace-recovery") {
    return {
      type: operation.type,
      runId: operation.runId,
      action: operation.action,
      continuationExecutorNodeId: operation.continuationExecutorNodeId,
      egressAllowsFallback: operation.egressAllowsFallback,
    };
  }
  if (
    operation.type === "workspace-executor-recovered" ||
    operation.type === "exit-workspace"
  ) {
    return { type: operation.type, runId: operation.runId };
  }
  return { type: operation.type };
}

function signaturePayload(batch: ChangeBatch): Buffer {
  const canonical = {
    realmId: batch.realmId,
    writerStreamId: batch.writerStreamId,
    writerEpoch: batch.writerEpoch,
    sequence: batch.sequence,
    dependencies: [...batch.dependencies],
    operations: batch.operations.map(canonicalOperation),
  };
  return Buffer.from(`${SIGNATURE_DOMAIN}${JSON.stringify(canonical)}`, "utf8");
}

export function generateWriterIdentity(): WriterIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ format: "pem", type: "spki" })
    .toString();
  return {
    keyId: keyIdForPublicKey(publicKeyPem),
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
      keyId: keyIdForPublicKey(publicKeyPem),
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
  if (keyIdForPublicKey(publicKeyPem) !== parsed.signature.keyId) {
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
