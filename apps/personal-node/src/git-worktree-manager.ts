import { execFile } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { promisify } from "node:util";

const run = promisify(execFile);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface GitWorktreeBinding {
  readonly runId: string;
  readonly workspaceId: string;
  readonly repositoryRoot: string;
  readonly worktreePath: string;
  readonly branchName: string;
}

export interface EnterGitWorktreeInput {
  readonly runId: string;
  readonly workspaceId: string;
  readonly repositoryRoot: string;
  readonly branchName: string;
}

export class GitWorktreeDirtyError extends Error {
  public constructor() {
    super("Git worktree contains uncommitted changes");
  }
}

export class GitWorktreeManager {
  readonly #worktreeRoot: string;
  readonly #database: DatabaseSync;

  public constructor(options: {
    readonly worktreeRoot: string;
    readonly databasePath: string;
  }) {
    if (
      !isAbsolute(options.worktreeRoot) ||
      !isAbsolute(options.databasePath)
    ) {
      throw new Error("Git worktree root must be absolute");
    }
    this.#worktreeRoot = resolve(options.worktreeRoot);
    this.#database = new DatabaseSync(options.databasePath);
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS git_worktree_bindings (
        run_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        repository_root TEXT NOT NULL,
        worktree_path TEXT NOT NULL UNIQUE,
        branch_name TEXT NOT NULL UNIQUE
      ) STRICT;
    `);
    for (const path of [
      options.databasePath,
      `${options.databasePath}-wal`,
      `${options.databasePath}-shm`,
    ]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  }

  public async enter(
    input: EnterGitWorktreeInput,
  ): Promise<GitWorktreeBinding> {
    this.#validateIdentity(input.runId, "Run");
    this.#validateIdentity(input.workspaceId, "Workspace");
    if (!isAbsolute(input.repositoryRoot)) {
      throw new Error("Git Workspace root must be absolute");
    }
    await run("git", ["check-ref-format", "--branch", input.branchName]);
    const repositoryRoot = await realpath(input.repositoryRoot);
    const topLevel = (
      await run("git", ["-C", repositoryRoot, "rev-parse", "--show-toplevel"])
    ).stdout.trim();
    if ((await realpath(topLevel)) !== repositoryRoot) {
      throw new Error("Git Workspace root must be the repository root");
    }
    await mkdir(this.#worktreeRoot, { recursive: true, mode: 0o700 });
    const worktreeRoot = await realpath(this.#worktreeRoot);
    if (this.#isWithin(repositoryRoot, worktreeRoot)) {
      throw new Error("Git worktree root must be outside the repository");
    }
    const binding: GitWorktreeBinding = {
      runId: input.runId,
      workspaceId: input.workspaceId,
      repositoryRoot,
      worktreePath: join(worktreeRoot, input.runId),
      branchName: input.branchName,
    };
    const existing = this.binding(input.runId);
    if (existing !== null) {
      if (JSON.stringify(existing) !== JSON.stringify(binding)) {
        throw new Error("Run already has a different Git worktree binding");
      }
      return structuredClone(existing);
    }
    await run("git", [
      "-C",
      repositoryRoot,
      "worktree",
      "add",
      "--no-track",
      "-b",
      input.branchName,
      binding.worktreePath,
      "HEAD",
    ]);
    this.#database
      .prepare(
        `INSERT INTO git_worktree_bindings
          (run_id, workspace_id, repository_root, worktree_path, branch_name)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        binding.runId,
        binding.workspaceId,
        binding.repositoryRoot,
        binding.worktreePath,
        binding.branchName,
      );
    return structuredClone(binding);
  }

  public binding(runId: string): GitWorktreeBinding | null {
    const row = this.#database
      .prepare(
        `SELECT run_id, workspace_id, repository_root, worktree_path, branch_name
         FROM git_worktree_bindings WHERE run_id = ?`,
      )
      .get(runId) as Record<string, SQLOutputValue> | undefined;
    if (row === undefined) return null;
    return {
      runId: this.#requireText(row, "run_id"),
      workspaceId: this.#requireText(row, "workspace_id"),
      repositoryRoot: this.#requireText(row, "repository_root"),
      worktreePath: this.#requireText(row, "worktree_path"),
      branchName: this.#requireText(row, "branch_name"),
    };
  }

  public async exit(runId: string): Promise<GitWorktreeBinding> {
    const binding = this.binding(runId);
    if (binding === null) throw new Error("Run has no Git worktree");
    const status = await run("git", [
      "-C",
      binding.worktreePath,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    if (status.stdout.length > 0) {
      throw new GitWorktreeDirtyError();
    }
    await run("git", [
      "-C",
      binding.repositoryRoot,
      "worktree",
      "remove",
      binding.worktreePath,
    ]);
    this.#database
      .prepare("DELETE FROM git_worktree_bindings WHERE run_id = ?")
      .run(runId);
    return structuredClone(binding);
  }

  public close(): void {
    this.#database.close();
  }

  #validateIdentity(value: string, label: string): void {
    if (!ID_PATTERN.test(value)) throw new Error(`invalid ${label} identity`);
  }

  #isWithin(parent: string, candidate: string): boolean {
    const path = relative(parent, candidate);
    return path === "" || (!path.startsWith("..") && !isAbsolute(path));
  }

  #requireText(
    row: Readonly<Record<string, SQLOutputValue>>,
    column: string,
  ): string {
    const value = row[column];
    if (typeof value !== "string") {
      throw new Error(`invalid Git worktree ${column}`);
    }
    return value;
  }
}
