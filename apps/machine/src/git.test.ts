import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isSerializableRecord,
  isStringValue,
  PATH_NOT_REGISTERED_MESSAGE,
  type JsonValue,
  type MachineErrorCode,
  type MachineMethodParams,
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

type Refusal = {
  readonly name: string;
  readonly code: MachineErrorCode;
  readonly message: string;
};

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

  it("refuses a toplevel above the roots instead of naming it", async () => {
    const sub = join(clone, "packages");
    mkdirSync(sub);
    const nested = startDaemon({ roots: [sub] });
    try {
      expect((await nested.hello()).ok).toBe(true);

      await expect(
        nested.call("git.inspect", {
          envelope: envelope(),
          path: sub,
          options: OPTIONS,
        }),
      ).rejects.toMatchObject(refusal("path_not_registered"));
    } finally {
      nested.input.end();
      await nested.session.done;
    }
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

/** Runs `body` with a `git` on PATH that records every start. */
async function withGitRecorder(
  body: (started: () => boolean) => Promise<void>,
): Promise<void> {
  const recorder = gitRecorder();
  const previousPath = process.env["PATH"];
  process.env["PATH"] = `${recorder.directory}:${previousPath ?? ""}`;
  try {
    await body(() => existsSync(recorder.marker));
  } finally {
    process.env["PATH"] = previousPath;
  }
}

function stateParams(
  path: string,
  gitEntry: string,
): MachineMethodParams["git.state"] {
  return {
    envelope: envelope(),
    path,
    gitEntry,
    limit: 10,
    submodules: "check",
    options: OPTIONS,
  };
}

describe("git.locate", () => {
  it("Locate starts no git process", async () => {
    await withGitRecorder(async (started) => {
      await expect(
        daemon.call("git.locate", {
          envelope: envelope(),
          path: clone,
          options: OPTIONS,
        }),
      ).resolves.toEqual({
        status: "ok",
        gitEntry: `${PREFIX}${join(clone, ".git")}`,
        kind: "directory",
      });
      expect(started()).toBe(false);
    });
  });

  it("A repository above the registered root is not found", async () => {
    const inner = join(clone, "sub");
    mkdirSync(inner);
    const nested = startDaemon({ roots: [inner] });
    try {
      expect((await nested.hello()).ok).toBe(true);
      await expect(
        nested.call("git.locate", {
          envelope: envelope(),
          path: inner,
          options: OPTIONS,
        }),
      ).resolves.toEqual({
        status: "error",
        type: "no_repository_in_root",
        stderr: "",
      });
    } finally {
      nested.input.end();
      await nested.session.done;
    }
  });

  it("refuses a path outside every root", async () => {
    await expect(
      daemon.call("git.locate", {
        envelope: envelope(),
        path: fixture.outside,
        options: OPTIONS,
      }),
    ).rejects.toMatchObject(refusal("path_not_registered"));
  });
});

describe("git.state", () => {
  it("reports a clean clone with a locator toplevel", async () => {
    const head = runGit(clone, ["rev-parse", "HEAD"]).trim();

    await expect(
      daemon.call(
        "git.state",
        stateParams(join(clone, "."), join(clone, ".git")),
      ),
    ).resolves.toMatchObject({
      status: "ok",
      toplevel: `${PREFIX}${clone}`,
      rootRelative: "",
      branch: "main",
      head,
      counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
    });
  });

  it("State refuses a changed git entry", async () => {
    const nested = initRepository(join(clone, "nested"));
    await expect(
      daemon.call("git.state", stateParams(nested, join(clone, ".git"))),
    ).resolves.toEqual({
      status: "error",
      type: "git_entry_changed",
      stderr: "",
    });
  });

  it("An outside common directory is refused", async () => {
    const main = initRepository(join(fixture.outside, "main"));
    commitFile(main, "README.md");
    const linked = join(fixture.root, "linked");
    runGit(main, ["worktree", "add", "--quiet", "-b", "linked", linked]);

    await withGitRecorder(async (started) => {
      await expect(
        daemon.call("git.state", stateParams(linked, join(linked, ".git"))),
      ).resolves.toEqual({
        status: "error",
        type: "outside_registered_root",
        stderr: "",
      });
      expect(started()).toBe(false);
    });
  });

  it("refuses a git entry outside every root", async () => {
    await expect(
      daemon.call(
        "git.state",
        stateParams(clone, join(fixture.outside, ".git")),
      ),
    ).rejects.toMatchObject(refusal("path_not_registered"));
  });

  it("refuses a path outside every root", async () => {
    await expect(
      daemon.call(
        "git.state",
        stateParams(fixture.outside, join(clone, ".git")),
      ),
    ).rejects.toMatchObject(refusal("path_not_registered"));
  });

  it.each([
    ["a negative limit", { limit: -1 }],
    ["a limit above 1000", { limit: 1001 }],
    ["a fractional limit", { limit: 1.5 }],
    ["an unknown submodules mode", { submodules: "all" }],
  ] as const)("refuses %s before any git call", async (_name, override) => {
    await withGitRecorder(async (started) => {
      await expect(
        daemon.call(
          "git.state",
          Object.assign(stateParams(clone, join(clone, ".git")), override),
        ),
      ).resolves.toMatchObject({ status: "error", type: "invalid_input" });
      expect(started()).toBe(false);
    });
  });

  it("accepts the limit bounds 0 and 1000", async () => {
    for (const limit of [0, 1000]) {
      await expect(
        daemon.call(
          "git.state",
          Object.assign(stateParams(clone, join(clone, ".git")), { limit }),
        ),
      ).resolves.toMatchObject({ status: "ok" });
    }
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

  it("refuses a directory reached through a link that leaves the roots", async () => {
    symlinkSync(fixture.outside, join(fixture.root, "escape"));
    const recorder = gitRecorder();
    const previousPath = process.env["PATH"];
    process.env["PATH"] = `${recorder.directory}:${previousPath ?? ""}`;
    try {
      await expect(
        daemon.call("git.worktreeAdd", {
          envelope: envelope(),
          source: clone,
          branch: "llame/escaped",
          directory: join(fixture.root, "escape", "shop"),
          options: OPTIONS,
        }),
      ).rejects.toMatchObject(refusal("path_not_registered"));
      expect(existsSync(recorder.marker)).toBe(false);
    } finally {
      process.env["PATH"] = previousPath;
    }
  });

  it("decides a missing directory through its nearest existing ancestor", async () => {
    const real = join(fixture.root, "real");
    mkdirSync(real);
    symlinkSync(real, join(fixture.root, "link"));
    const directory = join(real, "trees", "shop");

    const result = await daemon.call("git.worktreeAdd", {
      envelope: envelope(),
      source: clone,
      branch: "llame/linked",
      directory: join(fixture.root, "link", "trees", "shop"),
      options: OPTIONS,
    });

    expect(result).toMatchObject({
      status: "ok",
      path: `${PREFIX}${directory}`,
    });
    expect(existsSync(join(directory, "README.md"))).toBe(true);
  });

  it("refuses a branch with whitespace before any git call", async () => {
    const result = await daemon.call("git.worktreeAdd", {
      envelope: envelope(),
      source: clone,
      branch: "a;touch /tmp/x",
      directory: join(fixture.root, "injected"),
      options: OPTIONS,
    });

    expect(result).toMatchObject({ status: "error", type: "invalid_input" });
    expect(existsSync(join(fixture.root, "injected"))).toBe(false);
    expect(existsSync("/tmp/x")).toBe(false);
  });

  it("passes a shell-shaped value as one argument", async () => {
    const directory = join(fixture.root, "$(id)");

    const result = await daemon.call("git.worktreeAdd", {
      envelope: envelope(),
      source: clone,
      branch: "llame/shell;id",
      directory,
      options: OPTIONS,
    });

    expect(result).toMatchObject({
      status: "ok",
      branch: "llame/shell;id",
      path: `${PREFIX}${directory}`,
    });
    expect(existsSync(directory)).toBe(true);
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
  it("refuses a worktree outside the roots instead of naming it", async () => {
    runGit(clone, [
      "worktree",
      "add",
      "--quiet",
      "-b",
      "outside",
      join(fixture.outside, "tree"),
    ]);

    await expect(
      daemon.call("git.worktreeList", {
        envelope: envelope(),
        source: clone,
        options: OPTIONS,
      }),
    ).rejects.toMatchObject(refusal("path_not_registered"));
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

describe("the strict parameter object", () => {
  it("refuses a key the method does not declare", async () => {
    await expect(
      daemon.call(
        "git.worktreeAdd",
        Object.assign(
          {
            envelope: envelope(),
            source: clone,
            branch: "llame/typo",
            directory: join(fixture.root, "typo"),
            options: OPTIONS,
          } satisfies MachineMethodParams["git.worktreeAdd"],
          { baseref: "main" },
        ),
      ),
    ).rejects.toMatchObject({
      code: "invalid_params",
      message: "git.worktreeAdd: Unknown parameter: baseref.",
    });
    expect(existsSync(join(fixture.root, "typo"))).toBe(false);
  });
});
