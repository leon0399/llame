import { describe, expect, test, vi } from "vitest";

import { buildDockerSandboxPlan } from "./sandbox-container-contract.js";
import {
  DockerSandboxLifecycle,
  type SandboxContainerEngine,
  type SandboxContainerObservation,
} from "./sandbox-container-lifecycle.js";

const plan = buildDockerSandboxPlan({
  nodeId: "desktop",
  runId: "run-42",
  image:
    "registry.example/llame/sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceSourceRealpath: "/srv/llame/worktrees/run-42",
  user: "1000:1000",
});

function observation(
  override: Partial<SandboxContainerObservation> = {},
): SandboxContainerObservation {
  return {
    containerName: plan.containerName,
    image: plan.image,
    running: false,
    nodeId: "desktop",
    runId: "run-42",
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
    ...override,
  };
}

function engine(
  inspect: SandboxContainerEngine["inspect"],
): SandboxContainerEngine {
  return {
    inspect,
    create: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    execute: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
  };
}

describe("Docker Sandbox lifecycle", () => {
  test("creates and starts a missing Sandbox", async () => {
    const inspect = vi
      .fn<SandboxContainerEngine["inspect"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(observation())
      .mockResolvedValueOnce(observation({ running: true }));
    const containerEngine = engine(inspect);

    await expect(
      new DockerSandboxLifecycle(containerEngine).enter(plan),
    ).resolves.toEqual({
      containerName: plan.containerName,
      state: "running",
    });
    expect(containerEngine.create).toHaveBeenCalledWith(plan.createArguments);
    expect(containerEngine.start).toHaveBeenCalledWith(plan.containerName);
  });

  test("resumes an interrupted existing Sandbox without recreating it", async () => {
    const inspect = vi
      .fn<SandboxContainerEngine["inspect"]>()
      .mockResolvedValueOnce(observation())
      .mockResolvedValueOnce(observation({ running: true }));
    const containerEngine = engine(inspect);

    await new DockerSandboxLifecycle(containerEngine).enter(plan);

    expect(containerEngine.create).not.toHaveBeenCalled();
    expect(containerEngine.start).toHaveBeenCalledWith(plan.containerName);
  });

  test("recovers a concurrent create only when the resulting container matches", async () => {
    const inspect = vi
      .fn<SandboxContainerEngine["inspect"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(observation())
      .mockResolvedValueOnce(observation({ running: true }));
    const containerEngine = engine(inspect);
    vi.mocked(containerEngine.create).mockRejectedValueOnce(
      new Error("name conflict"),
    );

    await expect(
      new DockerSandboxLifecycle(containerEngine).enter(plan),
    ).resolves.toMatchObject({ state: "running" });
  });

  test("rejects a same-name container with a different Workspace", async () => {
    const containerEngine = engine(async () =>
      observation({ workspaceSourceRealpath: "/srv/other" }),
    );

    await expect(
      new DockerSandboxLifecycle(containerEngine).enter(plan),
    ).rejects.toThrowError("Sandbox container contract mismatch");
    expect(containerEngine.start).not.toHaveBeenCalled();
    expect(containerEngine.remove).not.toHaveBeenCalled();
  });

  test("rejects a same-name container with weaker isolation", async () => {
    const unsafe = observation();
    const containerEngine = engine(async () => ({
      ...unsafe,
      security: { ...unsafe.security, networkMode: "bridge" },
    }));

    await expect(
      new DockerSandboxLifecycle(containerEngine).enter(plan),
    ).rejects.toThrowError("Sandbox container contract mismatch");
    expect(containerEngine.start).not.toHaveBeenCalled();
  });

  test("removes only a matching container on exit", async () => {
    const inspect = vi
      .fn<SandboxContainerEngine["inspect"]>()
      .mockResolvedValueOnce(observation({ running: true }))
      .mockResolvedValueOnce(null);
    const containerEngine = engine(inspect);

    await new DockerSandboxLifecycle(containerEngine).exit(plan);

    expect(containerEngine.remove).toHaveBeenCalledWith(plan.containerName);
  });

  test("observes a matching Sandbox without changing it", async () => {
    const containerEngine = engine(async () => observation({ running: true }));

    await expect(
      new DockerSandboxLifecycle(containerEngine).status(plan),
    ).resolves.toEqual({
      containerName: plan.containerName,
      state: "running",
    });
    expect(containerEngine.start).not.toHaveBeenCalled();
    expect(containerEngine.remove).not.toHaveBeenCalled();
  });

  test("executes argv only inside the matching running Sandbox", async () => {
    const containerEngine = engine(async () => observation({ running: true }));
    vi.mocked(containerEngine.execute).mockResolvedValueOnce({
      exitCode: 2,
      stdout: "working tree output",
      stderr: "ordinary command failure",
    });

    await expect(
      new DockerSandboxLifecycle(containerEngine).execute(plan, {
        command: "git",
        args: ["status", "--short"],
      }),
    ).resolves.toEqual({
      exitCode: 2,
      stdout: "working tree output",
      stderr: "ordinary command failure",
    });
    expect(containerEngine.execute).toHaveBeenCalledWith([
      "container",
      "exec",
      "--workdir",
      "/workspace",
      "--user",
      "1000:1000",
      plan.containerName,
      "git",
      "status",
      "--short",
    ]);
  });

  test.each([
    ["absent", null],
    ["stopped", observation()],
    [
      "mismatched",
      observation({ running: true, workspaceSourceRealpath: "/srv/other" }),
    ],
  ])("refuses command execution for an %s Sandbox", async (_name, observed) => {
    const containerEngine = engine(async () => observed);

    await expect(
      new DockerSandboxLifecycle(containerEngine).execute(plan, {
        command: "git",
        args: ["status"],
      }),
    ).rejects.toThrow();
    expect(containerEngine.execute).not.toHaveBeenCalled();
  });
});
