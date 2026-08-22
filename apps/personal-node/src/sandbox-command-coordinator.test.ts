import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { DurableSandboxCommandExecutor } from "./sandbox-command-coordinator.js";
import { SqliteSandboxCommandStore } from "./sandbox-command-store.js";
import { buildDockerSandboxPlan } from "./sandbox-container-contract.js";
import {
  DockerSandboxLifecycle,
  type SandboxContainerEngine,
  type SandboxContainerObservation,
  type SandboxCommandResult,
} from "./sandbox-container-lifecycle.js";

const plan = buildDockerSandboxPlan({
  nodeId: "node-workstation",
  runId: "run-1",
  image:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceSourceRealpath: "/srv/llame/worktrees/run-1",
  user: "1000:1000",
});
const command = {
  realmId: "realm-personal",
  runId: "run-1",
  executorNodeId: "node-workstation",
  authorityEpoch: 3,
  commandId: "tool-call-1",
  request: { command: "git", args: ["status", "--short"] },
};
const result = { exitCode: 0, stdout: "clean\n", stderr: "" };

function observation(): SandboxContainerObservation {
  return {
    containerName: plan.containerName,
    image: plan.image,
    running: true,
    nodeId: plan.nodeId,
    runId: plan.runId,
    user: plan.user,
    workspaceSourceRealpath: plan.workspaceSourceRealpath,
    homeVolumeName: plan.homeVolumeName,
    security: {
      networkMode: plan.security.networkMode,
      ipcMode: plan.security.ipcMode,
      cgroupNamespace: plan.security.cgroupNamespace,
      droppedCapabilities: [plan.security.droppedCapabilities],
      securityOptions: ["no-new-privileges"],
      readOnlyRoot: plan.security.readOnlyRoot,
      pidsLimit: plan.security.pidsLimit,
    },
  };
}

function engine(
  execute: SandboxContainerEngine["execute"],
  inspect: SandboxContainerEngine["inspect"] = async () => observation(),
): SandboxContainerEngine {
  return {
    inspect,
    create: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    execute,
  };
}

describe("durable Sandbox command execution", () => {
  const temporaryDirectories: string[] = [];
  const stores: SqliteSandboxCommandStore[] = [];

  afterEach(async () => {
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function receipts(): Promise<SqliteSandboxCommandStore> {
    const directory = await mkdtemp(join(tmpdir(), "llame-command-executor-"));
    temporaryDirectories.push(directory);
    const store = new SqliteSandboxCommandStore({
      databasePath: join(directory, "node.sqlite"),
      realmId: "realm-personal",
    });
    stores.push(store);
    return store;
  }

  test("executes once and replays the durable completed receipt", async () => {
    const execute = vi.fn(async () => result);
    const coordinator = new DurableSandboxCommandExecutor(
      new DockerSandboxLifecycle(engine(execute)),
      await receipts(),
    );

    await expect(coordinator.execute(plan, command)).resolves.toMatchObject({
      disposition: "executed",
      receipt: { status: "completed", result },
    });
    await expect(coordinator.execute(plan, command)).resolves.toMatchObject({
      disposition: "replayed",
      receipt: { status: "completed", result },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("releases a reservation when Sandbox preparation fails", async () => {
    let running = false;
    const execute = vi.fn(async () => result);
    const coordinator = new DurableSandboxCommandExecutor(
      new DockerSandboxLifecycle(
        engine(execute, async () => (running ? observation() : null)),
      ),
      await receipts(),
    );

    await expect(coordinator.execute(plan, command)).rejects.toThrowError(
      "Sandbox container is not running",
    );
    running = true;
    await expect(coordinator.execute(plan, command)).resolves.toMatchObject({
      disposition: "executed",
      receipt: { status: "completed" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("settles an ambiguous execution once as outcome_unknown", async () => {
    const execute = vi.fn(async () => {
      throw new Error("Docker connection lost");
    });
    const coordinator = new DurableSandboxCommandExecutor(
      new DockerSandboxLifecycle(engine(execute)),
      await receipts(),
    );

    await expect(coordinator.execute(plan, command)).resolves.toMatchObject({
      disposition: "executed",
      receipt: { status: "outcome_unknown" },
    });
    await expect(coordinator.execute(plan, command)).resolves.toMatchObject({
      disposition: "replayed",
      receipt: { status: "outcome_unknown" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("reports an exact concurrent duplicate as in-progress", async () => {
    let settle: ((value: SandboxCommandResult) => void) | undefined;
    const execute = vi.fn(
      async () =>
        new Promise<SandboxCommandResult>((resolve) => {
          settle = resolve;
        }),
    );
    const coordinator = new DurableSandboxCommandExecutor(
      new DockerSandboxLifecycle(engine(execute)),
      await receipts(),
    );
    const first = coordinator.execute(plan, command);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    await expect(coordinator.execute(plan, command)).resolves.toEqual({
      disposition: "in-progress",
    });
    if (settle === undefined) throw new Error("command did not start");
    settle(result);
    await expect(first).resolves.toMatchObject({
      disposition: "executed",
      receipt: { status: "completed" },
    });
  });

  test("rejects identity that does not match the Sandbox plan", async () => {
    const store = await receipts();
    const coordinator = new DurableSandboxCommandExecutor(
      new DockerSandboxLifecycle(engine(vi.fn(async () => result))),
      store,
    );
    const mismatched = { ...command, executorNodeId: "node-other" };

    await expect(coordinator.execute(plan, mismatched)).rejects.toThrowError(
      "Sandbox command identity does not match its plan",
    );
    expect(store.reserve(mismatched)).toEqual({ status: "reserved" });
  });
});
