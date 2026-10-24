import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitPrefixArguments, inspectRepository } from "./inspect";

/**
 * Real-git tests against throwaway repositories.
 *
 * A git hook exports local variables (`GIT_DIR`, `GIT_INDEX_FILE`, ...) that
 * would aim these commands at the checkout running the suite, so they are
 * cleared at module load. Every command the test itself starts pins
 * `core.hooksPath=/dev/null`, so host hooks never run inside a temp repo, and
 * each repo sets the identity and disables line-ending rewriting.
 */
for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"])
  .toString()
  .split("\n")) {
  if (name !== "") delete process.env[name];
}

const created: Array<string> = [];

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "git-executor-"));
  created.push(directory);
  return directory;
}

const GIT_OPTIONS: ExecFileSyncOptionsWithStringEncoding = {
  encoding: "utf8",
  env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
};

function runGit(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    ...GIT_OPTIONS,
    cwd,
  });
}

function initRepository(directory: string): string {
  mkdirSync(directory, { recursive: true });
  runGit(directory, ["init", "--quiet", "--initial-branch=main", "."]);
  runGit(directory, ["config", "user.name", "llame tests"]);
  runGit(directory, ["config", "user.email", "llame@test.invalid"]);
  runGit(directory, ["config", "core.autocrlf", "false"]);
  return directory;
}

function commitFile(directory: string, name: string): void {
  writeFileSync(join(directory, name), `${name}\n`);
  runGit(directory, ["add", name]);
  runGit(directory, ["commit", "--quiet", "--message", `add ${name}`]);
}

function repositoryWithCommit(): string {
  const directory = initRepository(tempDirectory());
  commitFile(directory, "README.md");
  return directory;
}

afterAll(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("inspectRepository", () => {
  it("reports the toplevel, common directory, branch, and head of a clone", async () => {
    const directory = repositoryWithCommit();
    const head = runGit(directory, ["rev-parse", "HEAD"]).trim();

    const result = await inspectRepository({ path: join(directory, ".") });

    expect(result).toEqual({
      status: "ok",
      toplevel: directory,
      commonDir: join(directory, ".git"),
      linked: false,
      mainWorktree: null,
      remotes: [],
      branch: "main",
      head,
    });
  });

  it("reports a linked worktree with its main worktree as the source", async () => {
    const main = repositoryWithCommit();
    const linkedPath = join(tempDirectory(), "linked");
    runGit(main, ["worktree", "add", "--quiet", "-b", "feature", linkedPath]);

    const result = await inspectRepository({ path: linkedPath });

    if (result.status !== "ok")
      throw new Error(`inspection failed: ${JSON.stringify(result)}`);
    expect(result).toMatchObject({
      toplevel: linkedPath,
      commonDir: join(main, ".git"),
      linked: true,
      mainWorktree: main,
      branch: "feature",
    });
  });

  it("reports every remote of a clone", async () => {
    const directory = repositoryWithCommit();
    runGit(directory, [
      "remote",
      "add",
      "origin",
      "git@github.com:leon0399/llame.git",
    ]);
    runGit(directory, [
      "remote",
      "add",
      "upstream",
      "https://github.com/llame-org/llame",
    ]);

    const result = await inspectRepository({ path: directory });

    expect(result).toMatchObject({
      remotes: [
        { name: "origin", url: "git@github.com:leon0399/llame.git" },
        { name: "upstream", url: "https://github.com/llame-org/llame" },
      ],
    });
  });

  it("reports a detached HEAD with no branch, and an unborn branch with no head", async () => {
    const directory = repositoryWithCommit();
    runGit(directory, ["checkout", "--quiet", "--detach", "HEAD"]);
    const detached = await inspectRepository({ path: directory });
    expect(detached).toMatchObject({
      branch: null,
      head: expect.stringMatching(/^[0-9a-f]{40}$/u),
    });

    const unborn = initRepository(tempDirectory());
    const empty = await inspectRepository({ path: unborn });
    expect(empty).toMatchObject({ status: "ok", branch: "main", head: null });
  });

  it("refuses a path that is not a repository", async () => {
    const directory = tempDirectory();

    const result = await inspectRepository({ path: directory });

    expect(result).toMatchObject({ status: "error", type: "not_a_repository" });
  });

  it("refuses a relative path and an option-like path before any git call", async () => {
    await expect(inspectRepository({ path: "src" })).resolves.toEqual({
      status: "error",
      type: "invalid_input",
      message: "A git path must be absolute.",
    });
    await expect(inspectRepository({ path: "-C" })).resolves.toEqual({
      status: "error",
      type: "invalid_input",
      message: 'A git path must not start with "-".',
    });
  });

  it("stops at the timeout with a typed failure", async () => {
    const directory = repositoryWithCommit();

    const result = await inspectRepository(
      { path: directory },
      { timeoutMs: 1 },
    );

    expect(result).toMatchObject({ status: "error", type: "timed_out" });
  });

  it("passes a path holding a shell separator as one argument", async () => {
    const parent = tempDirectory();
    const directory = initRepository(join(parent, "order;rm -rf build"));
    commitFile(directory, "README.md");

    const result = await inspectRepository({ path: directory });

    expect(result).toMatchObject({ status: "ok", toplevel: directory });
  });

  it("never runs a configured hook or file-system monitor", async () => {
    const directory = repositoryWithCommit();
    const marker = join(tempDirectory(), "monitor-ran");
    const monitor = join(directory, "monitor.sh");
    writeFileSync(monitor, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, {
      mode: 0o755,
    });
    runGit(directory, ["config", "core.fsmonitor", monitor]);
    for (const hook of [
      "post-checkout",
      "pre-commit",
      "reference-transaction",
    ]) {
      const path = join(directory, ".git", "hooks", hook);
      writeFileSync(path, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    }

    const result = await inspectRepository({ path: directory });

    expect(result).toMatchObject({ status: "ok" });
    expect(existsSync(marker)).toBe(false);
  });

  it("ignores an inherited GIT_DIR that would redirect the call", async () => {
    const target = repositoryWithCommit();
    const elsewhere = repositoryWithCommit();

    // A git hook leaves GIT_DIR exported; the call builds its own environment,
    // so the field never redirects the inspection at another repository.
    process.env["GIT_DIR"] = join(elsewhere, ".git");
    try {
      await expect(inspectRepository({ path: target })).resolves.toMatchObject({
        status: "ok",
        toplevel: target,
      });
    } finally {
      delete process.env["GIT_DIR"];
    }
  });
});

describe("gitPrefixArguments", () => {
  it("disables hooks and the file-system monitor before the working directory", () => {
    expect(gitPrefixArguments("/tmp/empty-hooks", "/srv/app")).toEqual([
      "-c",
      "core.hooksPath=/tmp/empty-hooks",
      "-c",
      "core.fsmonitor=false",
      "-C",
      "/srv/app",
    ]);
  });
});
