import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GIT_METHODS,
  isSerializableRecord,
  isStringValue,
  PATH_NOT_REGISTERED_MESSAGE,
  type JsonValue,
  type MachineErrorCode,
} from "@workspace/machine-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRootFixture, type RootFixture } from "./testing/fixtures";
import { envelope, startDaemon, type TestDaemon } from "./testing/harness";

/**
 * The daemon's typed git surface against real git repositories inside and
 * outside a registered root.
 *
 * Covers openspec `remote-machines` — "Machine daemons answer typed git
 * methods", "Machine git calls run in a sanitized environment", "Machine git
 * results report locators and rewritten errors", and "Worktree directories on
 * a Machine lie inside a registered root".
 */
const PREFIX = "machine://devl";
const OPTIONS = { displayPrefix: PREFIX };

for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"])
  .toString()
  .split("\n")) {
  if (name !== "") delete process.env[name];
}

const created: Array<string> = [];

function runGit(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
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

/** A `git` on PATH that records every call instead of running one, so a test
 *  can prove the daemon started no command. */
function gitRecorder() {
  const directory = mkdtempSync(join(tmpdir(), "llame-git-recorder-"));
  created.push(directory);
  const marker = join(directory, "started");
  writeFileSync(join(directory, "git"), `#!/bin/sh\ntouch '${marker}'\n`, {
    mode: 0o755,
  });
  return { directory, marker };
}

type Refusal = { readonly name: string; readonly code: MachineErrorCode };

/** The standard error of a git failure answer, narrowed from the wire. */
function stderrOf(value: JsonValue): string {
  const stderr = isSerializableRecord(value) ? value["stderr"] : undefined;
  if (!isStringValue(stderr))
    throw new Error(
      `the answer carries no standard error: ${JSON.stringify(value)}`,
    );
  return stderr;
}

function refusal(code: MachineErrorCode): Refusal {
  return {
    name: "MachineProtocolError",
    code,
    message: PATH_NOT_REGISTERED_MESSAGE,
  };
}

/**
 * A host path is "bare" when nothing rewrote it: a locator legitimately holds
 * the same path behind its prefix, so only an occurrence outside a locator is
 * a leak.
 */
function expectNoBareRoot(text: string): void {
  const escaped = fixture.root.replaceAll(
    /[.*+?^${}()|[\]\\]/gu,
    String.raw`\$&`,
  );
  expect(text).not.toMatch(new RegExp(`(?<!${PREFIX})${escaped}`, "u"));
}

let fixture: RootFixture;
let daemon: TestDaemon;
let clone: string;

beforeEach(async () => {
  fixture = await createRootFixture();
  clone = initRepository(join(fixture.root, "app"));
  commitFile(clone, "README.md");
  daemon = startDaemon({ roots: [fixture.root] });
  const hello = await daemon.hello();
  expect(hello.ok).toBe(true);
});

afterEach(async () => {
  daemon.input.end();
  await daemon.session.done;
  await fixture.cleanup();
});

afterAll(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("the handshake", () => {
  it("lists every git method the daemon answers", async () => {
    const hello = await daemon.hello();

    expect(hello.value).toMatchObject({ methods: [...GIT_METHODS] });
  });
});

describe("git.inspect", () => {
  it("reports locator paths and no host path", async () => {
    const head = runGit(clone, ["rev-parse", "HEAD"]).trim();

    const result = await daemon.call("git.inspect", {
      envelope: envelope(),
      path: clone,
      options: OPTIONS,
    });

    expect(result).toEqual({
      status: "ok",
      toplevel: `${PREFIX}${clone}`,
      commonDir: `${PREFIX}${join(clone, ".git")}`,
      linked: false,
      mainWorktree: null,
      remotes: [],
      branch: "main",
      head,
    });
    expectNoBareRoot(JSON.stringify(result));
  });

  it("inspects a linked worktree through its locator", async () => {
    const linkedPath = join(fixture.root, "feature");
    runGit(clone, ["worktree", "add", "--quiet", "-b", "feature", linkedPath]);

    const result = await daemon.call("git.inspect", {
      envelope: envelope(),
      path: linkedPath,
      options: OPTIONS,
    });

    expect(result).toMatchObject({
      status: "ok",
      toplevel: `${PREFIX}${linkedPath}`,
      linked: true,
      mainWorktree: `${PREFIX}${clone}`,
      branch: "feature",
    });
  });

  it("refuses a path outside every root before any git call", async () => {
    const recorder = gitRecorder();
    const previousPath = process.env["PATH"];
    process.env["PATH"] = `${recorder.directory}:${previousPath ?? ""}`;
    try {
      await expect(
        daemon.call("git.inspect", {
          envelope: envelope(),
          path: fixture.outside,
          options: OPTIONS,
        }),
      ).rejects.toMatchObject(refusal("path_not_registered"));
      expect(existsSync(recorder.marker)).toBe(false);
    } finally {
      process.env["PATH"] = previousPath;
    }
  });
});

describe("git.status", () => {
  it("reports a clean clone with a head", async () => {
    const head = runGit(clone, ["rev-parse", "HEAD"]).trim();

    await expect(
      daemon.call("git.status", {
        envelope: envelope(),
        path: clone,
        options: OPTIONS,
      }),
    ).resolves.toEqual({
      status: "ok",
      dirty: false,
      ahead: 0,
      head,
    });
  });

  it("reports a dirty clone", async () => {
    writeFileSync(join(clone, "README.md"), "changed\n");

    await expect(
      daemon.call("git.status", {
        envelope: envelope(),
        path: clone,
        options: OPTIONS,
      }),
    ).resolves.toMatchObject({ status: "ok", dirty: true });
  });

  it("reports the upstream and the commits ahead of it", async () => {
    const remote = join(fixture.root, "origin.git");
    runGit(fixture.root, ["init", "--quiet", "--bare", remote]);
    runGit(clone, ["remote", "add", "origin", remote]);
    runGit(clone, ["push", "--quiet", "--set-upstream", "origin", "main"]);
    commitFile(clone, "second.md");

    await expect(
      daemon.call("git.status", {
        envelope: envelope(),
        path: clone,
        options: OPTIONS,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      dirty: false,
      ahead: 1,
      upstream: "origin/main",
    });
  });

  it("refuses a path outside every root", async () => {
    await expect(
      daemon.call("git.status", {
        envelope: envelope(),
        path: fixture.outside,
        options: OPTIONS,
      }),
    ).rejects.toMatchObject(refusal("path_not_registered"));
  });
});

describe("git.worktreeAdd", () => {
  it("creates the worktree and reports its locator", async () => {
    const directory = join(fixture.root, "trees", "shop");
    const head = runGit(clone, ["rev-parse", "HEAD"]).trim();

    await expect(
      daemon.call("git.worktreeAdd", {
        envelope: envelope(),
        source: clone,
        branch: "llame/shop",
        directory,
        options: OPTIONS,
      }),
    ).resolves.toEqual({
      status: "ok",
      path: `${PREFIX}${directory}`,
      branch: "llame/shop",
      head,
    });
    expect(existsSync(join(directory, "README.md"))).toBe(true);
  });

  it("reports a failure whose text holds no bare registered root", async () => {
    const directory = join(fixture.root, "occupied");
    mkdirSync(directory);
    writeFileSync(join(directory, "file.txt"), "occupied\n");

    const result = await daemon.call("git.worktreeAdd", {
      envelope: envelope(),
      source: clone,
      branch: "llame/occupied",
      directory,
      options: OPTIONS,
    });

    expect(result).toMatchObject({ status: "error", type: "git_failed" });
    const stderr = stderrOf(result);
    expect(stderr).toContain("already exists");
    expect(stderr).toContain(`${PREFIX}${directory}`);
    expectNoBareRoot(stderr);
  });

  it("refuses an option-like base ref", async () => {
    await expect(
      daemon.call("git.worktreeAdd", {
        envelope: envelope(),
        source: clone,
        branch: "llame/forced",
        baseRef: "--force",
        directory: join(fixture.root, "forced"),
        options: OPTIONS,
      }),
    ).resolves.toEqual({
      status: "error",
      type: "invalid_input",
      message: "A base ref must not start with `-`.",
    });
    expect(existsSync(join(fixture.root, "forced"))).toBe(false);
  });

  it("refuses a directory outside every root before any git call", async () => {
    const recorder = gitRecorder();
    const previousPath = process.env["PATH"];
    process.env["PATH"] = `${recorder.directory}:${previousPath ?? ""}`;
    try {
      await expect(
        daemon.call("git.worktreeAdd", {
          envelope: envelope(),
          source: clone,
          branch: "llame/outside",
          directory: join(fixture.outside, "shop"),
          options: OPTIONS,
        }),
      ).rejects.toMatchObject(refusal("path_not_registered"));
      expect(existsSync(recorder.marker)).toBe(false);
    } finally {
      process.env["PATH"] = previousPath;
    }
  });
});

describe("git.worktreeList", () => {
  it("lists each worktree as a locator", async () => {
    const linkedPath = join(fixture.root, "feature");
    runGit(clone, ["worktree", "add", "--quiet", "-b", "feature", linkedPath]);

    const result = await daemon.call("git.worktreeList", {
      envelope: envelope(),
      source: clone,
      options: OPTIONS,
    });

    if (!isSerializableRecord(result))
      throw new Error("the listing answered no object");
    expect(result).toMatchObject({
      status: "ok",
      worktrees: [
        { path: `${PREFIX}${clone}`, branch: "main", locked: false },
        { path: `${PREFIX}${linkedPath}`, branch: "feature", locked: false },
      ],
    });
  });
});

describe("git.worktreeRemove", () => {
  it("removes a clean worktree", async () => {
    const linkedPath = join(fixture.root, "gone");
    runGit(clone, ["worktree", "add", "--quiet", "-b", "gone", linkedPath]);

    await expect(
      daemon.call("git.worktreeRemove", {
        envelope: envelope(),
        path: linkedPath,
        options: OPTIONS,
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(existsSync(linkedPath)).toBe(false);
  });

  it("reports a dirty worktree with its stderr as locators", async () => {
    const linkedPath = join(fixture.root, "dirty");
    runGit(clone, ["worktree", "add", "--quiet", "-b", "dirty", linkedPath]);
    writeFileSync(join(linkedPath, "README.md"), "changed\n");

    const result = await daemon.call("git.worktreeRemove", {
      envelope: envelope(),
      path: linkedPath,
      options: OPTIONS,
    });

    expect(result).toMatchObject({ status: "error", type: "git_failed" });
    const stderr = stderrOf(result);
    expect(stderr).toContain(`${PREFIX}${linkedPath}`);
    expectNoBareRoot(stderr);
    expect(existsSync(linkedPath)).toBe(true);
  });
});
