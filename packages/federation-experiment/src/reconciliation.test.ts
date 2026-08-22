import { describe, expect, test } from "vitest";

import {
  InMemoryReplica,
  messageBatch,
  parseChangeBatch,
  type ChangeBatch,
} from "./reconciliation.js";

describe("Personal Realm reconciliation experiment", () => {
  test("applies an authorized root message and advances its frontier", () => {
    const replica = new InMemoryReplica({
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    const batch = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      chatId: "chat-1",
      messageId: "message-root",
      parentMessageId: null,
      text: "Use immutable semantic batches.",
    });

    expect(replica.receive(batch)).toEqual({ status: "applied" });
    expect(replica.chatHeads("chat-1")).toEqual(["message-root"]);
    expect(replica.coverageAgainst({ desktop: 1 })).toEqual({
      status: "verified-complete",
      frontier: { desktop: 1 },
    });
  });

  test("backfills causal history when the receiver has no frontier", () => {
    const options = {
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    } as const;
    const source = new InMemoryReplica(options);
    const target = new InMemoryReplica(options);
    source.receive(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-root",
        parentMessageId: null,
        text: "Root",
      }),
    );
    source.receive(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 2,
        dependencies: ["desktop:1"],
        chatId: "chat-1",
        messageId: "message-child",
        parentMessageId: "message-root",
        text: "Child",
      }),
    );

    expect(target.reconcileFrom(source)).toEqual({ applied: 2 });
    expect(target.chatHeads("chat-1")).toEqual(["message-child"]);
    expect(target.coverageAgainst({ desktop: 2 })).toEqual({
      status: "verified-complete",
      frontier: { desktop: 2 },
    });
  });

  test("converges concurrent offline continuations into deterministic branches", () => {
    const options = {
      realmId: "realm-personal",
      writerEpochs: { desktop: 1, phone: 1 },
    } as const;
    const desktop = new InMemoryReplica(options);
    const phone = new InMemoryReplica(options);
    const root = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      chatId: "chat-1",
      messageId: "message-root",
      parentMessageId: null,
      text: "Root",
    });
    desktop.receive(root);
    phone.receive(root);
    desktop.receive(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 2,
        dependencies: ["desktop:1"],
        chatId: "chat-1",
        messageId: "message-desktop",
        parentMessageId: "message-root",
        text: "Desktop continuation",
      }),
    );
    phone.receive(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "phone",
        writerEpoch: 1,
        sequence: 1,
        dependencies: ["desktop:1"],
        chatId: "chat-1",
        messageId: "message-phone",
        parentMessageId: "message-root",
        text: "Phone continuation",
      }),
    );

    desktop.reconcileFrom(phone);
    phone.reconcileFrom(desktop);

    const expectedBranches = [
      {
        branchId: "message-desktop",
        headMessageId: "message-desktop",
        messageIds: ["message-root", "message-desktop"],
      },
      {
        branchId: "message-phone",
        headMessageId: "message-phone",
        messageIds: ["message-root", "message-phone"],
      },
    ];
    expect(desktop.chatBranches("chat-1")).toEqual(expectedBranches);
    expect(phone.chatBranches("chat-1")).toEqual(expectedBranches);
  });

  test("fences an offline writer after an authority epoch change", () => {
    const replica = new InMemoryReplica({
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    replica.receive(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-root",
        parentMessageId: null,
        text: "Root",
      }),
    );

    replica.advanceWriterEpoch({
      writerStreamId: "desktop",
      expectedEpoch: 1,
      nextEpoch: 2,
    });

    expect(() =>
      replica.receive(
        messageBatch({
          realmId: "realm-personal",
          writerStreamId: "desktop",
          writerEpoch: 1,
          sequence: 2,
          dependencies: ["desktop:1"],
          chatId: "chat-1",
          messageId: "message-from-fenced-writer",
          parentMessageId: "message-root",
          text: "Authored while offline",
        }),
      ),
    ).toThrowError("writer is not authorized for this epoch");
    expect(replica.chatHeads("chat-1")).toEqual(["message-root"]);
    expect(replica.coverageAgainst({ desktop: 2 })).toEqual({
      status: "partial",
      frontier: { desktop: 1 },
    });
  });

  test("replays identical batches idempotently and rejects reference reuse", () => {
    const replica = new InMemoryReplica({
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    const original = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      chatId: "chat-1",
      messageId: "message-root",
      parentMessageId: null,
      text: "Original payload",
    });
    replica.receive(original);

    expect(replica.receive(original)).toEqual({ status: "already-applied" });
    expect(() =>
      replica.receive(
        messageBatch({
          realmId: "realm-personal",
          writerStreamId: "desktop",
          writerEpoch: 1,
          sequence: 1,
          dependencies: [],
          chatId: "chat-1",
          messageId: "message-root",
          parentMessageId: null,
          text: "Different payload under the same batch reference",
        }),
      ),
    ).toThrowError("batch reference reused with different payload");
    expect(replica.chatBranches("chat-1")).toEqual([
      {
        branchId: "message-root",
        headMessageId: "message-root",
        messageIds: ["message-root"],
      },
    ]);
  });

  test("refuses to advance coverage across an omitted writer sequence", () => {
    const replica = new InMemoryReplica({
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });

    expect(() =>
      replica.receive(
        messageBatch({
          realmId: "realm-personal",
          writerStreamId: "desktop",
          writerEpoch: 1,
          sequence: 2,
          dependencies: [],
          chatId: "chat-1",
          messageId: "message-gap",
          parentMessageId: null,
          text: "This batch omitted desktop:1.",
        }),
      ),
    ).toThrowError("writer sequence gap: expected 1, received 2");
    expect(replica.coverageAgainst({ desktop: 2 })).toEqual({
      status: "partial",
      frontier: {},
    });
  });

  test("rejects an unknown semantic operation without partially applying its batch", () => {
    const replica = new InMemoryReplica({
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    const batch: ChangeBatch = {
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      operations: [
        {
          type: "append-message",
          chatId: "chat-1",
          messageId: "message-must-not-commit",
          parentMessageId: null,
          text: "This operation is valid by itself.",
        },
        { type: "future-operation" },
      ],
    };

    expect(() => replica.receive(batch)).toThrowError(
      "unsupported semantic operation: future-operation",
    );
    expect(replica.chatHeads("chat-1")).toEqual([]);
    expect(replica.coverageAgainst({ desktop: 1 })).toEqual({
      status: "partial",
      frontier: {},
    });
  });

  test("rejects resource identity reuse without advancing the batch frontier", () => {
    const replica = new InMemoryReplica({
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    replica.receive(
      messageBatch({
        realmId: "realm-personal",
        writerStreamId: "desktop",
        writerEpoch: 1,
        sequence: 1,
        dependencies: [],
        chatId: "chat-1",
        messageId: "message-root",
        parentMessageId: null,
        text: "Original identity",
      }),
    );

    expect(() =>
      replica.receive(
        messageBatch({
          realmId: "realm-personal",
          writerStreamId: "desktop",
          writerEpoch: 1,
          sequence: 2,
          dependencies: ["desktop:1"],
          chatId: "chat-1",
          messageId: "message-root",
          parentMessageId: null,
          text: "Conflicting identity reuse",
        }),
      ),
    ).toThrowError("message identity reused: message-root");
    expect(replica.coverageAgainst({ desktop: 2 })).toEqual({
      status: "partial",
      frontier: { desktop: 1 },
    });
  });

  test("pins an accepted batch against later caller mutation", () => {
    const options = {
      realmId: "realm-personal",
      writerEpochs: { desktop: 1, phone: 1 },
    } as const;
    const source = new InMemoryReplica(options);
    const target = new InMemoryReplica(options);
    const dependencies: string[] = [];
    const batch = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies,
      chatId: "chat-1",
      messageId: "message-root",
      parentMessageId: null,
      text: "Accepted payload",
    });
    source.receive(batch);

    dependencies.push("phone:1");

    expect(target.reconcileFrom(source)).toEqual({ applied: 1 });
    expect(target.chatHeads("chat-1")).toEqual(["message-root"]);
  });

  test("exports only batches beyond a peer frontier in causal receive order", () => {
    const source = new InMemoryReplica({
      realmId: "realm-personal",
      writerEpochs: { desktop: 1 },
    });
    const root = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      chatId: "chat-1",
      messageId: "message-root",
      parentMessageId: null,
      text: "Root",
    });
    const child = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 2,
      dependencies: ["desktop:1"],
      chatId: "chat-1",
      messageId: "message-child",
      parentMessageId: "message-root",
      text: "Child",
    });
    source.receive(root);
    source.receive(child);

    expect(source.frontier()).toEqual({ desktop: 2 });
    expect(source.exportMissing({ desktop: 1 })).toEqual([child]);
  });

  test("validates a batch decoded from an untrusted transport", () => {
    const valid = messageBatch({
      realmId: "realm-personal",
      writerStreamId: "desktop",
      writerEpoch: 1,
      sequence: 1,
      dependencies: [],
      chatId: "chat-1",
      messageId: "message-root",
      parentMessageId: null,
      text: "Validated",
    });

    expect(parseChangeBatch(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
    expect(() => parseChangeBatch({ ...valid, sequence: 0 })).toThrowError(
      "invalid ChangeBatch",
    );
  });
});
