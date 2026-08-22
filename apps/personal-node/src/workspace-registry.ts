import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { WorkspaceRecoveryPolicy } from "@workspace/federation-experiment/workspace-recovery";

export interface WorkspaceDefinition {
  readonly id: string;
  readonly label: string;
  readonly rootPath: string;
  readonly entryPolicy: "auto-approve" | "ask";
  readonly recoveryPolicy: WorkspaceRecoveryPolicy;
}

export class WorkspaceUnavailableError extends Error {
  public constructor() {
    super("Workspace is unavailable");
  }
}

interface PendingWorkspaceEntry {
  readonly requestId: string;
  readonly runId: string;
  readonly workspace: WorkspaceDefinition;
}

export class WorkspaceRegistry {
  readonly #workspaces: ReadonlyMap<string, WorkspaceDefinition>;
  readonly #pending = new Map<string, PendingWorkspaceEntry>();
  readonly #database: DatabaseSync | undefined;

  public constructor(
    definitions: readonly WorkspaceDefinition[],
    options: { readonly databasePath?: string } = {},
  ) {
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
    this.#database =
      options.databasePath === undefined
        ? undefined
        : new DatabaseSync(options.databasePath);
    this.#database?.exec(`
      CREATE TABLE IF NOT EXISTS workspace_entry_requests (
        request_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        UNIQUE (run_id, workspace_id)
      ) STRICT
    `);
    for (const row of this.#database
      ?.prepare(
        `SELECT request_id, run_id, workspace_id
         FROM workspace_entry_requests`,
      )
      .all() ?? []) {
      const requestId = row.request_id;
      const runId = row.run_id;
      const workspaceId = row.workspace_id;
      const workspace =
        typeof workspaceId === "string"
          ? this.#workspaces.get(workspaceId)
          : undefined;
      if (
        typeof requestId !== "string" ||
        typeof runId !== "string" ||
        workspace === undefined
      ) {
        continue;
      }
      this.#pending.set(requestId, { requestId, runId, workspace });
    }
  }

  public close(): void {
    this.#database?.close();
  }

  public list(): readonly { readonly id: string; readonly label: string }[] {
    return [...this.#workspaces.values()].map(({ id, label }) => ({
      id,
      label,
    }));
  }

  public async binding(workspaceId: string): Promise<{
    readonly workspaceId: string;
    readonly rootPath: string;
  }> {
    const workspace = this.#workspaces.get(workspaceId);
    if (workspace === undefined) throw new Error("Workspace is not registered");
    try {
      if (!(await stat(workspace.rootPath)).isDirectory()) {
        throw new WorkspaceUnavailableError();
      }
    } catch (error) {
      if (error instanceof WorkspaceUnavailableError) throw error;
      throw new WorkspaceUnavailableError();
    }
    return { workspaceId: workspace.id, rootPath: workspace.rootPath };
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
    let pending: PendingWorkspaceEntry = {
      requestId: randomUUID(),
      runId,
      workspace,
    };
    if (this.#database !== undefined) {
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO workspace_entry_requests
            (request_id, run_id, workspace_id) VALUES (?, ?, ?)`,
        )
        .run(pending.requestId, runId, workspaceId);
      const stored = this.#database
        .prepare(
          `SELECT request_id FROM workspace_entry_requests
           WHERE run_id = ? AND workspace_id = ?`,
        )
        .get(runId, workspaceId);
      if (typeof stored?.request_id !== "string") {
        throw new Error("Workspace entry request was not persisted");
      }
      pending = { ...pending, requestId: stored.request_id };
    }
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
    this.#database
      ?.prepare("DELETE FROM workspace_entry_requests WHERE request_id = ?")
      .run(requestId);
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
