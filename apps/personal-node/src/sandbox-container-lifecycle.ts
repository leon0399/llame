import type {
  DockerSandboxPlan,
  DockerSandboxSecurityContract,
} from "./sandbox-container-contract.js";

export interface SandboxContainerObservation {
  readonly containerName: string;
  readonly image: string;
  readonly running: boolean;
  readonly nodeId: string;
  readonly runId: string;
  readonly user: string;
  readonly workspaceSourceRealpath: string;
  readonly homeVolumeName: string;
  readonly security: DockerSandboxSecurityContract;
}

export interface SandboxContainerEngine {
  inspect(containerName: string): Promise<SandboxContainerObservation | null>;
  create(arguments_: readonly string[]): Promise<void>;
  start(containerName: string): Promise<void>;
  remove(containerName: string): Promise<void>;
}

export interface RunningSandbox {
  readonly containerName: string;
  readonly state: "running";
}

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
    observed: DockerSandboxSecurityContract,
    expected: DockerSandboxSecurityContract,
  ): boolean {
    return (
      observed.networkMode === expected.networkMode &&
      observed.ipcMode === expected.ipcMode &&
      observed.cgroupNamespace === expected.cgroupNamespace &&
      observed.droppedCapabilities === expected.droppedCapabilities &&
      observed.noNewPrivileges === expected.noNewPrivileges &&
      observed.readOnlyRoot === expected.readOnlyRoot &&
      observed.pidsLimit === expected.pidsLimit
    );
  }
}
