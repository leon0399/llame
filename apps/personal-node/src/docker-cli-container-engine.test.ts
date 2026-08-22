import { describe, expect, test, vi } from "vitest";

import {
  DockerCliContainerEngine,
  SandboxExecutionBoundaryError,
} from "./docker-cli-container-engine.js";

describe("Docker CLI container engine", () => {
  test("inspects the exact container into untrusted observed state", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "llame-desktop-run-42\n" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            Name: "/llame-desktop-run-42",
            State: { Running: true },
            Config: {
              Image:
                "registry.example/llame/sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              User: "1000:1000",
              Labels: {
                "dev.llame.node-id": "desktop",
                "dev.llame.run-id": "run-42",
              },
            },
            HostConfig: {
              NetworkMode: "none",
              IpcMode: "private",
              CgroupnsMode: "private",
              CapDrop: ["ALL"],
              SecurityOpt: ["no-new-privileges"],
              ReadonlyRootfs: true,
              PidsLimit: 512,
            },
            Mounts: [
              {
                Type: "bind",
                Source: "/srv/llame/worktrees/run-42",
                Destination: "/workspace",
                RW: true,
              },
              {
                Type: "volume",
                Name: "llame-home-desktop-run-42",
                Destination: "/home/llame",
                RW: true,
              },
            ],
          },
        ]),
      });

    await expect(
      new DockerCliContainerEngine(execute).inspect("llame-desktop-run-42"),
    ).resolves.toEqual({
      containerName: "llame-desktop-run-42",
      image:
        "registry.example/llame/sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      running: true,
      nodeId: "desktop",
      runId: "run-42",
      user: "1000:1000",
      workspaceSourceRealpath: "/srv/llame/worktrees/run-42",
      homeVolumeName: "llame-home-desktop-run-42",
      security: {
        networkMode: "none",
        ipcMode: "private",
        cgroupNamespace: "private",
        droppedCapabilities: ["ALL"],
        securityOptions: ["no-new-privileges"],
        readOnlyRoot: true,
        pidsLimit: 512,
      },
    });
    expect(execute).toHaveBeenNthCalledWith(1, [
      "container",
      "ls",
      "--all",
      "--filter",
      "name=^/llame-desktop-run-42$",
      "--format",
      "{{.Names}}",
    ]);
    expect(execute).toHaveBeenNthCalledWith(2, [
      "container",
      "inspect",
      "llame-desktop-run-42",
    ]);
  });

  test("returns null without inspecting when the exact name is absent", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "" });

    await expect(
      new DockerCliContainerEngine(execute).inspect("llame-desktop-run-42"),
    ).resolves.toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("executes only fixed lifecycle commands", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "" });
    const engine = new DockerCliContainerEngine(execute);
    const createArguments = ["create", "--name", "llame-desktop-run-42"];

    await engine.create(createArguments);
    await engine.start("llame-desktop-run-42");
    await engine.remove("llame-desktop-run-42");

    expect(execute.mock.calls).toEqual([
      [createArguments],
      [["container", "start", "llame-desktop-run-42"]],
      [["container", "rm", "--force", "llame-desktop-run-42"]],
    ]);
  });

  test("preflights an exact local image without pulling it", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "[]" });
    const image =
      "registry.example/llame/sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    await new DockerCliContainerEngine(execute).assertImageAvailable(image);

    expect(execute).toHaveBeenCalledWith(["image", "inspect", image]);
  });

  test("returns an ordinary nonzero Sandbox command outcome", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "" });
    const executeSandbox = vi.fn().mockResolvedValue({
      exitCode: 17,
      stdout: "partial output",
      stderr: "command failed",
    });
    const arguments_ = [
      "container",
      "exec",
      "--workdir",
      "/workspace",
      "--user",
      "1000:1000",
      "llame-desktop-run-42",
      "git",
      "status",
    ];

    await expect(
      new DockerCliContainerEngine(execute, executeSandbox).execute(arguments_),
    ).resolves.toEqual({
      exitCode: 17,
      stdout: "partial output",
      stderr: "command failed",
    });
    expect(executeSandbox).toHaveBeenCalledWith(arguments_);
    expect(execute).not.toHaveBeenCalled();
  });

  test("tears down the Sandbox when an execution boundary is breached", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "" });
    const executeSandbox = vi
      .fn()
      .mockRejectedValue(new SandboxExecutionBoundaryError());
    const arguments_ = [
      "container",
      "exec",
      "--workdir",
      "/workspace",
      "--user",
      "1000:1000",
      "llame-desktop-run-42",
      "git",
      "status",
    ];

    await expect(
      new DockerCliContainerEngine(execute, executeSandbox).execute(arguments_),
    ).rejects.toThrowError("Sandbox command exceeded execution boundary");
    expect(execute).toHaveBeenCalledWith([
      "container",
      "rm",
      "--force",
      "llame-desktop-run-42",
    ]);
  });
});
