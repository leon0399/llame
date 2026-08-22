import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { WorkspaceRegistry } from "./workspace-registry.js";

describe("manual Workspace registry", () => {
  test("auto-approves only a manually registered Workspace", () => {
    const registry = new WorkspaceRegistry([
      {
        id: "llame",
        label: "llame",
        rootPath: "/srv/workspaces/llame",
        entryPolicy: "auto-approve",
        recoveryPolicy: "fallback",
      },
    ]);

    expect(registry.list()).toEqual([{ id: "llame", label: "llame" }]);
    expect(registry.requestEntry("run-1", "llame")).toMatchObject({
      status: "approved",
      workspace: {
        id: "llame",
        rootPath: "/srv/workspaces/llame",
        recoveryPolicy: "fallback",
      },
    });
    expect(() => registry.requestEntry("run-1", "unknown")).toThrowError(
      "Workspace is not registered",
    );
  });

  test("requires a separate one-time owner approval for ask policy", () => {
    const registry = new WorkspaceRegistry([
      {
        id: "family",
        label: "Family files",
        rootPath: "/srv/workspaces/family",
        entryPolicy: "ask",
        recoveryPolicy: "ask",
      },
    ]);

    const requested = registry.requestEntry("run-2", "family");
    expect(requested).toMatchObject({ status: "approval-required" });
    if (requested.status !== "approval-required") {
      throw new Error("expected approval request");
    }
    expect(registry.requestEntry("run-2", "family")).toEqual(requested);
    expect(
      registry.approve(requested.requestId, (approved) => approved),
    ).toMatchObject({
      runId: "run-2",
      workspace: { id: "family", recoveryPolicy: "ask" },
    });
    expect(() =>
      registry.approve(requested.requestId, (approved) => approved),
    ).toThrowError("Workspace entry request is not pending");
  });

  test("retains an approval request when applying it fails", () => {
    const registry = new WorkspaceRegistry([
      {
        id: "code",
        label: "Code",
        rootPath: "/srv/workspaces/code",
        entryPolicy: "ask",
        recoveryPolicy: "wait",
      },
    ]);
    const requested = registry.requestEntry("missing-run", "code");
    if (requested.status !== "approval-required") {
      throw new Error("expected approval request");
    }

    expect(() =>
      registry.approve(requested.requestId, () => {
        throw new Error("Run does not exist");
      }),
    ).toThrowError("Run does not exist");
    expect(
      registry.approve(requested.requestId, (approved) => approved.runId),
    ).toBe("missing-run");
  });

  test("recovers a pending approval after process restart", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "llame-workspace-registry-"),
    );
    try {
      const databasePath = join(directory, "node.sqlite");
      const definitions = [
        {
          id: "code",
          label: "Code",
          rootPath: "/srv/workspaces/code",
          entryPolicy: "ask" as const,
          recoveryPolicy: "wait" as const,
        },
      ];
      const first = new WorkspaceRegistry(definitions, { databasePath });
      const requested = first.requestEntry("run-restart", "code");
      first.close();
      if (requested.status !== "approval-required") {
        throw new Error("expected approval request");
      }

      const recovered = new WorkspaceRegistry(definitions, { databasePath });
      expect(recovered.requestEntry("run-restart", "code")).toEqual(requested);
      expect(
        recovered.approve(requested.requestId, (approved) => approved.runId),
      ).toBe("run-restart");
      recovered.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
