import {
  buildDockerSandboxCommandArguments,
  type DockerSandboxPlan,
  type SandboxCommandRequest,
} from "./sandbox-container-contract.js";

export interface ObservedSandboxSecurity {
  readonly networkMode: string;
  readonly ipcMode: string;
  readonly cgroupNamespace: string;
  readonly droppedCapabilities: readonly string[];
  readonly securityOptions: readonly string[];
  readonly readOnlyRoot: boolean;
  readonly pidsLimit: number | null;
}

export interface SandboxContainerObservation {
  readonly containerName: string;
  readonly image: string;
  readonly running: boolean;
  readonly nodeId: string;
  readonly runId: string;
  readonly user: string;
  readonly workspaceSourceRealpath: string;
  readonly homeVolumeName: string;
  readonly security: ObservedSandboxSecurity;
}

export interface SandboxContainerEngine {
  inspect(containerName: string): Promise<SandboxContainerObservation | null>;
  create(arguments_: readonly string[]): Promise<void>;
  start(containerName: string): Promise<void>;
  remove(containerName: string): Promise<void>;
  execute(arguments_: readonly string[]): Promise<SandboxCommandResult>;
}

export interface SandboxCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface PreparedSandboxCommand {
  execute(): Promise<SandboxCommandResult>;
}

export interface RunningSandbox {
  readonly containerName: string;
  readonly state: "running";
}

export type SandboxStatus =
  | RunningSandbox
  | { readonly containerName: string; readonly state: "stopped" }
  | { readonly state: "absent" };

export class DockerSandboxLifecycle {
  readonly #engine: SandboxContainerEngine;

  public constructor(engine: SandboxContainerEngine) {
    this.#engine = engine;
  }

  public async enter(plan: DockerSandboxPlan): Promise<RunningSandbox> {
    let observed = await this.#engine.inspect(plan.containerName);
    if (observed === null) {
      try {
        await this.#engine.create(plan.createArguments);
      } catch (error) {
        observed = await this.#engine.inspect(plan.containerName);
        if (observed === null) throw error;
      }
      observed ??= await this.#engine.inspect(plan.containerName);
      if (observed === null) {
        throw new Error("Sandbox container creation outcome is unknown");
      }
    }
    this.#assertMatches(plan, observed);
    if (!observed.running) {
      await this.#engine.start(plan.containerName);
      observed = await this.#engine.inspect(plan.containerName);
      if (observed === null) {
        throw new Error("Sandbox container disappeared after start");
      }
      this.#assertMatches(plan, observed);
      if (!observed.running) {
        throw new Error("Sandbox container did not reach running state");
      }
    }
    return { containerName: plan.containerName, state: "running" };
  }

  public async exit(plan: DockerSandboxPlan): Promise<void> {
    const observed = await this.#engine.inspect(plan.containerName);
    if (observed === null) return;
    this.#assertMatches(plan, observed);
    await this.#engine.remove(plan.containerName);
    if ((await this.#engine.inspect(plan.containerName)) !== null) {
      throw new Error("Sandbox container still exists after removal");
    }
  }

  public async status(plan: DockerSandboxPlan): Promise<SandboxStatus> {
    const observed = await this.#engine.inspect(plan.containerName);
    if (observed === null) return { state: "absent" };
    this.#assertMatches(plan, observed);
    return {
      containerName: plan.containerName,
      state: observed.running ? "running" : "stopped",
    };
  }

  public async execute(
    plan: DockerSandboxPlan,
    request: SandboxCommandRequest,
  ): Promise<SandboxCommandResult> {
    return (await this.prepareExecution(plan, request)).execute();
  }

  public async prepareExecution(
    plan: DockerSandboxPlan,
    request: SandboxCommandRequest,
  ): Promise<PreparedSandboxCommand> {
    const arguments_ = buildDockerSandboxCommandArguments(plan, request);
    const observed = await this.#engine.inspect(plan.containerName);
    if (observed === null) {
      throw new Error("Sandbox container is not running");
    }
    this.#assertMatches(plan, observed);
    if (!observed.running) {
      throw new Error("Sandbox container is not running");
    }
    let executed = false;
    return {
      execute: async () => {
        if (executed) throw new Error("Sandbox command was already executed");
        executed = true;
        return this.#engine.execute(arguments_);
      },
    };
  }

  #assertMatches(
    plan: DockerSandboxPlan,
    observed: SandboxContainerObservation,
  ): void {
    const matches =
      observed.containerName === plan.containerName &&
      observed.image === plan.image &&
      observed.nodeId === plan.nodeId &&
      observed.runId === plan.runId &&
      observed.user === plan.user &&
      observed.workspaceSourceRealpath === plan.workspaceSourceRealpath &&
      observed.homeVolumeName === plan.homeVolumeName &&
      this.#securityMatches(observed.security, plan.security);
    if (!matches) throw new Error("Sandbox container contract mismatch");
  }

  #securityMatches(
    observed: ObservedSandboxSecurity,
    expected: DockerSandboxPlan["security"],
  ): boolean {
    return (
      observed.networkMode === expected.networkMode &&
      observed.ipcMode === expected.ipcMode &&
      observed.cgroupNamespace === expected.cgroupNamespace &&
      observed.droppedCapabilities.length === 1 &&
      observed.droppedCapabilities[0]?.toUpperCase() ===
        expected.droppedCapabilities &&
      observed.securityOptions.some((option) =>
        ["no-new-privileges", "no-new-privileges=true"].includes(option),
      ) === expected.noNewPrivileges &&
      observed.readOnlyRoot === expected.readOnlyRoot &&
      observed.pidsLimit === expected.pidsLimit
    );
  }
}
