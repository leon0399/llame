import {
  type AppendRunEventOperation,
  type CreateRunOperation,
  type SemanticOperation,
  type SubmitRunCommandOperation,
  type TransferRunAuthorityOperation,
} from "@workspace/federation-experiment";
import {
  signChangeBatch,
  type SignedChangeBatch,
} from "@workspace/federation-experiment/batch-signature";

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

  public appendEvent(
    event: AppendRunEventOperation["event"],
  ): SignedChangeBatch {
    return this.#author({ type: "append-run-event", event });
  }

  public submitCommand(
    command: SubmitRunCommandOperation["command"],
  ): SignedChangeBatch {
    return this.#author({ type: "submit-run-command", command });
  }

  public transferAuthority(
    input: Omit<TransferRunAuthorityOperation, "type">,
  ): SignedChangeBatch {
    return this.#author({ type: "transfer-run-authority", ...input });
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
