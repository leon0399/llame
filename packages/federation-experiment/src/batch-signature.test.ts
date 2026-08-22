import { describe, expect, test } from "vitest";

import {
  generateWriterIdentity,
  signChangeBatch,
  verifySignedChangeBatch,
} from "./batch-signature.js";
import { messageBatch, parseChangeBatch } from "./reconciliation.js";

describe("signed federation batches", () => {
  test("verifies an immutable batch against its writer's trusted public key", () => {
    const desktop = generateWriterIdentity();
    const batch = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      chatId: "chat-1",
      messageId: "message-root",
      parentMessageId: null,
      text: "Signed on desktop",
    });

    const signed = signChangeBatch(batch, desktop.privateKeyPem);

    expect(
      verifySignedChangeBatch(signed, { "desktop:1": desktop.publicKeyPem }),
    ).toEqual(batch);
    expect(signed.signature).toMatchObject({
      algorithm: "Ed25519",
      keyId: desktop.keyId,
    });
  });

  test("rejects a batch whose signed content was modified in transit", () => {
    const desktop = generateWriterIdentity();
    const signed = signChangeBatch(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-root",
        parentMessageId: null,
        text: "Original text",
      }),
      desktop.privateKeyPem,
    );

    expect(() =>
      verifySignedChangeBatch(
        {
          ...signed,
          batch: {
            ...signed.batch,
            operations: [
              {
                type: "append-message",
                chatId: "chat-1",
                messageId: "message-root",
                parentMessageId: null,
                text: "Tampered text",
              },
            ],
          },
        },
        { "desktop:1": desktop.publicKeyPem },
      ),
    ).toThrowError("invalid ChangeBatch signature");
  });

  test("prevents one trusted writer from impersonating another writer stream", () => {
    const desktop = generateWriterIdentity();
    const phone = generateWriterIdentity();
    const forged = signChangeBatch(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-forged",
        parentMessageId: null,
        text: "Actually signed by phone",
      }),
      phone.privateKeyPem,
    );

    expect(() =>
      verifySignedChangeBatch(forged, {
        "desktop:1": desktop.publicKeyPem,
        "phone:1": phone.publicKeyPem,
      }),
    ).toThrowError("signature key is not authorized for writer stream");
  });

  test("binds signed Run operations to the writer envelope", () => {
    const identity = generateWriterIdentity();
    const signed = signChangeBatch(
      {
        realmId: "realm-personal",
        writerStreamId: "workstation",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        operations: [
          {
            type: "create-run",
            runId: "run-1",
            executorNodeId: "workstation",
          },
        ],
      },
      identity.privateKeyPem,
    );

    expect(
      verifySignedChangeBatch(signed, {
        "workstation:1": identity.publicKeyPem,
      }),
    ).toEqual(signed.batch);
    expect(() =>
      verifySignedChangeBatch(
        {
          ...signed,
          batch: {
            ...signed.batch,
            operations: [
              {
                type: "create-run",
                runId: "run-1",
                executorNodeId: "attacker",
              },
            ],
          },
        },
        { "workstation:1": identity.publicKeyPem },
      ),
    ).toThrowError("invalid ChangeBatch signature");
  });

  test("binds signed Workspace operations to the writer envelope", () => {
    const identity = generateWriterIdentity();
    const signed = signChangeBatch(
      parseChangeBatch({
        realmId: "realm-personal",
        writerStreamId: "controller",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        operations: [
          {
            type: "attach-workspace",
            runId: "run-1",
            workspaceId: "workspace-code",
            policy: "ask",
          },
        ],
      }),
      identity.privateKeyPem,
    );

    expect(() =>
      verifySignedChangeBatch(
        {
          ...signed,
          batch: {
            ...signed.batch,
            operations: [
              {
                type: "attach-workspace",
                runId: "run-1",
                workspaceId: "workspace-secret",
                policy: "ask",
              },
            ],
          },
        },
        { "controller:1": identity.publicKeyPem },
      ),
    ).toThrowError("invalid ChangeBatch signature");
  });

  test("retains historical verification keys across writer epoch rotation", () => {
    const epochOne = generateWriterIdentity();
    const epochTwo = generateWriterIdentity();
    const historical = signChangeBatch(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-epoch-one",
        parentMessageId: null,
        text: "Before rotation",
      }),
      epochOne.privateKeyPem,
    );

    expect(
      verifySignedChangeBatch(historical, {
        "desktop:1": epochOne.publicKeyPem,
        "desktop:2": epochTwo.publicKeyPem,
      }),
    ).toEqual(historical.batch);
  });
});
