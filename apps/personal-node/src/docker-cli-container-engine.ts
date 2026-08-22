import { execFile } from "node:child_process";

import { z } from "zod";

import type {
  SandboxContainerEngine,
  SandboxContainerObservation,
  SandboxCommandResult,
} from "./sandbox-container-lifecycle.js";
import {
  isContentAddressedSandboxImage,
  isNumericNonRootSandboxUser,
  validateSandboxCommandRequest,
} from "./sandbox-container-contract.js";

const CONTAINER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const inspectSchema = z
  .array(
    z.object({
      Name: z.string(),
      State: z.object({ Running: z.boolean() }),
      Config: z.object({
        Image: z.string(),
        User: z.string(),
        Labels: z.record(z.string(), z.string()).nullable(),
      }),
      HostConfig: z.object({
        NetworkMode: z.string(),
        IpcMode: z.string(),
        CgroupnsMode: z.string(),
        CapDrop: z.array(z.string()).nullable(),
        SecurityOpt: z.array(z.string()).nullable(),
        ReadonlyRootfs: z.boolean(),
        PidsLimit: z.number().nullable(),
      }),
      Mounts: z.array(
        z.object({
          Type: z.string(),
          Source: z.string().optional(),
          Destination: z.string(),
          Name: z.string().optional(),
          RW: z.boolean(),
        }),
      ),
    }),
  )
  .length(1);

export type DockerCommandExecutor = (
  arguments_: readonly string[],
) => Promise<{ readonly stdout: string }>;

export type DockerSandboxCommandExecutor = (
  arguments_: readonly string[],
) => Promise<SandboxCommandResult>;

export class SandboxExecutionBoundaryError extends Error {
  public constructor() {
    super("Sandbox execution boundary exceeded");
    this.name = "SandboxExecutionBoundaryError";
  }
}

export class DockerCliContainerEngine implements SandboxContainerEngine {
  readonly #execute: DockerCommandExecutor;
  readonly #executeSandbox: DockerSandboxCommandExecutor;

  public constructor(
    execute: DockerCommandExecutor = executeDocker,
    executeSandbox: DockerSandboxCommandExecutor = executeDockerSandboxCommand,
  ) {
    this.#execute = execute;
    this.#executeSandbox = executeSandbox;
  }

  public async inspect(
    containerName: string,
  ): Promise<SandboxContainerObservation | null> {
    validateContainerName(containerName);
    const escapedName = containerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const listed = await this.#execute([
      "container",
      "ls",
      "--all",
      "--filter",
      `name=^/${escapedName}$`,
      "--format",
      "{{.Names}}",
    ]);
    if (listed.stdout.trim().length === 0) return null;
    if (listed.stdout.trim() !== containerName) {
      throw new Error("Docker returned an ambiguous Sandbox container name");
    }
    const inspected = await this.#execute([
      "container",
      "inspect",
      containerName,
    ]);
    const [container] = inspectSchema.parse(JSON.parse(inspected.stdout));
    if (container === undefined) throw new Error("Docker inspection is empty");
    const workspace = container.Mounts.find(
      (mount) =>
        mount.Type === "bind" && mount.Destination === "/workspace" && mount.RW,
    );
    const home = container.Mounts.find(
      (mount) =>
        mount.Type === "volume" &&
        mount.Destination === "/home/llame" &&
        mount.RW,
    );
    return {
      containerName: container.Name.replace(/^\//, ""),
      image: container.Config.Image,
      running: container.State.Running,
      nodeId: container.Config.Labels?.["dev.llame.node-id"] ?? "",
      runId: container.Config.Labels?.["dev.llame.run-id"] ?? "",
      user: container.Config.User,
      workspaceSourceRealpath: workspace?.Source ?? "",
      homeVolumeName: home?.Name ?? "",
      security: {
        networkMode: container.HostConfig.NetworkMode,
        ipcMode: container.HostConfig.IpcMode,
        cgroupNamespace: container.HostConfig.CgroupnsMode,
        droppedCapabilities: container.HostConfig.CapDrop ?? [],
        securityOptions: container.HostConfig.SecurityOpt ?? [],
        readOnlyRoot: container.HostConfig.ReadonlyRootfs,
        pidsLimit: container.HostConfig.PidsLimit,
      },
    };
  }

  public async create(arguments_: readonly string[]): Promise<void> {
    if (arguments_[0] !== "create") {
      throw new Error("invalid Docker Sandbox create command");
    }
    await this.#execute(arguments_);
  }

  public async assertImageAvailable(image: string): Promise<void> {
    if (!isContentAddressedSandboxImage(image)) {
      throw new Error("Sandbox image must use a sha256 digest");
    }
    await this.#execute(["image", "inspect", image]);
  }

  public async start(containerName: string): Promise<void> {
    validateContainerName(containerName);
    await this.#execute(["container", "start", containerName]);
  }

  public async remove(containerName: string): Promise<void> {
    validateContainerName(containerName);
    await this.#execute(["container", "rm", "--force", containerName]);
  }

  public async execute(
    arguments_: readonly string[],
  ): Promise<SandboxCommandResult> {
    const containerName = validateSandboxExecArguments(arguments_);
    try {
      return await this.#executeSandbox(arguments_);
    } catch (error) {
      if (!(error instanceof SandboxExecutionBoundaryError)) throw error;
      try {
        await this.remove(containerName);
      } catch (removalError) {
        throw new AggregateError(
          [error, removalError],
          "Sandbox command boundary breached and container teardown failed",
        );
      }
      throw new Error("Sandbox command exceeded execution boundary", {
        cause: error,
      });
    }
  }
}

function validateContainerName(containerName: string): void {
  if (!CONTAINER_NAME_PATTERN.test(containerName)) {
    throw new Error("invalid Docker Sandbox container name");
  }
}

function validateSandboxExecArguments(arguments_: readonly string[]): string {
  const [container, exec, workdirFlag, workdir, userFlag, user, name, command] =
    arguments_;
  if (
    container !== "container" ||
    exec !== "exec" ||
    workdirFlag !== "--workdir" ||
    workdir !== "/workspace" ||
    userFlag !== "--user" ||
    user === undefined ||
    !isNumericNonRootSandboxUser(user) ||
    name === undefined ||
    command === undefined
  ) {
    throw new Error("invalid Docker Sandbox exec command");
  }
  validateContainerName(name);
  validateSandboxCommandRequest({ command, args: arguments_.slice(8) });
  return name;
}

function executeDocker(
  arguments_: readonly string[],
): Promise<{ readonly stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      [...arguments_],
      { maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve({ stdout });
      },
    );
  });
}

function executeDockerSandboxCommand(
  arguments_: readonly string[],
): Promise<SandboxCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      [...arguments_],
      { maxBuffer: 256 * 1024, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        if (
          error.killed ||
          error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ) {
          reject(new SandboxExecutionBoundaryError());
          return;
        }
        if (typeof error.code === "number") {
          resolve({ exitCode: error.code, stdout, stderr });
          return;
        }
        reject(error);
      },
    );
  });
}
