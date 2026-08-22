import { randomUUID } from "node:crypto";

import {
  type CreateRunOperation,
  type SemanticOperation,
  type TransferRunAuthorityOperation,
} from "@workspace/federation-experiment";
import {
  signChangeBatch,
  type SignedChangeBatch,
} from "@workspace/federation-experiment/batch-signature";
import {
  parseRunCommandInput,
  parseRunControlEvent,
} from "@workspace/federation-experiment/run-control";

import type { SqlitePersonalRealmStore } from "./sqlite-replica.js";

export interface SignedRealmRunAuthorOptions {
  readonly store: SqlitePersonalRealmStore;
  readonly writerStreamId: string;
  readonly writerEpoch: number;
  readonly privateKeyPem: string;
}

export class SignedRealmRunAuthor {
  readonly #store: SqlitePersonalRealmStore;
  readonly #writerStreamId: string;
  readonly #writerEpoch: number;
  readonly #privateKeyPem: string;

  public constructor(options: SignedRealmRunAuthorOptions) {
    this.#store = options.store;
    this.#writerStreamId = options.writerStreamId;
    this.#writerEpoch = options.writerEpoch;
    this.#privateKeyPem = options.privateKeyPem;
  }

  public createRun(input: Omit<CreateRunOperation, "type">): SignedChangeBatch {
    return this.#author({ type: "create-run", ...input });
  }

  public appendEvent(event: unknown): SignedChangeBatch {
    return this.#author({
      type: "append-run-event",
      event: parseRunControlEvent(event),
    });
  }

  public appendStatus(input: {
    readonly runId: string;
    readonly status:
      | "queued"
      | "running"
      | "paused"
      | "completed"
      | "failed"
      | "cancelled";
    readonly eventId?: string;
  }): SignedChangeBatch {
    const snapshot = this.#store.runSnapshot(input.runId);
    return this.appendEvent({
      realmId: snapshot.realmId,
      runId: snapshot.runId,
      executorNodeId: snapshot.executorNodeId,
      authorityEpoch: snapshot.authorityEpoch,
      sequence: snapshot.cursor + 1,
      eventId: input.eventId ?? randomUUID(),
      event: { type: "status", status: input.status },
    });
  }

  public submitCommand(command: unknown): SignedChangeBatch {
    return this.#author({
      type: "submit-run-command",
      command: parseRunCommandInput(command),
    });
  }

  public steer(input: {
    readonly runId: string;
    readonly text: string;
    readonly commandId?: string;
  }): SignedChangeBatch {
    const snapshot = this.#store.runSnapshot(input.runId);
    return this.submitCommand({
      realmId: snapshot.realmId,
      runId: snapshot.runId,
      commandId: input.commandId ?? randomUUID(),
      authorityEpoch: snapshot.authorityEpoch,
      command: { type: "steer", text: input.text },
    });
  }

  public transferAuthority(
    input: Omit<TransferRunAuthorityOperation, "type">,
  ): SignedChangeBatch {
    return this.#author({ type: "transfer-run-authority", ...input });
  }

  public transferTo(input: {
    readonly runId: string;
    readonly targetExecutorNodeId: string;
    readonly reason: "handoff" | "fallback" | "recovery" | "workspace-exit";
  }): SignedChangeBatch {
    const snapshot = this.#store.runSnapshot(input.runId);
    return this.transferAuthority({
      runId: snapshot.runId,
      expectedAuthorityEpoch: snapshot.authorityEpoch,
      targetExecutorNodeId: input.targetExecutorNodeId,
      reason: input.reason,
    });
  }

  #author(operation: SemanticOperation): SignedChangeBatch {
    const frontier = this.#store.frontier();
    const sequence = (frontier[this.#writerStreamId] ?? 0) + 1;
    const dependencies = Object.entries(frontier)
      .filter(([, appliedSequence]) => appliedSequence > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([writerStreamId, appliedSequence]) =>
          `${writerStreamId}:${appliedSequence}`,
      );
    const signed = signChangeBatch(
      {
        realmId: this.#store.realmId(),
        writerStreamId: this.#writerStreamId,
        writerEpoch: this.#writerEpoch,
        sequence,
        dependencies,
        operations: [operation],
      },
      this.#privateKeyPem,
    );
    this.#store.receiveSigned(signed);
    return signed;
  }
}
