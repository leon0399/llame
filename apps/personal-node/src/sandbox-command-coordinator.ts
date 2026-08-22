import type {
  SandboxCommandIdentity,
  SandboxCommandReceipt,
  SqliteSandboxCommandStore,
} from "./sandbox-command-store.js";
import type { DockerSandboxPlan } from "./sandbox-container-contract.js";
import type { DockerSandboxLifecycle } from "./sandbox-container-lifecycle.js";

type SandboxCommandReceiptStore = Pick<
  SqliteSandboxCommandStore,
  "reserve" | "release" | "complete" | "markOutcomeUnknown"
>;

export type DurableSandboxCommandExecution =
  | { readonly disposition: "in-progress" }
  | {
      readonly disposition: "executed" | "replayed";
      readonly receipt: SandboxCommandReceipt;
    };

export class DurableSandboxCommandExecutor {
  readonly #lifecycle: DockerSandboxLifecycle;
  readonly #receipts: SandboxCommandReceiptStore;

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
}
