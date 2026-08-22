import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { generateWriterIdentity } from "@workspace/federation-experiment/batch-signature";
import { createEnrollmentProof } from "@workspace/federation-experiment/node-enrollment";
import { afterEach, describe, expect, test } from "vitest";

import { SqliteEnrollmentRegistry } from "./enrollment-registry.js";
import { GitWorktreeManager } from "./git-worktree-manager.js";
import { createPersonalNodeServer } from "./node-server.js";
import { SignedRealmRunAuthor } from "./realm-run-author.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

const run = promisify(execFile);

describe("executor-local Git worktree API", () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  });

  test("separates owner control from executor-only path resolution", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-worktree-api-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
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

    const databasePath = join(directory, "node.sqlite");
    const controller = generateWriterIdentity();
    const store = new SqlitePersonalRealmStore({
      databasePath,
      realmId: "realm-personal",
      writerEpochs: { controller: 1 },
      trustedWriterKeys: { "controller:1": controller.publicKeyPem },
      runControlGrants: { controller: { scopes: ["run.control"] } },
    });
    const author = new SignedRealmRunAuthor({
      store,
      writerStreamId: "controller",
      writerEpoch: 1,
      privateKeyPem: controller.privateKeyPem,
    });
    author.createRun({
      runId: "run-1",
      executorNodeId: "node-workstation",
    });
    author.attachWorkspace({
      runId: "run-1",
      workspaceId: "workspace-code",
      policy: "ask",
    });
    const enrollment = new SqliteEnrollmentRegistry({
      databasePath,
      realmId: "realm-personal",
    });
    const executor = generateWriterIdentity();
    const executorGrant = enrollment.completeEnrollment(
      createEnrollmentProof(
        enrollment.issueChallenge({ nodeId: "node-workstation" }),
        executor.privateKeyPem,
      ),
      new Date(),
      ["run.execute"],
    );
    const worktrees = new GitWorktreeManager({
      worktreeRoot: join(directory, "worktrees"),
      databasePath,
    });
    const workspaces = new WorkspaceRegistry([
      {
        id: "workspace-code",
        label: "Code",
        rootPath: repositoryRoot,
        entryPolicy: "auto-approve",
        recoveryPolicy: "ask",
      },
    ]);
    cleanup.push(
      () => workspaces.close(),
      () => worktrees.close(),
      () => enrollment.close(),
      () => store.close(),
    );
    const server = createPersonalNodeServer({
      nodeId: "node-workstation",
      bearerToken: "owner-control-secret",
      store,
      enrollmentRegistry: enrollment,
      journalRunProjection: true,
      workspaceRegistry: workspaces,
      gitWorktreeManager: worktrees,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not bind");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const ownerHeaders = {
      authorization: "Bearer owner-control-secret",
      "content-type": "application/json",
    };

    const entered = await fetch(`${origin}/v1/runs/run-1/worktree/enter`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ branchName: "llame/run-1" }),
    });
    const ownerBinding = await fetch(
      `${origin}/v1/runs/run-1/worktree/binding`,
      { headers: ownerHeaders },
    );
    const executorBinding = await fetch(
      `${origin}/v1/runs/run-1/worktree/binding`,
      {
        headers: {
          authorization: `Bearer ${executorGrant.credential}`,
        },
      },
    );

    expect(entered.status).toBe(201);
    expect(await entered.json()).toEqual({
      status: "entered",
      runId: "run-1",
      workspaceId: "workspace-code",
      branchName: "llame/run-1",
    });
    expect(ownerBinding.status).toBe(403);
    expect(executorBinding.status).toBe(200);
    const binding = (await executorBinding.json()) as { worktreePath: string };
    expect((await stat(join(binding.worktreePath, "README.md"))).isFile()).toBe(
      true,
    );

    await writeFile(join(binding.worktreePath, "uncommitted.txt"), "keep me");
    const dirtyExit = await fetch(`${origin}/v1/runs/run-1/worktree/exit`, {
      method: "POST",
      headers: ownerHeaders,
      body: "{}",
    });
    expect(dirtyExit.status).toBe(409);
    expect(await dirtyExit.json()).toEqual({ error: "worktree_dirty" });
    expect(
      (await stat(join(binding.worktreePath, "uncommitted.txt"))).isFile(),
    ).toBe(true);

    await rm(join(binding.worktreePath, "uncommitted.txt"));
    const exited = await fetch(`${origin}/v1/runs/run-1/worktree/exit`, {
      method: "POST",
      headers: ownerHeaders,
      body: "{}",
    });
    expect(exited.status).toBe(202);
    expect(await exited.json()).toEqual({
      status: "exited",
      runId: "run-1",
      workspaceId: "workspace-code",
      branchName: "llame/run-1",
    });
  });
});
