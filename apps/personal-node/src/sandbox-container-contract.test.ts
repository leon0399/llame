import { describe, expect, test } from "vitest";

import {
  buildDockerSandboxCommandArguments,
  buildDockerSandboxPlan,
} from "./sandbox-container-contract.js";

describe("Docker Sandbox launch contract", () => {
  test("builds a locked-down launch plan around one registered Workspace", () => {
    expect(
      buildDockerSandboxPlan({
        nodeId: "desktop",
        runId: "run-42",
        image:
          "registry.example/llame/sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        workspaceSourceRealpath: "/srv/llame/worktrees/run-42",
        user: "1000:1000",
      }),
    ).toEqual({
      nodeId: "desktop",
      runId: "run-42",
      containerName: "llame-desktop-run-42",
      workspaceTarget: "/workspace",
      homeVolumeName: "llame-home-desktop-run-42",
      image:
        "registry.example/llame/sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceSourceRealpath: "/srv/llame/worktrees/run-42",
      user: "1000:1000",
      security: {
        networkMode: "none",
        ipcMode: "private",
        cgroupNamespace: "private",
        droppedCapabilities: "ALL",
        noNewPrivileges: true,
        readOnlyRoot: true,
        pidsLimit: 512,
      },
      createArguments: [
        "create",
        "--name",
        "llame-desktop-run-42",
        "--label",
        "dev.llame.node-id=desktop",
        "--label",
        "dev.llame.run-id=run-42",
        "--pull",
        "never",
        "--network",
        "none",
        "--ipc",
        "private",
        "--cgroupns",
        "private",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges=true",
        "--read-only",
        "--init",
        "--pids-limit",
        "512",
        "--user",
        "1000:1000",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev",
        "--mount",
        "type=bind,src=/srv/llame/worktrees/run-42,dst=/workspace",
        "--mount",
        "type=volume,src=llame-home-desktop-run-42,dst=/home/llame",
        "--workdir",
        "/workspace",
        "registry.example/llame/sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ],
    });
  });

  test.each([
    ["mutable image", { image: "registry.example/llame/sandbox:latest" }],
    [
      "option-like image",
      {
        image:
          "--privileged@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
    ["relative Workspace", { workspaceSourceRealpath: "worktrees/run-42" }],
    ["host root", { workspaceSourceRealpath: "/" }],
    ["mount delimiter", { workspaceSourceRealpath: "/srv/worktrees/bad,path" }],
    ["invalid Run id", { runId: "../other" }],
    ["invalid node id", { nodeId: "desktop/other" }],
    ["named user", { user: "llame" }],
  ])("rejects %s input", (_name, override) => {
    expect(() =>
      buildDockerSandboxPlan({
        nodeId: "desktop",
        runId: "run-42",
        image:
          "registry.example/llame/sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        workspaceSourceRealpath: "/srv/llame/worktrees/run-42",
        user: "1000:1000",
        ...override,
      }),
    ).toThrow();
  });

  test("bounds Docker resource names without discarding identity labels", () => {
    const plan = buildDockerSandboxPlan({
      nodeId: `node-${"a".repeat(123)}`,
      runId: `run-${"b".repeat(124)}`,
      image:
        "registry.example/llame/sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceSourceRealpath: "/srv/llame/worktrees/long-run",
      user: "1000:1000",
    });

    expect(plan.containerName.length).toBeLessThanOrEqual(128);
    expect(plan.homeVolumeName.length).toBeLessThanOrEqual(128);
    expect(plan.createArguments).toContain(
      `dev.llame.node-id=node-${"a".repeat(123)}`,
    );
    expect(plan.createArguments).toContain(
      `dev.llame.run-id=run-${"b".repeat(124)}`,
    );
  });

  test("accepts a local immutable Docker image id", () => {
    expect(
      buildDockerSandboxPlan({
        nodeId: "desktop",
        runId: "run-local-image",
        image:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        workspaceSourceRealpath: "/srv/llame/worktrees/run-local-image",
        user: "1000:1000",
      }).image,
    ).toBe(
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  test("builds a shell-free command inside the fixed Sandbox boundary", () => {
    const plan = buildDockerSandboxPlan({
      nodeId: "desktop",
      runId: "run-command",
      image:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceSourceRealpath: "/srv/llame/worktrees/run-command",
      user: "1000:1000",
    });

    expect(
      buildDockerSandboxCommandArguments(plan, {
        command: "git",
        args: ["status", "--short", "file name"],
      }),
    ).toEqual([
      "container",
      "exec",
      "--workdir",
      "/workspace",
      "--user",
      "1000:1000",
      "llame-desktop-run-command",
      "git",
      "status",
      "--short",
      "file name",
    ]);
  });

  test.each([
    ["empty command", { command: "", args: [] }],
    ["NUL in command", { command: "git\0status", args: [] }],
    ["too many arguments", { command: "git", args: Array(129).fill("x") }],
    ["oversized argument", { command: "git", args: ["x".repeat(8193)] }],
    [
      "oversized aggregate argv",
      { command: "git", args: Array(9).fill("x".repeat(8192)) },
    ],
  ])("rejects %s for Sandbox execution", (_name, command) => {
    const plan = buildDockerSandboxPlan({
      nodeId: "desktop",
      runId: "run-command",
      image:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceSourceRealpath: "/srv/llame/worktrees/run-command",
      user: "1000:1000",
    });

    expect(() => buildDockerSandboxCommandArguments(plan, command)).toThrow();
  });
});
