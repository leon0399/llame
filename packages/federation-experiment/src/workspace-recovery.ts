import { z } from "zod";

import { WRITER_STREAM_ID_PATTERN } from "./reconciliation.js";

const recoveryPolicySchema = z.enum(["ask", "wait", "fallback", "exit"]);
const recoveryActionSchema = z.enum(["wait", "fallback", "exit"]);
const nodeIdSchema = z.string().regex(WRITER_STREAM_ID_PATTERN);
const executorUnavailableContextSchema = z.strictObject({
  executorNodeId: nodeIdSchema,
  continuationExecutorNodeId: nodeIdSchema.nullable(),
  egressAllowsFallback: z.boolean(),
});
const recoveryChoiceContextSchema = executorUnavailableContextSchema.omit({
  executorNodeId: true,
});

export type WorkspaceRecoveryPolicy = z.infer<typeof recoveryPolicySchema>;
export type WorkspaceRecoveryAction = z.infer<typeof recoveryActionSchema>;
export type WorkspaceRecoveryMode =
  | "attached"
  | "decision-required"
  | "waiting"
  | "temporary-fallback"
  | "exited";

export interface WorkspaceRecoveryState {
  readonly workspaceId: string;
  readonly preferredExecutorNodeId: string;
  readonly activeExecutorNodeId: string;
  readonly authorityEpoch: number;
  readonly policy: WorkspaceRecoveryPolicy;
  readonly mode: WorkspaceRecoveryMode;
  readonly workspaceAttached: boolean;
  readonly preferredExecutorAvailable: boolean;
}

export type WorkspaceRecoveryEffect =
  | {
      readonly type: "workspace-availability-changed";
      readonly workspaceId: string;
      readonly availability: "available" | "unavailable";
    }
  | {
      readonly type: "request-recovery-decision";
      readonly actions: readonly WorkspaceRecoveryAction[];
    }
  | {
      readonly type: "fallback-blocked";
      readonly reason: "egress-policy" | "no-continuation-executor";
    }
  | {
      readonly type: "transfer-run-authority";
      readonly expectedAuthorityEpoch: number;
      readonly nextAuthorityEpoch: number;
      readonly targetExecutorNodeId: string;
      readonly reason: "fallback" | "recovery" | "workspace-exit";
    }
  | {
      readonly type: "workspace-binding-changed";
      readonly workspaceId: string;
      readonly binding: "attached" | "temporarily-detached" | "exited";
    };

export interface WorkspaceRecoveryTransition {
  readonly state: WorkspaceRecoveryState;
  readonly availableActions: readonly WorkspaceRecoveryAction[];
  readonly effects: readonly WorkspaceRecoveryEffect[];
}

export interface ExecutorUnavailableContext {
  readonly executorNodeId: string;
  readonly continuationExecutorNodeId: string | null;
  readonly egressAllowsFallback: boolean;
}

export class InMemoryWorkspaceRecovery {
  #state: WorkspaceRecoveryState;

  public constructor(options: {
    readonly workspaceId: string;
    readonly preferredExecutorNodeId: string;
    readonly authorityEpoch: number;
    readonly policy: WorkspaceRecoveryPolicy;
  }) {
    this.#state = {
      workspaceId: z.string().min(1).max(200).parse(options.workspaceId),
      preferredExecutorNodeId: nodeIdSchema.parse(
        options.preferredExecutorNodeId,
      ),
      activeExecutorNodeId: nodeIdSchema.parse(options.preferredExecutorNodeId),
      authorityEpoch: z.number().int().positive().parse(options.authorityEpoch),
      policy: recoveryPolicySchema.parse(options.policy),
      mode: "attached",
      workspaceAttached: true,
      preferredExecutorAvailable: true,
    };
  }

  public executorUnavailable(
    contextInput: unknown,
  ): WorkspaceRecoveryTransition {
    const context = executorUnavailableContextSchema.parse(contextInput);
    if (this.#state.mode !== "attached") {
      throw new Error("Workspace recovery is already active");
    }
    if (
      context.executorNodeId !== this.#state.preferredExecutorNodeId ||
      context.executorNodeId !== this.#state.activeExecutorNodeId
    ) {
      throw new Error("unavailability targets a different executor");
    }
    this.#state = { ...this.#state, preferredExecutorAvailable: false };
    const unavailableEffect: WorkspaceRecoveryEffect = {
      type: "workspace-availability-changed",
      workspaceId: this.#state.workspaceId,
      availability: "unavailable",
    };
    if (this.#state.policy === "wait") {
      return this.#wait([unavailableEffect]);
    }
    if (this.#state.policy === "fallback") {
      if (this.#canContinue(context)) {
        return this.#fallback(context.continuationExecutorNodeId, [
          unavailableEffect,
        ]);
      }
      return this.#blocked(context, unavailableEffect);
    }
    if (this.#state.policy === "exit") {
      if (this.#canContinue(context)) {
        return this.#exit(context.continuationExecutorNodeId, [
          unavailableEffect,
        ]);
      }
      return this.#blocked(context, unavailableEffect);
    }
    return this.#ask(context, [unavailableEffect]);
  }

  public choose(
    actionInput: unknown,
    contextInput: unknown,
  ): WorkspaceRecoveryTransition {
    if (this.#state.mode !== "decision-required") {
      throw new Error("Workspace recovery is not awaiting a decision");
    }
    const action = recoveryActionSchema.parse(actionInput);
    const context = recoveryChoiceContextSchema.parse(contextInput);
    const normalizedContext = {
      ...context,
      executorNodeId: this.#state.preferredExecutorNodeId,
    };
    const availableActions = this.#availableActions(normalizedContext);
    if (!availableActions.includes(action)) {
      throw new Error("Workspace recovery action is not currently allowed");
    }
    if (action === "wait") return this.#wait([]);
    if (action === "fallback") {
      return this.#fallback(normalizedContext.continuationExecutorNodeId, []);
    }
    return this.#exit(normalizedContext.continuationExecutorNodeId, []);
  }

  public preferredExecutorRecovered(): WorkspaceRecoveryTransition {
    if (this.#state.preferredExecutorAvailable) {
      return this.#transition([]);
    }
    this.#state = { ...this.#state, preferredExecutorAvailable: true };
    const effects: WorkspaceRecoveryEffect[] = [
      {
        type: "workspace-availability-changed",
        workspaceId: this.#state.workspaceId,
        availability: "available",
      },
    ];
    if (this.#state.mode === "temporary-fallback") {
      const expectedAuthorityEpoch = this.#state.authorityEpoch;
      this.#state = {
        ...this.#state,
        activeExecutorNodeId: this.#state.preferredExecutorNodeId,
        authorityEpoch: expectedAuthorityEpoch + 1,
        mode: "attached",
        workspaceAttached: true,
      };
      effects.push(
        {
          type: "transfer-run-authority",
          expectedAuthorityEpoch,
          nextAuthorityEpoch: expectedAuthorityEpoch + 1,
          targetExecutorNodeId: this.#state.preferredExecutorNodeId,
          reason: "recovery",
        },
        {
          type: "workspace-binding-changed",
          workspaceId: this.#state.workspaceId,
          binding: "attached",
        },
      );
    } else if (
      this.#state.mode === "waiting" ||
      this.#state.mode === "decision-required"
    ) {
      this.#state = { ...this.#state, mode: "attached" };
    }
    return this.#transition(effects);
  }

  public exitWorkspace(): WorkspaceRecoveryTransition {
    if (this.#state.mode === "exited") return this.#transition([]);
    this.#state = {
      ...this.#state,
      mode: "exited",
      workspaceAttached: false,
    };
    return this.#transition([
      {
        type: "workspace-binding-changed",
        workspaceId: this.#state.workspaceId,
        binding: "exited",
      },
    ]);
  }

  public state(): WorkspaceRecoveryState {
    return structuredClone(this.#state);
  }

  #ask(
    context: ExecutorUnavailableContext,
    effects: readonly WorkspaceRecoveryEffect[],
  ): WorkspaceRecoveryTransition {
    const actions = this.#availableActions(context);
    this.#state = { ...this.#state, mode: "decision-required" };
    return this.#transition([
      ...effects,
      { type: "request-recovery-decision", actions },
    ]);
  }

  #blocked(
    context: ExecutorUnavailableContext,
    unavailableEffect: WorkspaceRecoveryEffect,
  ): WorkspaceRecoveryTransition {
    const reason = context.egressAllowsFallback
      ? "no-continuation-executor"
      : "egress-policy";
    this.#state = { ...this.#state, mode: "decision-required" };
    const actions = this.#availableActions(context);
    return this.#transition([
      unavailableEffect,
      { type: "fallback-blocked", reason },
      { type: "request-recovery-decision", actions },
    ]);
  }

  #wait(
    effects: readonly WorkspaceRecoveryEffect[],
  ): WorkspaceRecoveryTransition {
    this.#state = { ...this.#state, mode: "waiting" };
    return this.#transition(effects);
  }

  #fallback(
    continuationExecutorNodeId: string | null,
    effects: readonly WorkspaceRecoveryEffect[],
  ): WorkspaceRecoveryTransition {
    if (continuationExecutorNodeId === null) {
      throw new Error("temporary fallback requires a continuation executor");
    }
    const expectedAuthorityEpoch = this.#state.authorityEpoch;
    this.#state = {
      ...this.#state,
      activeExecutorNodeId: continuationExecutorNodeId,
      authorityEpoch: expectedAuthorityEpoch + 1,
      mode: "temporary-fallback",
      workspaceAttached: false,
    };
    return this.#transition([
      ...effects,
      {
        type: "transfer-run-authority",
        expectedAuthorityEpoch,
        nextAuthorityEpoch: expectedAuthorityEpoch + 1,
        targetExecutorNodeId: continuationExecutorNodeId,
        reason: "fallback",
      },
      {
        type: "workspace-binding-changed",
        workspaceId: this.#state.workspaceId,
        binding: "temporarily-detached",
      },
    ]);
  }

  #exit(
    continuationExecutorNodeId: string | null,
    effects: readonly WorkspaceRecoveryEffect[],
  ): WorkspaceRecoveryTransition {
    if (continuationExecutorNodeId === null) {
      throw new Error("Workspace exit requires a continuation executor");
    }
    const expectedAuthorityEpoch = this.#state.authorityEpoch;
    const changesExecutor =
      continuationExecutorNodeId !== this.#state.activeExecutorNodeId;
    this.#state = {
      ...this.#state,
      activeExecutorNodeId: continuationExecutorNodeId,
      authorityEpoch: changesExecutor
        ? expectedAuthorityEpoch + 1
        : expectedAuthorityEpoch,
      mode: "exited",
      workspaceAttached: false,
    };
    const transitionEffects: WorkspaceRecoveryEffect[] = [...effects];
    if (changesExecutor) {
      transitionEffects.push({
        type: "transfer-run-authority",
        expectedAuthorityEpoch,
        nextAuthorityEpoch: expectedAuthorityEpoch + 1,
        targetExecutorNodeId: continuationExecutorNodeId,
        reason: "workspace-exit",
      });
    }
    transitionEffects.push({
      type: "workspace-binding-changed",
      workspaceId: this.#state.workspaceId,
      binding: "exited",
    });
    return this.#transition(transitionEffects);
  }

  #availableActions(
    context: ExecutorUnavailableContext,
  ): readonly WorkspaceRecoveryAction[] {
    return this.#canContinue(context) ? ["wait", "fallback", "exit"] : ["wait"];
  }

  #canContinue(context: ExecutorUnavailableContext): boolean {
    return (
      context.egressAllowsFallback &&
      context.continuationExecutorNodeId !== null
    );
  }

  #transition(
    effects: readonly WorkspaceRecoveryEffect[],
  ): WorkspaceRecoveryTransition {
    return {
      state: this.state(),
      availableActions:
        this.#state.mode === "decision-required"
          ? (effects.find(
              (effect) => effect.type === "request-recovery-decision",
            )?.actions ?? [])
          : [],
      effects: structuredClone(effects),
    };
  }
}
