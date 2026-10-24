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

import { gitPrefixArguments } from "./invocation";
import { inspectRepository } from "./inspect";

/**
 * Real-git tests against throwaway repositories.
 *
 * A git hook exports local variables (`GIT_DIR`, `GIT_INDEX_FILE`, ...) that
 * would aim these commands at the checkout running the suite, so they are
 * cleared at module load. Every command the test itself starts pins
 * `core.hooksPath=/dev/null`, so host hooks never run inside a temp repo, and
 * each repo sets the identity and disables line-ending rewriting.
 *
 * Covers openspec `repositories` — "Executors expose typed git operations",
 * "Git calls cannot run repository hooks or monitors", and "Git calls refuse
 * option-like caller values".
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

  it("keeps a main clone path that holds a newline whole", async () => {
    const main = initRepository(join(tempDirectory(), "main\nclone"));
    commitFile(main, "README.md");

    // Inspecting the main clone itself: reading both directories from one
    // `rev-parse` call splits this path at its newline, and the halves then
    // read as a linked worktree of its own parent directory.
    const result = await inspectRepository({ path: main });

    expect(result).toEqual({
      status: "ok",
      toplevel: main,
      commonDir: join(main, ".git"),
      linked: false,
      mainWorktree: null,
      remotes: [],
      branch: "main",
      head: runGit(main, ["rev-parse", "HEAD"]).trim(),
    });
  });

  it("keeps a toplevel that ends in a space whole", async () => {
    const directory = initRepository(
      join(tempDirectory(), "space at the end "),
    );
    commitFile(directory, "README.md");

    // The trailing space belongs to the directory name, so trimming the
    // reported line would name a directory that does not exist.
    const result = await inspectRepository({ path: directory });

    expect(result).toMatchObject({ status: "ok", toplevel: directory });
  });

  it("keeps a main clone path that holds a newline whole", async () => {
    const main = initRepository(join(tempDirectory(), "main\nclone"));
    commitFile(main, "README.md");
    const linkedPath = join(tempDirectory(), "linked-newline");
    runGit(main, ["worktree", "add", "--quiet", "-b", "feature", linkedPath]);

    const result = await inspectRepository({ path: linkedPath });

    expect(result).toMatchObject({ linked: true, mainWorktree: main });
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

  it("refuses a relative path and a NUL byte before any git call", async () => {
    await expect(inspectRepository({ path: "src" })).resolves.toMatchObject({
      status: "error",
      type: "invalid_input",
    });
    await expect(inspectRepository({ path: "/src\0" })).resolves.toMatchObject({
      status: "error",
      type: "invalid_input",
    });
  });

  it("passes a path holding a shell separator as one argument", async () => {
    const parent = tempDirectory();
    const directory = initRepository(join(parent, "order;rm -rf build"));
    commitFile(directory, "README.md");

    const result = await inspectRepository({ path: directory });

    expect(result).toMatchObject({ status: "ok", toplevel: directory });
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

  it("starts neither the monitor nor a hook that the repository config names", async () => {
    const directory = repositoryWithCommit();
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
      {
        mode: 0o755,
      },
    );
    writeFileSync(
      join(hooks, "post-index-change"),
      `#!/bin/sh\ntouch '${hookMarker}'\n`,
      { mode: 0o755 },
    );
    runGit(directory, ["config", "core.fsmonitor", monitor]);
    runGit(directory, ["config", "core.hooksPath", hooks]);

    // Control: the repository's own configuration is live, so a command the
    // package does not start runs both the monitor and the index hook.
    execFileSync("git", ["status", "--porcelain"], {
      ...GIT_OPTIONS,
      cwd: directory,
    });
    expect(existsSync(monitorMarker)).toBe(true);
    expect(existsSync(hookMarker)).toBe(true);
    rmSync(monitorMarker);
    rmSync(hookMarker);

    const result = await inspectRepository({ path: directory });

    expect(result).toMatchObject({ status: "ok", toplevel: directory });
    expect(existsSync(monitorMarker)).toBe(false);
    expect(existsSync(hookMarker)).toBe(false);
  });

  it("reports a typed timeout when git does not answer within the deadline", async () => {
    const directory = repositoryWithCommit();
    const shim = mkdtempSync(join(tmpdir(), "git-executor-slow-"));
    created.push(shim);
    // `exec`, so the killed process is the sleeper itself and not a shell
    // whose child would keep the pipes open past the deadline.
    writeFileSync(join(shim, "git"), "#!/bin/sh\nexec sleep 30\n", {
      mode: 0o755,
    });
    const previousPath = process.env["PATH"];
    process.env["PATH"] = `${shim}:${previousPath ?? ""}`;
    try {
      const result = await inspectRepository(
        { path: directory },
        { timeoutMs: 200 },
      );

      expect(result).toMatchObject({ status: "error", type: "timed_out" });
    } finally {
      process.env["PATH"] = previousPath;
    }
  });
});

describe("gitPrefixArguments", () => {
  // The argv pin is the guard for "Git calls cannot run repository hooks or
  // monitors": every probe in this package is read-only and never refreshes an
  // index, so nothing else in the call could start one.
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
