import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import { GitWorktreeManager } from "./git-worktree-manager.js";

const run = promisify(execFile);

describe("executor-local Git worktree bindings", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function createRepository(): Promise<{
    readonly directory: string;
    readonly repositoryRoot: string;
  }> {
    const directory = await mkdtemp(join(tmpdir(), "llame-worktree-"));
    directories.push(directory);
    const repositoryRoot = join(directory, "repository");
    await run("git", ["init", "--initial-branch=main", repositoryRoot]);
    await run("git", ["-C", repositoryRoot, "config", "user.name", "Test"]);
    await run("git", [
      "-C",
      repositoryRoot,
      "config",
      "user.email",
      "test@example.invalid",
    ]);
    await writeFile(join(repositoryRoot, "README.md"), "# Fixture\n");
    await run("git", ["-C", repositoryRoot, "add", "README.md"]);
    await run("git", ["-C", repositoryRoot, "commit", "-m", "Fixture"]);
    return { directory, repositoryRoot };
  }

  test("creates one idempotent manager-owned worktree per Run", async () => {
    const { directory, repositoryRoot } = await createRepository();
    const manager = new GitWorktreeManager({
      worktreeRoot: join(directory, "worktrees"),
      databasePath: join(directory, "worktrees.sqlite"),
    });

    const entered = await manager.enter({
      runId: "run-1",
      workspaceId: "workspace-code",
      repositoryRoot,
      branchName: "llame/run-1",
    });

    expect(
      await manager.enter({
        runId: "run-1",
        workspaceId: "workspace-code",
        repositoryRoot,
        branchName: "llame/run-1",
      }),
    ).toEqual(entered);
    expect((await stat(join(entered.worktreePath, "README.md"))).isFile()).toBe(
      true,
    );
    expect(
      (
        await run("git", [
          "-C",
          entered.worktreePath,
          "branch",
          "--show-current",
        ])
      ).stdout.trim(),
    ).toBe("llame/run-1");

    await manager.exit("run-1");
    manager.close();

    await expect(stat(entered.worktreePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      (
        await run("git", [
          "-C",
          repositoryRoot,
          "branch",
          "--list",
          "llame/run-1",
        ])
      ).stdout.trim(),
    ).toBe("llame/run-1");
  });

  test("refuses to remove a dirty worktree and retains its binding", async () => {
    const { directory, repositoryRoot } = await createRepository();
    const manager = new GitWorktreeManager({
      worktreeRoot: join(directory, "worktrees"),
      databasePath: join(directory, "worktrees.sqlite"),
    });
    const entered = await manager.enter({
      runId: "run-1",
      workspaceId: "workspace-code",
      repositoryRoot,
      branchName: "llame/run-1",
    });
    await writeFile(join(entered.worktreePath, "uncommitted.txt"), "keep me");

    await expect(manager.exit("run-1")).rejects.toThrowError(
      "Git worktree contains uncommitted changes",
    );
    expect(manager.binding("run-1")).toEqual(entered);
    expect(
      (await stat(join(entered.worktreePath, "uncommitted.txt"))).isFile(),
    ).toBe(true);
    manager.close();
  });

  test("recovers an existing binding after the daemon restarts", async () => {
    const { directory, repositoryRoot } = await createRepository();
    const options = {
      worktreeRoot: join(directory, "worktrees"),
      databasePath: join(directory, "worktrees.sqlite"),
    };
    const first = new GitWorktreeManager(options);
    const entered = await first.enter({
      runId: "run-1",
      workspaceId: "workspace-code",
      repositoryRoot,
      branchName: "llame/run-1",
    });
    first.close();

    const restarted = new GitWorktreeManager(options);
    expect(restarted.binding("run-1")).toEqual(entered);
    await restarted.exit("run-1");
    expect(restarted.binding("run-1")).toBeNull();
    restarted.close();
  });

  test("rejects a symlinked worktree root that resolves inside the repository", async () => {
    const { directory, repositoryRoot } = await createRepository();
    const managedInsideRepository = join(repositoryRoot, "managed");
    await mkdir(managedInsideRepository);
    const linkedRoot = join(directory, "worktrees");
    await symlink(managedInsideRepository, linkedRoot);
    const manager = new GitWorktreeManager({
      worktreeRoot: linkedRoot,
      databasePath: join(directory, "worktrees.sqlite"),
    });

    await expect(
      manager.enter({
        runId: "run-1",
        workspaceId: "workspace-code",
        repositoryRoot,
        branchName: "llame/run-1",
      }),
    ).rejects.toThrowError("Git worktree root must be outside the repository");
    manager.close();
  });

  test("reconciles interrupted pending creation without deleting a checkout", async () => {
    const { directory, repositoryRoot } = await createRepository();
    const worktreeRoot = join(directory, "worktrees");
    const databasePath = join(directory, "worktrees.sqlite");
    const initialized = new GitWorktreeManager({
      worktreeRoot,
      databasePath,
    });
    initialized.close();
    await mkdir(worktreeRoot, { recursive: true });
    const existingPath = join(worktreeRoot, "run-existing");
    await run("git", [
      "-C",
      repositoryRoot,
      "worktree",
      "add",
      "-b",
      "llame/run-existing",
      existingPath,
      "HEAD",
    ]);
    const database = new DatabaseSync(databasePath);
    const insert = database.prepare(
      `INSERT INTO git_worktree_bindings
        (run_id, workspace_id, repository_root, worktree_path, branch_name, state)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
    );
    insert.run(
      "run-existing",
      "workspace-code",
      repositoryRoot,
      existingPath,
      "llame/run-existing",
    );
    insert.run(
      "run-missing",
      "workspace-code",
      repositoryRoot,
      join(worktreeRoot, "run-missing"),
      "llame/run-missing",
    );
    database.close();

    const restarted = new GitWorktreeManager({ worktreeRoot, databasePath });
    await expect(restarted.recoverPending()).resolves.toEqual({
      activated: 1,
      discarded: 1,
    });
    expect(restarted.binding("run-existing")).toMatchObject({
      worktreePath: existingPath,
      branchName: "llame/run-existing",
    });
    expect(restarted.binding("run-missing")).toBeNull();
    await restarted.exit("run-existing");
    restarted.close();
  });

  test("discards a failed creation reservation before retrying", async () => {
    const { directory, repositoryRoot } = await createRepository();
    await run("git", ["-C", repositoryRoot, "branch", "llame/already-exists"]);
    const manager = new GitWorktreeManager({
      worktreeRoot: join(directory, "worktrees"),
      databasePath: join(directory, "worktrees.sqlite"),
    });

    await expect(
      manager.enter({
        runId: "run-1",
        workspaceId: "workspace-code",
        repositoryRoot,
        branchName: "llame/already-exists",
      }),
    ).rejects.toThrow();
    await expect(
      manager.enter({
        runId: "run-1",
        workspaceId: "workspace-code",
        repositoryRoot,
        branchName: "llame/retry",
      }),
    ).resolves.toMatchObject({ branchName: "llame/retry" });
    await manager.exit("run-1");
    manager.close();
  });
});
