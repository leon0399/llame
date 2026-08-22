import type {
  SandboxCommandAuthority,
  SandboxCommandIdentity,
  SandboxCommandReceipt,
  SqliteSandboxCommandStore,
} from "./sandbox-command-store.js";
import type { DockerSandboxPlan } from "./sandbox-container-contract.js";
import type { DockerSandboxLifecycle } from "./sandbox-container-lifecycle.js";

type SandboxCommandReceiptStore = Pick<
  SqliteSandboxCommandStore,
  | "reserve"
  | "release"
  | "complete"
  | "markOutcomeUnknown"
  | "authorityActivity"
  | "containOutcomeUnknown"
>;

export class SandboxCommandInFlightError extends Error {
  public constructor() {
    super("Sandbox command is still in flight");
    this.name = "SandboxCommandInFlightError";
  }
}

export class SandboxCommandOutcomeUnknownError extends Error {
  public constructor() {
    super("Sandbox command outcome is unknown");
    this.name = "SandboxCommandOutcomeUnknownError";
  }
}

export class SandboxCommandTransitionInProgressError extends Error {
  public constructor() {
    super("Sandbox command authority transition is in progress");
    this.name = "SandboxCommandTransitionInProgressError";
  }
}

export interface PreparedSandboxAuthorityTransfer {
  release(): void;
}

export interface PreparedSandboxExit {
  complete(): void;
  abort(): void;
}

export type DurableSandboxCommandExecution =
  | { readonly disposition: "in-progress" }
  | {
      readonly disposition: "executed" | "replayed";
      readonly receipt: SandboxCommandReceipt;
    };

export class DurableSandboxCommandExecutor {
  readonly #lifecycle: DockerSandboxLifecycle;
  readonly #receipts: SandboxCommandReceiptStore;
  readonly #transitions = new Set<string>();

  public constructor(
    lifecycle: DockerSandboxLifecycle,
    receipts: SandboxCommandReceiptStore,
  ) {
    this.#lifecycle = lifecycle;
    this.#receipts = receipts;
  }

  public async execute(
    plan: DockerSandboxPlan,
    input: SandboxCommandIdentity,
  ): Promise<DurableSandboxCommandExecution> {
    if (input.runId !== plan.runId || input.executorNodeId !== plan.nodeId) {
      throw new Error("Sandbox command identity does not match its plan");
    }
    if (this.#transitions.has(this.#transitionKey(input))) {
      throw new SandboxCommandTransitionInProgressError();
    }
    const reservation = this.#receipts.reserve(input);
    if (reservation.status === "in-progress") {
      return { disposition: "in-progress" };
    }
    if (reservation.status !== "reserved") {
      return { disposition: "replayed", receipt: reservation };
    }
    let prepared: Awaited<
      ReturnType<DockerSandboxLifecycle["prepareExecution"]>
    >;
    try {
      prepared = await this.#lifecycle.prepareExecution(plan, input.request);
    } catch (error) {
      try {
        this.#receipts.release(input);
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          "Sandbox command preparation and reservation release failed",
        );
      }
      throw error;
    }
    try {
      const result = await prepared.execute();
      return {
        disposition: "executed",
        receipt: this.#receipts.complete(input, result),
      };
    } catch (error) {
      try {
        return {
          disposition: "executed",
          receipt: this.#receipts.markOutcomeUnknown(input),
        };
      } catch (settlementError) {
        throw new AggregateError(
          [error, settlementError],
          "Sandbox command execution settlement failed",
        );
      }
    }
  }

  public prepareAuthorityTransfer(
    input: SandboxCommandAuthority,
  ): PreparedSandboxAuthorityTransfer {
    const key = this.#prepareTransition(input, false);
    let active = true;
    return {
      release: () => {
        if (!active) return;
        active = false;
        this.#transitions.delete(key);
      },
    };
  }

  public prepareSandboxExit(
    input: SandboxCommandAuthority,
  ): PreparedSandboxExit {
    const key = this.#prepareTransition(input, true);
    let active = true;
    return {
      complete: () => {
        if (!active) return;
        this.#receipts.containOutcomeUnknown(input);
        active = false;
        this.#transitions.delete(key);
      },
      abort: () => {
        if (!active) return;
        active = false;
        this.#transitions.delete(key);
      },
    };
  }

  #prepareTransition(
    input: SandboxCommandAuthority,
    allowsOutcomeUnknown: boolean,
  ): string {
    const key = this.#transitionKey(input);
    if (this.#transitions.has(key)) {
      throw new SandboxCommandTransitionInProgressError();
    }
    const activity = this.#receipts.authorityActivity(input);
    if (activity === "in-progress") throw new SandboxCommandInFlightError();
    if (activity === "outcome_unknown" && !allowsOutcomeUnknown) {
      throw new SandboxCommandOutcomeUnknownError();
    }
    this.#transitions.add(key);
    return key;
  }

  #transitionKey(input: SandboxCommandAuthority): string {
    return JSON.stringify([
      input.realmId,
      input.runId,
      input.executorNodeId,
      input.authorityEpoch,
    ]);
  }
}
