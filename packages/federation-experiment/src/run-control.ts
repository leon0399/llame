import { z } from "zod";

import { WRITER_STREAM_ID_PATTERN } from "./reconciliation.js";

const identitySchema = z.string().min(1).max(200);
const runStatusSchema = z.enum([
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
const terminalStatuses = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
]);
const semanticEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("status"), status: runStatusSchema }),
  z.strictObject({
    type: z.literal("assistant-output"),
    messageId: identitySchema,
    text: z.string(),
  }),
  z.strictObject({
    type: z.literal("authority-transferred"),
    previousExecutorNodeId: z.string().regex(WRITER_STREAM_ID_PATTERN),
    reason: z.enum(["handoff", "fallback", "recovery"]),
  }),
]);
const runControlEventSchema = z.strictObject({
  realmId: identitySchema,
  runId: identitySchema,
  executorNodeId: z.string().regex(WRITER_STREAM_ID_PATTERN),
  authorityEpoch: z.number().int().positive(),
  sequence: z.number().int().positive(),
  eventId: identitySchema,
  event: semanticEventSchema,
});
const runCommandPayloadSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("steer"), text: z.string().min(1) }),
  z.strictObject({ type: z.literal("cancel") }),
]);
const runCommandInputSchema = z.strictObject({
  realmId: identitySchema,
  runId: identitySchema,
  commandId: identitySchema,
  authorityEpoch: z.number().int().positive(),
  command: runCommandPayloadSchema,
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunSemanticEvent = z.infer<typeof semanticEventSchema>;
export type RunControlEvent = z.infer<typeof runControlEventSchema>;
export type RunCommandInput = z.infer<typeof runCommandInputSchema>;
export type RunCommand = RunCommandInput & { readonly commandSequence: number };

export interface RunControlOptions {
  readonly realmId: string;
  readonly runId: string;
  readonly executorNodeId: string;
  readonly authorityEpoch?: number;
}

export interface RunControlSnapshot {
  readonly realmId: string;
  readonly runId: string;
  readonly executorNodeId: string;
  readonly authorityEpoch: number;
  readonly status: RunStatus;
  readonly cursor: number;
  readonly events: readonly RunControlEvent[];
}

export function parseRunControlEvent(input: unknown): RunControlEvent {
  const parsed = runControlEventSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("invalid Run control event", { cause: parsed.error });
  }
  return parsed.data;
}

export function parseRunCommandInput(input: unknown): RunCommandInput {
  const parsed = runCommandInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("invalid Run command", { cause: parsed.error });
  }
  return parsed.data;
}

export class InMemoryRunControl {
  readonly #realmId: string;
  readonly #runId: string;
  readonly #events: RunControlEvent[] = [];
  readonly #eventsBySequence = new Map<number, RunControlEvent>();
  readonly #eventSequencesById = new Map<string, number>();
  readonly #commands: RunCommand[] = [];
  readonly #commandsById = new Map<string, RunCommand>();
  #executorNodeId: string;
  #authorityEpoch: number;
  #status: RunStatus = "queued";

  public constructor(options: RunControlOptions) {
    this.#realmId = identitySchema.parse(options.realmId);
    this.#runId = identitySchema.parse(options.runId);
    this.#executorNodeId = z
      .string()
      .regex(WRITER_STREAM_ID_PATTERN)
      .parse(options.executorNodeId);
    this.#authorityEpoch = z
      .number()
      .int()
      .positive()
      .parse(options.authorityEpoch ?? 1);
  }

  public appendExecutorEvent(input: unknown): {
    readonly status: "applied" | "already-applied";
  } {
    const event = structuredClone(parseRunControlEvent(input));
    const existing = this.#eventsBySequence.get(event.sequence);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(event)) {
        throw new Error("Run event sequence reused with different payload");
      }
      return { status: "already-applied" };
    }
    if (this.#eventSequencesById.has(event.eventId)) {
      throw new Error("Run event identity reused at another sequence");
    }
    this.#assertRunIdentity(event.realmId, event.runId);
    if (
      event.authorityEpoch !== this.#authorityEpoch ||
      event.executorNodeId !== this.#executorNodeId
    ) {
      throw new Error("executor does not hold current Run authority");
    }
    if (terminalStatuses.has(this.#status)) {
      throw new Error("terminal Run state is immutable");
    }
    this.#append(event);
    return { status: "applied" };
  }

  public transferAuthority(input: {
    readonly expectedAuthorityEpoch: number;
    readonly targetExecutorNodeId: string;
    readonly reason: "handoff" | "fallback" | "recovery";
  }): RunControlEvent {
    if (terminalStatuses.has(this.#status)) {
      throw new Error("terminal Run authority cannot transfer");
    }
    if (input.expectedAuthorityEpoch !== this.#authorityEpoch) {
      throw new Error("Run authority epoch changed concurrently");
    }
    const targetExecutorNodeId = z
      .string()
      .regex(WRITER_STREAM_ID_PATTERN)
      .parse(input.targetExecutorNodeId);
    const previousExecutorNodeId = this.#executorNodeId;
    this.#authorityEpoch += 1;
    this.#executorNodeId = targetExecutorNodeId;
    const event: RunControlEvent = {
      realmId: this.#realmId,
      runId: this.#runId,
      executorNodeId: targetExecutorNodeId,
      authorityEpoch: this.#authorityEpoch,
      sequence: this.#events.length + 1,
      eventId: `authority-${this.#authorityEpoch}`,
      event: {
        type: "authority-transferred",
        previousExecutorNodeId,
        reason: input.reason,
      },
    };
    this.#append(event);
    return structuredClone(event);
  }

  public submitCommand(input: unknown): {
    readonly status: "accepted" | "already-accepted";
    readonly commandSequence: number;
  } {
    const commandInput = structuredClone(parseRunCommandInput(input));
    const existing = this.#commandsById.get(commandInput.commandId);
    if (existing !== undefined) {
      const { commandSequence: _, ...existingInput } = existing;
      if (JSON.stringify(existingInput) !== JSON.stringify(commandInput)) {
        throw new Error("command identity reused with different payload");
      }
      return {
        status: "already-accepted",
        commandSequence: existing.commandSequence,
      };
    }
    this.#assertRunIdentity(commandInput.realmId, commandInput.runId);
    if (terminalStatuses.has(this.#status)) {
      throw new Error("terminal Run cannot accept commands");
    }
    if (commandInput.authorityEpoch !== this.#authorityEpoch) {
      throw new Error("command targets stale Run authority");
    }
    const command: RunCommand = {
      ...commandInput,
      commandSequence: this.#commands.length + 1,
    };
    this.#commands.push(command);
    this.#commandsById.set(command.commandId, command);
    return { status: "accepted", commandSequence: command.commandSequence };
  }

  public commandsAfter(commandSequence: number): readonly RunCommand[] {
    if (!Number.isInteger(commandSequence) || commandSequence < 0) {
      throw new Error("command cursor must be a non-negative integer");
    }
    return this.#commands
      .filter((command) => command.commandSequence > commandSequence)
      .map((command) => structuredClone(command));
  }

  public snapshot(afterSequence = 0): RunControlSnapshot {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new Error("event cursor must be a non-negative integer");
    }
    return {
      realmId: this.#realmId,
      runId: this.#runId,
      executorNodeId: this.#executorNodeId,
      authorityEpoch: this.#authorityEpoch,
      status: this.#status,
      cursor: this.#events.length,
      events: this.#events
        .filter((event) => event.sequence > afterSequence)
        .map((event) => structuredClone(event)),
    };
  }

  #append(event: RunControlEvent): void {
    const expectedSequence = this.#events.length + 1;
    if (event.sequence !== expectedSequence) {
      throw new Error(
        `Run event sequence gap: expected ${expectedSequence}, received ${event.sequence}`,
      );
    }
    if (event.event.type === "status" && event.event.status !== this.#status) {
      this.#status = event.event.status;
    }
    this.#events.push(event);
    this.#eventsBySequence.set(event.sequence, event);
    this.#eventSequencesById.set(event.eventId, event.sequence);
  }

  #assertRunIdentity(realmId: string, runId: string): void {
    if (realmId !== this.#realmId) throw new Error("Run Realm mismatch");
    if (runId !== this.#runId) throw new Error("Run identity mismatch");
  }
}
