import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { inspectRepository } from "./inspect";
import { addWorktree, listWorktrees, removeWorktree } from "./worktrees";
import {
  cleanupRepositories,
  commitFile,
  gitStderr,
  repositoryWithCommit,
  runGit,
  tempDirectory,
  withSlowGit,
} from "./testing";

/**
 * Real-git tests of the three worktree operations against throwaway
 * repositories, under the same conventions as `inspect.test.ts`.
 *
 * Covers openspec `repositories` — "Executors expose typed git operations",
 * "Git calls cannot run repository hooks or monitors", and "Git calls refuse
 * option-like caller values".
 */
afterAll(cleanupRepositories);

describe("addWorktree", () => {
  it("creates a worktree on a new branch and reports its head", async () => {
    const source = repositoryWithCommit();
    const head = runGit(source, ["rev-parse", "HEAD"]).trim();
    const directory = join(tempDirectory(), "shop");

    const result = await addWorktree({
      source,
      branch: "llame/shop",
      directory,
    });

    expect(result).toEqual({
      status: "ok",
      path: directory,
      branch: "llame/shop",
      head,
    });
    expect(existsSync(join(directory, "README.md"))).toBe(true);
    // The new branch tracks nothing: a created worktree is not a clone.
    expect(
      gitStderr(directory, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]),
    ).toContain("no upstream configured");
  });

  it("starts the branch from a base ref", async () => {
    const source = repositoryWithCommit();
    const base = runGit(source, ["rev-parse", "HEAD"]).trim();
    commitFile(source, "second.md");
    const directory = join(tempDirectory(), "from-base");

    const result = await addWorktree({
      source,
      branch: "llame/from-base",
      baseRef: base,
      directory,
    });

    expect(result).toMatchObject({ status: "ok", head: base });
    expect(existsSync(join(directory, "second.md"))).toBe(false);
  });

  it("accepts a revision expression as the base ref", async () => {
    const source = repositoryWithCommit();
    const base = runGit(source, ["rev-parse", "HEAD"]).trim();
    commitFile(source, "second.md");

    for (const [index, baseRef] of ["HEAD~1", "main^"].entries()) {
      const directory = join(tempDirectory(), `from-revision-${index}`);

      const result = await addWorktree({
        source,
        branch: `llame/from-revision-${index}`,
        baseRef,
        directory,
      });

      expect(result).toMatchObject({ status: "ok", head: base });
      expect(existsSync(join(directory, "second.md"))).toBe(false);
    }
  });

  it("refuses an option-like branch, base ref, or relative path before git starts", async () => {
    const source = repositoryWithCommit();
    const directory = join(tempDirectory(), "refused");

    await expect(
      addWorktree({ source, branch: "-feature", directory }),
    ).resolves.toMatchObject({ status: "error", type: "invalid_input" });
    await expect(
      addWorktree({
        source,
        branch: "llame/shop",
        baseRef: "--force",
        directory,
      }),
    ).resolves.toMatchObject({ status: "error", type: "invalid_input" });
    await expect(
      addWorktree({ source, branch: "llame/shop", directory: "shop" }),
    ).resolves.toMatchObject({ status: "error", type: "invalid_input" });
    await expect(
      addWorktree({ source: "shop", branch: "llame/shop", directory }),
    ).resolves.toMatchObject({ status: "error", type: "invalid_input" });
    expect(existsSync(directory)).toBe(false);
  });

  it("places every caller value after --end-of-options", async () => {
    const shim = tempDirectory("git-argv-");
    const log = join(shim, "argv.log");
    writeFileSync(
      join(shim, "git"),
      `#!/bin/sh\nprintf 'CALL\\n' >> '${log}'\nprintf '%s\\n' "$@" >> '${log}'\n`,
      { mode: 0o755 },
    );
    const previousPath = process.env["PATH"];
    process.env["PATH"] = `${shim}:${previousPath ?? ""}`;
    try {
      await addWorktree({
        source: "/srv/app",
        branch: "llame/shop",
        baseRef: "main",
        directory: "/srv/trees/shop",
      });
      await removeWorktree({ path: "/srv/trees/shop" });
    } finally {
      process.env["PATH"] = previousPath;
    }

    const calls = readFileSync(log, "utf8")
      .split("CALL\n")
      .filter((call) => call !== "")
      .map((call) => call.trimEnd().split("\n"));
    expect(calls[0]?.slice(-8)).toEqual([
      "worktree",
      "add",
      "--no-track",
      "-b",
      "llame/shop",
      "--end-of-options",
      "/srv/trees/shop",
      "main",
    ]);
    expect(calls.at(-1)).toEqual([
      "-c",
      expect.stringContaining("core.hooksPath="),
      "-c",
      "core.fsmonitor=false",
      "-C",
      "/srv/trees/shop",
      "worktree",
      "remove",
      "--end-of-options",
      "/srv/trees/shop",
    ]);
  });

  it("refuses a branch with a parent, lock, or empty segment", async () => {
    const source = repositoryWithCommit();
    const directory = join(tempDirectory(), "refused");

    for (const branch of [
      "llame/..",
      "llame/a..b",
      "llame/shop.lock",
      "llame//shop",
      "llame/shop/",
      "llame/@{}",
      "llame/shop name",
    ]) {
      await expect(
        addWorktree({ source, branch, directory }),
      ).resolves.toMatchObject({ status: "error", type: "invalid_input" });
    }
    expect(existsSync(directory)).toBe(false);
  });

  it("reports a branch another worktree already uses, and creates nothing", async () => {
    const source = repositoryWithCommit();
    runGit(source, [
      "worktree",
      "add",
      "--quiet",
      "-b",
      "feature",
      join(tempDirectory(), "feature"),
    ]);
    const directory = join(tempDirectory(), "second");

    const result = await addWorktree({
      source,
      branch: "feature",
      directory,
    });

    if (result.status !== "error" || result.type === "invalid_input")
      throw new Error(`the add should have failed: ${JSON.stringify(result)}`);
    expect(result.stderr).toContain("already exists");
    expect(existsSync(directory)).toBe(false);
  });

  it("reports a directory that holds a file", async () => {
    const source = repositoryWithCommit();
    // An empty directory is a valid worktree destination; a populated one is
    // not.
    const directory = tempDirectory();
    writeFileSync(join(directory, "occupied.txt"), "occupied\n");

    const result = await addWorktree({
      source,
      branch: "llame/taken",
      directory,
    });

    expect(result).toMatchObject({ status: "error", type: "git_failed" });
    expect(
      result.status === "error" && result.type !== "invalid_input"
        ? result.stderr
        : "",
    ).toContain("already exists");
  });

  it("starts neither the monitor nor the checkout hook", async () => {
    const source = repositoryWithCommit();
    const evidence = tempDirectory();
    const monitorMarker = join(evidence, "monitor-started");
    const hookMarker = join(evidence, "hook-started");
    const monitor = join(evidence, "monitor.sh");
    const hooks = join(evidence, "hooks");
    mkdirSync(hooks);
    writeFileSync(monitor, `#!/bin/sh\ntouch '${monitorMarker}'\n`, {
      mode: 0o755,
    });
    writeFileSync(
      join(hooks, "post-checkout"),
      `#!/bin/sh\ntouch '${hookMarker}'\n`,
      { mode: 0o755 },
    );
    runGit(source, ["config", "core.fsmonitor", monitor]);
    runGit(source, ["config", "core.hooksPath", hooks]);

    const result = await addWorktree({
      source,
      branch: "llame/quiet",
      directory: join(tempDirectory(), "quiet"),
    });

    expect(result).toMatchObject({ status: "ok" });
    expect(existsSync(monitorMarker)).toBe(false);
    expect(existsSync(hookMarker)).toBe(false);
  });

  it("reports a typed timeout when git does not answer within the deadline", async () => {
    const source = repositoryWithCommit();
    await withSlowGit(async () => {
      const result = await addWorktree(
        {
          source,
          branch: "llame/slow",
          directory: join(tempDirectory(), "slow"),
        },
        { timeoutMs: 200 },
      );

      expect(result).toMatchObject({ status: "error", type: "timed_out" });
    });
  });
});

describe("listWorktrees", () => {
  it("lists the main worktree first, then each linked one", async () => {
    const source = repositoryWithCommit();
    const linkedPath = join(tempDirectory(), "feature");
    runGit(source, ["worktree", "add", "--quiet", "-b", "feature", linkedPath]);
    const head = runGit(source, ["rev-parse", "HEAD"]).trim();

    const result = await listWorktrees({ path: source });

    expect(result).toEqual({
      status: "ok",
      worktrees: [
        {
          path: source,
          branch: "main",
          head,
          locked: false,
          prunable: false,
        },
        {
          path: linkedPath,
          branch: "feature",
          head,
          locked: false,
          prunable: false,
        },
      ],
    });
  });

  it("reports a locked worktree", async () => {
    const source = repositoryWithCommit();
    const linkedPath = join(tempDirectory(), "locked");
    runGit(source, ["worktree", "add", "--quiet", "-b", "locked", linkedPath]);
    runGit(source, ["worktree", "lock", linkedPath]);

    const result = await listWorktrees({ path: source });

    if (result.status !== "ok")
      throw new Error(`the listing failed: ${JSON.stringify(result)}`);
    expect(
      result.worktrees.find((entry) => entry.path === linkedPath),
    ).toMatchObject({ branch: "locked", locked: true });
  });

  it("reports a path that holds no repository", async () => {
    await expect(
      listWorktrees({ path: tempDirectory() }),
    ).resolves.toMatchObject({ status: "error", type: "not_a_repository" });
  });
});

describe("removeWorktree", () => {
  it("removes a clean worktree and keeps its branch", async () => {
    const source = repositoryWithCommit();
    const linkedPath = join(tempDirectory(), "gone");
    runGit(source, ["worktree", "add", "--quiet", "-b", "gone", linkedPath]);

    await expect(removeWorktree({ path: linkedPath })).resolves.toEqual({
      status: "ok",
    });

    expect(existsSync(linkedPath)).toBe(false);
    expect(runGit(source, ["branch", "--list", "gone"])).toContain("gone");
  });

  it("refuses a dirty worktree", async () => {
    const source = repositoryWithCommit();
    const linkedPath = join(tempDirectory(), "dirty");
    runGit(source, ["worktree", "add", "--quiet", "-b", "dirty", linkedPath]);
    writeFileSync(join(linkedPath, "README.md"), "changed\n");

    const result = await removeWorktree({ path: linkedPath });

    expect(result).toMatchObject({ status: "error", type: "git_failed" });
    expect(
      result.status === "error" && result.type !== "invalid_input"
        ? result.stderr
        : "",
    ).toMatch(/modified|contains/u);
    expect(existsSync(linkedPath)).toBe(true);
  });

  it("refuses a missing path and a main working tree", async () => {
    // A path git cannot enter is a typed failure, not an invalid argument:
    // the argument itself is a well-formed absolute path.
    await expect(
      removeWorktree({ path: join(tempDirectory(), "missing") }),
    ).resolves.toMatchObject({ status: "error", type: "not_a_repository" });

    const source = repositoryWithCommit();
    const main = await removeWorktree({ path: source });
    expect(main).toMatchObject({ status: "error", type: "git_failed" });
    expect(
      main.status === "error" && main.type !== "invalid_input"
        ? main.stderr
        : "",
    ).toContain("main working tree");
  });
});

describe("the worktree operations over one inspected repository", () => {
  it("lists what the add reported", async () => {
    const source = repositoryWithCommit();
    const directory = join(tempDirectory(), "shop");

    const added = await addWorktree({
      source,
      branch: "llame/shop",
      directory,
    });
    const inspected = await inspectRepository({ path: directory });
    const listed = await listWorktrees({ path: source });

    expect(added).toMatchObject({ status: "ok" });
    expect(inspected).toMatchObject({
      status: "ok",
      toplevel: directory,
      linked: true,
      mainWorktree: source,
      branch: "llame/shop",
    });
    if (listed.status !== "ok")
      throw new Error(`the listing failed: ${JSON.stringify(listed)}`);
    expect(listed.worktrees.map((entry) => entry.path)).toContain(directory);
  });
});
