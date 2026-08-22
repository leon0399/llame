import { describe, expect, test } from "vitest";

import { InMemoryWorkspaceRecovery } from "./workspace-recovery.js";

describe("sticky Workspace recovery", () => {
  test("asks with only the recovery actions currently legal", () => {
    const recovery = new InMemoryWorkspaceRecovery({
      workspaceId: "workspace-code",
      preferredExecutorNodeId: "node-workstation",
      authorityEpoch: 4,
      policy: "ask",
    });

    const transition = recovery.executorUnavailable({
      executorNodeId: "node-workstation",
      continuationExecutorNodeId: "node-home",
      egressAllowsFallback: true,
    });

    expect(transition.state).toMatchObject({
      mode: "decision-required",
      activeExecutorNodeId: "node-workstation",
      authorityEpoch: 4,
      workspaceAttached: true,
      preferredExecutorAvailable: false,
    });
    expect(transition.availableActions).toEqual(["wait", "fallback", "exit"]);
    expect(transition.effects).toEqual([
      {
        type: "workspace-availability-changed",
        workspaceId: "workspace-code",
        availability: "unavailable",
      },
      {
        type: "request-recovery-decision",
        actions: ["wait", "fallback", "exit"],
      },
    ]);
  });

  test("waits without silently transferring executor authority", () => {
    const recovery = new InMemoryWorkspaceRecovery({
      workspaceId: "workspace-code",
      preferredExecutorNodeId: "node-workstation",
      authorityEpoch: 4,
      policy: "wait",
    });

    const transition = recovery.executorUnavailable({
      executorNodeId: "node-workstation",
      continuationExecutorNodeId: "node-home",
      egressAllowsFallback: true,
    });

    expect(transition.state).toMatchObject({
      mode: "waiting",
      activeExecutorNodeId: "node-workstation",
      authorityEpoch: 4,
      workspaceAttached: true,
    });
    expect(transition.effects).not.toContainEqual(
      expect.objectContaining({ type: "transfer-run-authority" }),
    );
  });

  test("falls back temporarily and restores the preferred environment", () => {
    const recovery = new InMemoryWorkspaceRecovery({
      workspaceId: "workspace-code",
      preferredExecutorNodeId: "node-workstation",
      authorityEpoch: 4,
      policy: "fallback",
    });

    const unavailable = recovery.executorUnavailable({
      executorNodeId: "node-workstation",
      continuationExecutorNodeId: "node-home",
      egressAllowsFallback: true,
    });

    expect(unavailable.state).toMatchObject({
      mode: "temporary-fallback",
      activeExecutorNodeId: "node-home",
      authorityEpoch: 5,
      workspaceAttached: false,
      preferredExecutorAvailable: false,
    });
    expect(unavailable.effects).toContainEqual({
      type: "transfer-run-authority",
      expectedAuthorityEpoch: 4,
      nextAuthorityEpoch: 5,
      targetExecutorNodeId: "node-home",
      reason: "fallback",
    });
    expect(unavailable.effects).toContainEqual({
      type: "workspace-binding-changed",
      workspaceId: "workspace-code",
      binding: "temporarily-detached",
    });

    const recovered = recovery.preferredExecutorRecovered();

    expect(recovered.state).toMatchObject({
      mode: "attached",
      activeExecutorNodeId: "node-workstation",
      authorityEpoch: 6,
      workspaceAttached: true,
      preferredExecutorAvailable: true,
    });
    expect(recovered.effects).toEqual([
      {
        type: "workspace-availability-changed",
        workspaceId: "workspace-code",
        availability: "available",
      },
      {
        type: "transfer-run-authority",
        expectedAuthorityEpoch: 5,
        nextAuthorityEpoch: 6,
        targetExecutorNodeId: "node-workstation",
        reason: "recovery",
      },
      {
        type: "workspace-binding-changed",
        workspaceId: "workspace-code",
        binding: "attached",
      },
    ]);
  });

  test("does not let automatic fallback override egress policy", () => {
    const recovery = new InMemoryWorkspaceRecovery({
      workspaceId: "workspace-confidential",
      preferredExecutorNodeId: "node-workstation",
      authorityEpoch: 1,
      policy: "fallback",
    });

    const transition = recovery.executorUnavailable({
      executorNodeId: "node-workstation",
      continuationExecutorNodeId: "node-cloud",
      egressAllowsFallback: false,
    });

    expect(transition.state.mode).toBe("decision-required");
    expect(transition.state.authorityEpoch).toBe(1);
    expect(transition.availableActions).toEqual(["wait"]);
    expect(transition.effects).toContainEqual({
      type: "fallback-blocked",
      reason: "egress-policy",
    });
  });

  test("exits permanently and only reports later availability", () => {
    const recovery = new InMemoryWorkspaceRecovery({
      workspaceId: "workspace-code",
      preferredExecutorNodeId: "node-workstation",
      authorityEpoch: 2,
      policy: "exit",
    });
    const exited = recovery.executorUnavailable({
      executorNodeId: "node-workstation",
      continuationExecutorNodeId: "node-home",
      egressAllowsFallback: true,
    });

    expect(exited.state).toMatchObject({
      mode: "exited",
      activeExecutorNodeId: "node-home",
      authorityEpoch: 3,
      workspaceAttached: false,
    });
    expect(exited.effects).toContainEqual({
      type: "workspace-binding-changed",
      workspaceId: "workspace-code",
      binding: "exited",
    });
    expect(exited.effects).toContainEqual({
      type: "transfer-run-authority",
      expectedAuthorityEpoch: 2,
      nextAuthorityEpoch: 3,
      targetExecutorNodeId: "node-home",
      reason: "workspace-exit",
    });

    const recovered = recovery.preferredExecutorRecovered();

    expect(recovered.state).toMatchObject({
      mode: "exited",
      activeExecutorNodeId: "node-home",
      authorityEpoch: 3,
      workspaceAttached: false,
      preferredExecutorAvailable: true,
    });
    expect(recovered.effects).toEqual([
      {
        type: "workspace-availability-changed",
        workspaceId: "workspace-code",
        availability: "available",
      },
    ]);
  });

  test("applies an explicit choice after ask without granting future approval", () => {
    const recovery = new InMemoryWorkspaceRecovery({
      workspaceId: "workspace-code",
      preferredExecutorNodeId: "node-workstation",
      authorityEpoch: 1,
      policy: "ask",
    });
    recovery.executorUnavailable({
      executorNodeId: "node-workstation",
      continuationExecutorNodeId: "node-home",
      egressAllowsFallback: true,
    });

    const chosen = recovery.choose("fallback", {
      continuationExecutorNodeId: "node-home",
      egressAllowsFallback: true,
    });

    expect(chosen.state.mode).toBe("temporary-fallback");
    expect(chosen.state.policy).toBe("ask");
  });

  test("exits a healthy Workspace without moving Run authority", () => {
    const recovery = new InMemoryWorkspaceRecovery({
      workspaceId: "workspace-code",
      preferredExecutorNodeId: "node-workstation",
      authorityEpoch: 3,
      policy: "ask",
    });

    const exited = recovery.exitWorkspace();

    expect(exited.state).toMatchObject({
      mode: "exited",
      activeExecutorNodeId: "node-workstation",
      authorityEpoch: 3,
      workspaceAttached: false,
    });
    expect(exited.effects).toEqual([
      {
        type: "workspace-binding-changed",
        workspaceId: "workspace-code",
        binding: "exited",
      },
    ]);
    expect(recovery.exitWorkspace().effects).toEqual([]);
  });
});
