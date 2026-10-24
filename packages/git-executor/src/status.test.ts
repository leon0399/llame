import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { statusRepository } from "./status";

/**
 * Real-git tests of `git.status` against throwaway repositories, under the
 * same conventions as `inspect.test.ts`.
 *
 * Covers openspec `repositories` — "Executors expose typed git operations".
 */
for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"])
  .toString()
  .split("\n")) {
  if (name !== "") delete process.env[name];
}

const created: Array<string> = [];

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "git-status-"));
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

/** A repository plus a bare tracking remote, so `@{upstream}` resolves. */
function trackedRepository() {
  const remote = join(tempDirectory(), "origin.git");
  runGit(tempDirectory(), ["init", "--quiet", "--bare", remote]);
  const directory = initRepository(tempDirectory());
  commitFile(directory, "README.md");
  runGit(directory, ["remote", "add", "origin", remote]);
  runGit(directory, ["push", "--quiet", "--set-upstream", "origin", "main"]);
  return { directory, remote };
}

afterAll(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("statusRepository", () => {
  it("reports a clean tracked branch at its head", async () => {
    const { directory } = trackedRepository();
    const head = runGit(directory, ["rev-parse", "HEAD"]).trim();

    await expect(statusRepository({ path: directory })).resolves.toEqual({
      status: "ok",
      dirty: false,
      ahead: 0,
      upstream: "origin/main",
      head,
    });
  });

  it("reports a dirty working tree", async () => {
    const { directory } = trackedRepository();
    writeFileSync(join(directory, "README.md"), "changed\n");

    await expect(statusRepository({ path: directory })).resolves.toMatchObject({
      status: "ok",
      dirty: true,
    });
  });

  it("counts the commits ahead of the upstream", async () => {
    const { directory } = trackedRepository();
    commitFile(directory, "second.md");
    commitFile(directory, "third.md");

    await expect(statusRepository({ path: directory })).resolves.toMatchObject({
      status: "ok",
      ahead: 2,
      upstream: "origin/main",
    });
  });

  it("reports no upstream, and no count, on an untracked branch", async () => {
    const directory = initRepository(tempDirectory());
    commitFile(directory, "README.md");

    const result = await statusRepository({ path: directory });

    expect(result).toMatchObject({ status: "ok", dirty: false, ahead: 0 });
    expect(result.status === "ok" && result.upstream).toBeFalsy();
  });

  it("reports a null head on an unborn branch", async () => {
    const directory = initRepository(tempDirectory());

    await expect(statusRepository({ path: directory })).resolves.toEqual({
      status: "ok",
      dirty: false,
      ahead: 0,
      head: null,
    });
  });

  it("reports a path that holds no repository", async () => {
    await expect(
      statusRepository({ path: tempDirectory() }),
    ).resolves.toMatchObject({ status: "error", type: "not_a_repository" });
  });

  it("refuses a relative path before git starts", async () => {
    await expect(statusRepository({ path: "srv/app" })).resolves.toEqual({
      status: "error",
      type: "invalid_input",
      message: "A git path must be absolute.",
    });
  });

  it("reports a typed timeout when git does not answer within the deadline", async () => {
    const directory = initRepository(tempDirectory());
    commitFile(directory, "README.md");
    const shim = mkdtempSync(join(tmpdir(), "git-status-slow-"));
    created.push(shim);
    writeFileSync(join(shim, "git"), "#!/bin/sh\nexec sleep 30\n", {
      mode: 0o755,
    });
    const previousPath = process.env["PATH"];
    process.env["PATH"] = `${shim}:${previousPath ?? ""}`;
    try {
      const result = await statusRepository(
        { path: directory },
        { timeoutMs: 200 },
      );

      expect(result).toMatchObject({ status: "error", type: "timed_out" });
    } finally {
      process.env["PATH"] = previousPath;
    }
  });
});
