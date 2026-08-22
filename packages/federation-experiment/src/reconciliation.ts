import { z } from "zod";

export interface ReplicaOptions {
  readonly realmId: string;
  readonly writerEpochs: Readonly<Record<string, number>>;
}

export interface MessageBatchInput {
  readonly realmId: string;
  readonly writerStreamId: string;
  readonly writerEpoch: number;
  readonly sequence: number;
  readonly dependencies: readonly string[];
  readonly chatId: string;
  readonly messageId: string;
  readonly parentMessageId: string | null;
  readonly text: string;
}

export interface AppendMessageOperation {
  readonly type: "append-message";
  readonly chatId: string;
  readonly messageId: string;
  readonly parentMessageId: string | null;
  readonly text: string;
}

export interface FutureOperation {
  readonly type: "future-operation";
}

export type SemanticOperation = AppendMessageOperation | FutureOperation;

export interface ChangeBatch {
  readonly realmId: string;
  readonly writerStreamId: string;
  readonly writerEpoch: number;
  readonly sequence: number;
  readonly dependencies: readonly string[];
  readonly operations: readonly SemanticOperation[];
}

export interface CoverageVerdict {
  readonly status: "verified-complete" | "partial";
  readonly frontier: Readonly<Record<string, number>>;
}

export interface ChatBranch {
  readonly branchId: string;
  readonly headMessageId: string;
  readonly messageIds: readonly string[];
}

export interface AdvanceWriterEpochInput {
  readonly writerStreamId: string;
  readonly expectedEpoch: number;
  readonly nextEpoch: number;
}

const appendMessageOperationSchema = z.strictObject({
  type: z.literal("append-message"),
  chatId: z.string().min(1),
  messageId: z.string().min(1),
  parentMessageId: z.string().min(1).nullable(),
  text: z.string(),
});

const changeBatchSchema: z.ZodType<ChangeBatch> = z.strictObject({
  realmId: z.string().min(1),
  writerStreamId: z.string().min(1),
  writerEpoch: z.number().int().positive(),
  sequence: z.number().int().positive(),
  dependencies: z.array(z.string().min(1)),
  operations: z.array(
    z.discriminatedUnion("type", [
      appendMessageOperationSchema,
      z.strictObject({ type: z.literal("future-operation") }),
    ]),
  ),
});

export function parseChangeBatch(input: unknown): ChangeBatch {
  const result = changeBatchSchema.safeParse(input);
  if (!result.success) {
    throw new Error("invalid ChangeBatch", { cause: result.error });
  }
  return result.data;
}

export function messageBatch(input: MessageBatchInput): ChangeBatch {
  return {
    realmId: input.realmId,
    writerStreamId: input.writerStreamId,
    writerEpoch: input.writerEpoch,
    sequence: input.sequence,
    dependencies: input.dependencies,
    operations: [
      {
        type: "append-message",
        chatId: input.chatId,
        messageId: input.messageId,
        parentMessageId: input.parentMessageId,
        text: input.text,
      },
    ],
  };
}

function batchRef(batch: ChangeBatch): string {
  return `${batch.writerStreamId}:${batch.sequence}`;
}

export class InMemoryReplica {
  readonly #realmId: string;
  readonly #writerEpochs: Record<string, number>;
  readonly #appliedBatches = new Set<string>();
  readonly #journal = new Map<string, ChangeBatch>();
  readonly #frontier: Record<string, number> = {};
  readonly #messagesByChat = new Map<
    string,
    Map<string, AppendMessageOperation>
  >();
  readonly #headsByChat = new Map<string, Set<string>>();

  public constructor(options: ReplicaOptions) {
    this.#realmId = options.realmId;
    this.#writerEpochs = { ...options.writerEpochs };
  }

  public receive(batch: ChangeBatch): {
    readonly status: "applied" | "already-applied";
  } {
    const candidate = structuredClone(batch);
    const reference = batchRef(candidate);
    const existing = this.#journal.get(reference);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(candidate)) {
        throw new Error("batch reference reused with different payload");
      }
      return { status: "already-applied" };
    }
    if (candidate.realmId !== this.#realmId) {
      throw new Error("realm mismatch");
    }
    if (
      this.#writerEpochs[candidate.writerStreamId] !== candidate.writerEpoch
    ) {
      throw new Error("writer is not authorized for this epoch");
    }
    const expectedSequence =
      (this.#frontier[candidate.writerStreamId] ?? 0) + 1;
    if (candidate.sequence !== expectedSequence) {
      throw new Error(
        `writer sequence gap: expected ${expectedSequence}, received ${candidate.sequence}`,
      );
    }
    for (const dependency of candidate.dependencies) {
      if (!this.#appliedBatches.has(dependency)) {
        throw new Error(`missing dependency: ${dependency}`);
      }
    }

    const operations = candidate.operations.map((operation) => {
      if (operation.type !== "append-message") {
        throw new Error(`unsupported semantic operation: ${operation.type}`);
      }
      return operation;
    });
    const stagedMessagesByChat = new Map<
      string,
      Map<string, AppendMessageOperation>
    >();
    const stagedHeadsByChat = new Map<string, Set<string>>();
    for (const operation of operations) {
      const messages =
        stagedMessagesByChat.get(operation.chatId) ??
        new Map(this.#messagesByChat.get(operation.chatId));
      const heads =
        stagedHeadsByChat.get(operation.chatId) ??
        new Set(this.#headsByChat.get(operation.chatId));
      if (
        operation.parentMessageId !== null &&
        !messages.has(operation.parentMessageId)
      ) {
        throw new Error(`missing parent message: ${operation.parentMessageId}`);
      }
      if (messages.has(operation.messageId)) {
        throw new Error(`message identity reused: ${operation.messageId}`);
      }
      messages.set(operation.messageId, operation);
      if (operation.parentMessageId !== null) {
        heads.delete(operation.parentMessageId);
      }
      heads.add(operation.messageId);
      stagedMessagesByChat.set(operation.chatId, messages);
      stagedHeadsByChat.set(operation.chatId, heads);
    }
    for (const [chatId, messages] of stagedMessagesByChat) {
      this.#messagesByChat.set(chatId, messages);
    }
    for (const [chatId, heads] of stagedHeadsByChat) {
      this.#headsByChat.set(chatId, heads);
    }

    this.#appliedBatches.add(reference);
    this.#journal.set(reference, candidate);
    this.#frontier[candidate.writerStreamId] = Math.max(
      this.#frontier[candidate.writerStreamId] ?? 0,
      candidate.sequence,
    );
    return { status: "applied" };
  }

  public chatHeads(chatId: string): readonly string[] {
    return [...(this.#headsByChat.get(chatId) ?? [])].sort();
  }

  public chatBranches(chatId: string): readonly ChatBranch[] {
    const messages = this.#messagesByChat.get(chatId);
    if (messages === undefined) {
      return [];
    }
    return this.chatHeads(chatId).map((headMessageId) => {
      const messageIds: string[] = [];
      let messageId: string | null = headMessageId;
      while (messageId !== null) {
        messageIds.unshift(messageId);
        const message = messages.get(messageId);
        if (message === undefined) {
          throw new Error(`missing applied message: ${messageId}`);
        }
        messageId = message.parentMessageId;
      }
      return {
        branchId: headMessageId,
        headMessageId,
        messageIds,
      };
    });
  }

  public advanceWriterEpoch(input: AdvanceWriterEpochInput): void {
    if (this.#writerEpochs[input.writerStreamId] !== input.expectedEpoch) {
      throw new Error("writer epoch changed concurrently");
    }
    if (input.nextEpoch <= input.expectedEpoch) {
      throw new Error("writer epoch must advance");
    }
    this.#writerEpochs[input.writerStreamId] = input.nextEpoch;
  }

  public reconcileFrom(source: InMemoryReplica): { readonly applied: number } {
    let applied = 0;
    for (const [reference, batch] of source.#journal) {
      if (this.#appliedBatches.has(reference)) {
        continue;
      }
      this.receive(batch);
      applied += 1;
    }
    return { applied };
  }

  public frontier(): Readonly<Record<string, number>> {
    return { ...this.#frontier };
  }

  public exportMissing(
    peerFrontier: Readonly<Record<string, number>>,
  ): readonly ChangeBatch[] {
    return [...this.#journal.values()]
      .filter(
        (batch) => batch.sequence > (peerFrontier[batch.writerStreamId] ?? 0),
      )
      .map((batch) => structuredClone(batch));
  }

  public coverageAgainst(
    expectedFrontier: Readonly<Record<string, number>>,
  ): CoverageVerdict {
    const complete = Object.entries(expectedFrontier).every(
      ([writerStreamId, sequence]) =>
        (this.#frontier[writerStreamId] ?? 0) >= sequence,
    );
    return {
      status: complete ? "verified-complete" : "partial",
      frontier: { ...this.#frontier },
    };
  }
}
