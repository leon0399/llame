import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

import type { WorkspaceRecoveryPolicy } from "@workspace/federation-experiment/workspace-recovery";

export interface WorkspaceDefinition {
  readonly id: string;
  readonly label: string;
  readonly rootPath: string;
  readonly entryPolicy: "auto-approve" | "ask";
  readonly recoveryPolicy: WorkspaceRecoveryPolicy;
}

interface PendingWorkspaceEntry {
  readonly requestId: string;
  readonly runId: string;
  readonly workspace: WorkspaceDefinition;
}

export class WorkspaceRegistry {
  readonly #workspaces: ReadonlyMap<string, WorkspaceDefinition>;
  readonly #pending = new Map<string, PendingWorkspaceEntry>();

  public constructor(definitions: readonly WorkspaceDefinition[]) {
    const workspaces = new Map<string, WorkspaceDefinition>();
    for (const definition of definitions) {
      if (workspaces.has(definition.id)) {
        throw new Error("Workspace IDs must be unique");
      }
      if (!isAbsolute(definition.rootPath)) {
        throw new Error("Workspace root must be an absolute path");
      }
      workspaces.set(definition.id, structuredClone(definition));
    }
    this.#workspaces = workspaces;
  }

  public list(): readonly { readonly id: string; readonly label: string }[] {
    return [...this.#workspaces.values()].map(({ id, label }) => ({
      id,
      label,
    }));
  }

  public requestEntry(
    runId: string,
    workspaceId: string,
  ):
    | { readonly status: "approved"; readonly workspace: WorkspaceDefinition }
    | {
        readonly status: "approval-required";
        readonly requestId: string;
        readonly workspace: { readonly id: string; readonly label: string };
      } {
    const workspace = this.#workspaces.get(workspaceId);
    if (workspace === undefined) throw new Error("Workspace is not registered");
    if (workspace.entryPolicy === "auto-approve") {
      return { status: "approved", workspace: structuredClone(workspace) };
    }
    const existing = [...this.#pending.values()].find(
      (request) =>
        request.runId === runId && request.workspace.id === workspaceId,
    );
    if (existing !== undefined) return this.#publicRequest(existing);
    const pending = { requestId: randomUUID(), runId, workspace };
    this.#pending.set(pending.requestId, pending);
    return this.#publicRequest(pending);
  }

  public approve<Result>(
    requestId: string,
    apply: (approved: {
      readonly runId: string;
      readonly workspace: WorkspaceDefinition;
    }) => Result,
  ): Result {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) {
      throw new Error("Workspace entry request is not pending");
    }
    const result = apply({
      runId: pending.runId,
      workspace: structuredClone(pending.workspace),
    });
    this.#pending.delete(requestId);
    return result;
  }

  #publicRequest(pending: PendingWorkspaceEntry): {
    readonly status: "approval-required";
    readonly requestId: string;
    readonly workspace: { readonly id: string; readonly label: string };
  } {
    return {
      status: "approval-required",
      requestId: pending.requestId,
      workspace: {
        id: pending.workspace.id,
        label: pending.workspace.label,
      },
    };
  }
}
