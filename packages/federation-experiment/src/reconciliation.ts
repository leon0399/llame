import { z } from "zod";

import { WRITER_STREAM_ID_PATTERN } from "./identities.js";
import {
  InMemoryRunControl,
  runCommandInputSchema,
  runControlEventSchema,
  transferRunAuthorityInputSchema,
  type RunCommand,
  type RunCommandInput,
  type RunControlEvent,
  type RunControlSnapshot,
  type TransferRunAuthorityInput,
} from "./run-control.js";

export { WRITER_STREAM_ID_PATTERN } from "./identities.js";
export const BATCH_REF_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}:[1-9][0-9]*$/;

export interface ReplicaOptions {
  readonly realmId: string;
  readonly writerEpochs: Readonly<Record<string, number>>;
  readonly runControlGrants?: Readonly<Record<string, RunControlWriterGrant>>;
}

export type ReplicatedRunScope = "run.execute" | "run.steer" | "run.control";

export interface RunControlWriterGrant {
  readonly scopes: readonly ReplicatedRunScope[];
  readonly executorNodeIds?: readonly string[];
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

export interface CreateRunOperation {
  readonly type: "create-run";
  readonly runId: string;
  readonly executorNodeId: string;
}

export interface AppendRunEventOperation {
  readonly type: "append-run-event";
  readonly event: RunControlEvent;
}

export interface SubmitRunCommandOperation {
  readonly type: "submit-run-command";
  readonly command: RunCommandInput;
}

export interface TransferRunAuthorityOperation
  extends TransferRunAuthorityInput {
  readonly type: "transfer-run-authority";
  readonly runId: string;
}

export type SemanticOperation =
  | AppendMessageOperation
  | CreateRunOperation
  | AppendRunEventOperation
  | SubmitRunCommandOperation
  | TransferRunAuthorityOperation
  | FutureOperation;

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
const runIdentitySchema = z.string().min(1).max(200);
const createRunOperationSchema = z.strictObject({
  type: z.literal("create-run"),
  runId: runIdentitySchema,
  executorNodeId: z.string().regex(WRITER_STREAM_ID_PATTERN),
});
const appendRunEventOperationSchema = z.strictObject({
  type: z.literal("append-run-event"),
  event: runControlEventSchema,
});
const submitRunCommandOperationSchema = z.strictObject({
  type: z.literal("submit-run-command"),
  command: runCommandInputSchema,
});
const transferRunAuthorityOperationSchema =
  transferRunAuthorityInputSchema.extend({
    type: z.literal("transfer-run-authority"),
    runId: runIdentitySchema,
  });

const changeBatchSchema: z.ZodType<ChangeBatch> = z.strictObject({
  realmId: z.string().min(1),
  writerStreamId: z.string().regex(WRITER_STREAM_ID_PATTERN),
  writerEpoch: z.number().int().positive(),
  sequence: z.number().int().positive(),
  dependencies: z.array(z.string().regex(BATCH_REF_PATTERN)),
  operations: z.array(
    z.discriminatedUnion("type", [
      appendMessageOperationSchema,
      createRunOperationSchema,
      appendRunEventOperationSchema,
      submitRunCommandOperationSchema,
      transferRunAuthorityOperationSchema,
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

export function parseRunControlWriterGrants(
  input: unknown,
  writerEpochs: Readonly<Record<string, number>>,
): Readonly<Record<string, RunControlWriterGrant>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("invalid Run-control writer grants");
  }
  const grants: Record<string, RunControlWriterGrant> = {};
  for (const [writerStreamId, value] of Object.entries(input)) {
    if (
      !WRITER_STREAM_ID_PATTERN.test(writerStreamId) ||
      writerEpochs[writerStreamId] === undefined ||
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      throw new Error("invalid Run-control writer grant");
    }
    const grant = value as Record<string, unknown>;
    if (
      !Array.isArray(grant.scopes) ||
      grant.scopes.length === 0 ||
      grant.scopes.some(
        (scope) =>
          scope !== "run.execute" &&
          scope !== "run.steer" &&
          scope !== "run.control",
      )
    ) {
      throw new Error("invalid Run-control writer grant");
    }
    const scopes = [...new Set(grant.scopes as ReplicatedRunScope[])];
    const executorNodeIds = grant.executorNodeIds;
    if (
      executorNodeIds !== undefined &&
      (!Array.isArray(executorNodeIds) ||
        executorNodeIds.length === 0 ||
        executorNodeIds.some(
          (nodeId) =>
            typeof nodeId !== "string" ||
            !WRITER_STREAM_ID_PATTERN.test(nodeId),
        ))
    ) {
      throw new Error("invalid Run-control writer grant");
    }
    if (scopes.includes("run.execute") !== (executorNodeIds !== undefined)) {
      throw new Error(
        "run.execute grants require explicit executor node bindings",
      );
    }
    grants[writerStreamId] = {
      scopes,
      ...(executorNodeIds === undefined
        ? {}
        : { executorNodeIds: [...new Set(executorNodeIds as string[])] }),
    };
  }
  return grants;
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
  readonly #runControlGrants: Readonly<Record<string, RunControlWriterGrant>>;
  readonly #appliedBatches = new Set<string>();
  readonly #journal = new Map<string, ChangeBatch>();
  readonly #frontier: Record<string, number> = {};
  readonly #messagesByChat = new Map<
    string,
    Map<string, AppendMessageOperation>
  >();
  readonly #headsByChat = new Map<string, Set<string>>();
  readonly #runs = new Map<string, InMemoryRunControl>();

  public constructor(options: ReplicaOptions) {
    this.#realmId = options.realmId;
    this.#writerEpochs = { ...options.writerEpochs };
    this.#runControlGrants = parseRunControlWriterGrants(
      options.runControlGrants ?? {},
      this.#writerEpochs,
    );
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

    const stagedMessagesByChat = new Map<
      string,
      Map<string, AppendMessageOperation>
    >();
    const stagedHeadsByChat = new Map<string, Set<string>>();
    const stagedRuns = new Map<string, InMemoryRunControl>();
    const getRun = (runId: string): InMemoryRunControl => {
      const staged = stagedRuns.get(runId);
      if (staged !== undefined) return staged;
      const current = this.#runs.get(runId);
      if (current === undefined) throw new Error("Run does not exist");
      const copy = current.fork();
      stagedRuns.set(runId, copy);
      return copy;
    };
    for (const operation of candidate.operations) {
      if (operation.type === "future-operation") {
        throw new Error(`unsupported semantic operation: ${operation.type}`);
      }
      if (operation.type === "create-run") {
        this.#assertRunScope(candidate.writerStreamId, "run.control");
        if (
          this.#runs.has(operation.runId) ||
          stagedRuns.has(operation.runId)
        ) {
          throw new Error(`Run identity reused: ${operation.runId}`);
        }
        stagedRuns.set(
          operation.runId,
          new InMemoryRunControl({
            realmId: candidate.realmId,
            runId: operation.runId,
            executorNodeId: operation.executorNodeId,
          }),
        );
        continue;
      }
      if (operation.type === "append-run-event") {
        const grant = this.#assertRunScope(
          candidate.writerStreamId,
          "run.execute",
        );
        if (!grant.executorNodeIds?.includes(operation.event.executorNodeId)) {
          throw new Error("writer is not bound to the Run executor");
        }
        if (operation.event.realmId !== candidate.realmId) {
          throw new Error("Run Realm mismatch");
        }
        getRun(operation.event.runId).appendExecutorEvent(operation.event);
        continue;
      }
      if (operation.type === "submit-run-command") {
        this.#assertRunScope(candidate.writerStreamId, "run.steer");
        if (operation.command.realmId !== candidate.realmId) {
          throw new Error("Run Realm mismatch");
        }
        getRun(operation.command.runId).submitCommand(operation.command);
        continue;
      }
      if (operation.type === "transfer-run-authority") {
        this.#assertRunScope(candidate.writerStreamId, "run.control");
        getRun(operation.runId).transferAuthority(operation);
        continue;
      }
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
    for (const [runId, run] of stagedRuns) this.#runs.set(runId, run);

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

  public runSnapshot(runId: string, afterSequence = 0): RunControlSnapshot {
    const run = this.#runs.get(runId);
    if (run === undefined) throw new Error("Run does not exist");
    return run.snapshot(afterSequence);
  }

  public runCommandsAfter(
    runId: string,
    commandSequence: number,
  ): readonly RunCommand[] {
    const run = this.#runs.get(runId);
    if (run === undefined) throw new Error("Run does not exist");
    return run.commandsAfter(commandSequence);
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

  #assertRunScope(
    writerStreamId: string,
    scope: ReplicatedRunScope,
  ): RunControlWriterGrant {
    const grant = this.#runControlGrants[writerStreamId];
    if (grant === undefined || !grant.scopes.includes(scope)) {
      throw new Error(`writer is not authorized for ${scope}`);
    }
    return grant;
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
