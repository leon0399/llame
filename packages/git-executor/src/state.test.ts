import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { locateRepository } from "./locate";
import { stateRepository, type StateInput } from "./state";
import {
  cleanupRepositories,
  commitFile,
  GIT_OPTIONS,
  gitStderr,
  initRepository,
  repositoryWithCommit,
  runGit,
  tempDirectory,
  withGitShim,
  withSlowGit,
} from "./testing";

/**
 * Real-git tests of `git.state` against throwaway repositories.
 *
 * Covers openspec `workspace-git-state` — the executor scenarios of
 * "Git state is observed from git, not from the model", "A Machine observation
 * stays inside the registered roots", and the pinned, bounded git invocation.
 */
afterAll(cleanupRepositories);

/** Locate the entry as the hub would, then observe it. */
async function observe(
  path: string,
  overrides: Partial<StateInput> = {},
  options: { readonly timeoutMs?: number } = {},
) {
  const located = await locateRepository({ path });
  if (located.status !== "ok") {
    throw new Error(`expected a repository at ${path}`);
  }
  return stateRepository(
    {
      path,
      gitEntry: located.gitEntry,
      limit: 20,
      submodules: "skip",
      ...overrides,
    },
    options,
  );
}

async function observed(path: string, overrides: Partial<StateInput> = {}) {
  const result = await observe(path, overrides);
  if (result.status !== "ok") {
    throw new Error(`expected a state, got ${JSON.stringify(result)}`);
  }
  return result;
}

/** A git command with extra environment; the exit code is not checked. */
function gitWith(
  cwd: string,
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    ...GIT_OPTIONS,
    cwd,
    env: { ...GIT_OPTIONS.env, ...env },
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** A bare remote and a clone of it with `main` pushed and tracking. */
function trackedRepository() {
  const remote = join(tempDirectory(), "origin.git");
  runGit(tempDirectory(), [
    "init",
    "--quiet",
    "--bare",
    "--initial-branch=main",
    remote,
  ]);
  const directory = initRepository(tempDirectory());
  commitFile(directory, "README.md");
  runGit(directory, ["remote", "add", "origin", remote]);
  runGit(directory, ["push", "--quiet", "--set-upstream", "origin", "main"]);
  return { directory, remote };
}

/** A second clone that pushes one more commit to the remote's `main`. */
function pushFromElsewhere(remote: string): void {
  const other = join(tempDirectory(), "other");
  runGit(tempDirectory(), ["clone", "--quiet", remote, other]);
  runGit(other, ["config", "user.name", "llame tests"]);
  runGit(other, ["config", "user.email", "llame@test.invalid"]);
  commitFile(other, "upstream.txt");
  runGit(other, ["push", "--quiet", "origin", "main"]);
}

/** Two branches whose commits change `shared.txt` differently. */
function divergedRepository() {
  const directory = repositoryWithCommit();
  runGit(directory, ["checkout", "--quiet", "-b", "other"]);
  writeFileSync(join(directory, "shared.txt"), "other\n");
  runGit(directory, ["add", "shared.txt"]);
  runGit(directory, ["commit", "--quiet", "--message", "other side"]);
  runGit(directory, ["checkout", "--quiet", "main"]);
  writeFileSync(join(directory, "shared.txt"), "main\n");
  runGit(directory, ["add", "shared.txt"]);
  runGit(directory, ["commit", "--quiet", "--message", "main side"]);
  return directory;
}

describe("stateRepository fields", () => {
  it("matches git for a branch with changes, an upstream, and remotes", async () => {
    const { directory, remote } = trackedRepository();
    commitFile(directory, "ahead.txt");
    pushFromElsewhere(remote);
    runGit(directory, ["fetch", "--quiet"]);
    writeFileSync(join(directory, "README.md"), "changed\n");
    writeFileSync(join(directory, "staged.txt"), "staged\n");
    runGit(directory, ["add", "staged.txt"]);
    writeFileSync(join(directory, "new.txt"), "new\n");
    const head = runGit(directory, ["rev-parse", "HEAD"]).trim();

    const result = await observed(directory);

    expect(result).toMatchObject({
      status: "ok",
      toplevel: directory,
      rootRelative: "",
      branch: "main",
      detached: false,
      head,
      operation: null,
      counts: { staged: 1, unstaged: 1, untracked: 1, conflicted: 0 },
      omitted: 0,
      submodules: [],
      remotes: [{ name: "origin", url: remote }],
    });
    expect(result.upstream).toMatchObject({
      name: "origin/main",
      gone: false,
      ahead: 1,
      behind: 1,
    });
    expect(result.entries).toEqual([
      { xy: " M", path: "README.md" },
      { xy: "A ", path: "staged.txt" },
      { xy: "??", path: "new.txt" },
    ]);
    expect(result.commits[0]).toEqual({
      short: runGit(directory, ["rev-parse", "--short", "HEAD"]).trim(),
      subject: "add ahead.txt",
    });
  });

  it("reports a staged rename with its source", async () => {
    const directory = repositoryWithCommit();
    runGit(directory, ["mv", "README.md", "MOVED.md"]);

    const result = await observed(directory);

    expect(result.entries).toEqual([
      { xy: "R ", path: "MOVED.md", from: "README.md" },
    ]);
    expect(result.counts.staged).toBe(1);
  });

  it("keeps a path that holds spaces whole", async () => {
    const directory = repositoryWithCommit();
    writeFileSync(join(directory, "a file name.txt"), "x\n");

    const result = await observed(directory);

    expect(result.entries).toEqual([{ xy: "??", path: "a file name.txt" }]);
  });

  it("reports a detached HEAD", async () => {
    const directory = repositoryWithCommit();
    commitFile(directory, "second.txt");
    runGit(directory, ["checkout", "--quiet", "--detach", "HEAD~1"]);
    const head = runGit(directory, ["rev-parse", "HEAD"]).trim();

    const result = await observed(directory);

    expect(result).toMatchObject({
      branch: null,
      detached: true,
      head,
      upstream: null,
    });
  });

  it("reports an unborn branch without a head or commits", async () => {
    const directory = initRepository(tempDirectory());

    const result = await observed(directory);

    expect(result).toMatchObject({
      branch: "main",
      detached: false,
      head: null,
      commits: [],
      submodules: [],
    });
  });

  it("lists five commits, newest first", async () => {
    const directory = repositoryWithCommit();
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      commitFile(directory, `${name}.txt`);
    }

    const result = await observed(directory);

    expect(result.commits.map((commit) => commit.subject)).toEqual([
      "add f.txt",
      "add e.txt",
      "add d.txt",
      "add c.txt",
      "add b.txt",
    ]);
    expect(result.commits[1]?.short).toBe(
      runGit(directory, ["rev-parse", "--short", "HEAD~1"]).trim(),
    );
  });
});

describe("stateRepository upstream", () => {
  it("dates a fetch from the upstream reflog", async () => {
    const { directory, remote } = trackedRepository();
    pushFromElsewhere(remote);
    gitWith(directory, ["fetch", "--quiet"], {
      GIT_COMMITTER_DATE: "1700000000 +0000",
    });

    const result = await observed(directory);

    expect(result.upstream).toEqual({
      name: "origin/main",
      gone: false,
      ahead: 0,
      behind: 1,
      updatedAt: "2023-11-14T22:13:20.000Z",
    });
  });

  it("has no update time when the upstream ref has no reflog", async () => {
    const { directory, remote } = trackedRepository();
    const clone = join(tempDirectory(), "clone");
    runGit(tempDirectory(), ["clone", "--quiet", remote, clone]);

    const result = await observed(clone);

    expect(result.upstream).toEqual({
      name: "origin/main",
      gone: false,
      ahead: 0,
      behind: 0,
      updatedAt: null,
    });
    expect(directory).not.toBe(clone);
  });

  it("lets a linked worktree see the main clone's fetch", async () => {
    const { directory, remote } = trackedRepository();
    runGit(directory, ["checkout", "--quiet", "-b", "side"]);
    const linked = join(tempDirectory(), "linked");
    runGit(directory, ["worktree", "add", "--quiet", linked, "main"]);
    pushFromElsewhere(remote);
    gitWith(directory, ["fetch", "--quiet"], {
      GIT_COMMITTER_DATE: "1700000000 +0000",
    });

    const result = await observed(linked);

    expect(result.toplevel).toBe(linked);
    expect(result.upstream).toMatchObject({
      behind: 1,
      updatedAt: "2023-11-14T22:13:20.000Z",
    });
  });

  it("reports a gone upstream without ahead, behind, or a date", async () => {
    const { directory, remote } = trackedRepository();
    runGit(directory, ["checkout", "--quiet", "-b", "feature"]);
    runGit(directory, [
      "push",
      "--quiet",
      "--set-upstream",
      "origin",
      "feature",
    ]);
    runGit(remote, ["branch", "--quiet", "-D", "feature"]);
    runGit(directory, ["fetch", "--quiet", "--prune"]);

    const result = await observed(directory);

    expect(result.upstream).toEqual({
      name: "origin/feature",
      gone: true,
      ahead: null,
      behind: null,
      updatedAt: null,
    });
  });

  it("never passes an option-like upstream name to git", async () => {
    const directory = repositoryWithCommit();
    const log = join(tempDirectory(), "argv.log");
    const shim = `for a in "$@"; do
  if [ "$a" = status ]; then
    printf '# branch.oid 1\\0# branch.head main\\0# branch.upstream --all\\0# branch.ab +0 -0\\0'
    exit 0
  fi
done
echo "$@" >> '${log}'
exec "$REAL_GIT" "$@"`;

    const result = await withGitShim(shim, () => observed(directory));

    expect(result.upstream).toEqual({
      name: "--all",
      gone: false,
      ahead: 0,
      behind: 0,
      updatedAt: null,
    });
    expect(readFileSync(log, "utf8")).not.toContain("reflog");
  });
});

describe("stateRepository operations", () => {
  it("reports a rebase stopped at a step with its step and total", async () => {
    const directory = repositoryWithCommit();
    commitFile(directory, "one.txt");
    commitFile(directory, "two.txt");
    runGit(directory, [
      "-c",
      "sequence.editor=sed -i s/^pick/edit/",
      "rebase",
      "--quiet",
      "-i",
      "HEAD~2",
    ]);

    const result = await observed(directory);

    expect(result.operation).toEqual({ kind: "rebase", step: 1, total: 2 });
    expect(result.detached).toBe(true);
  });

  it("reports a merge conflict with one conflicted path", async () => {
    const directory = divergedRepository();
    gitStderr(directory, ["merge", "--no-edit", "other"]);

    const result = await observed(directory);

    expect(result.operation).toEqual({ kind: "merge" });
    expect(result.counts).toMatchObject({ conflicted: 1 });
    expect(result.entries).toEqual([{ xy: "AA", path: "shared.txt" }]);
  });

  it("reports an am session as am, not as a rebase", async () => {
    const directory = repositoryWithCommit();
    writeFileSync(join(directory, "README.md"), "from patch\n");
    runGit(directory, ["commit", "--quiet", "--all", "--message", "patched"]);
    const patches = tempDirectory();
    runGit(directory, ["format-patch", "--quiet", "-1", "-o", patches]);
    runGit(directory, ["reset", "--quiet", "--hard", "HEAD~1"]);
    writeFileSync(join(directory, "README.md"), "different\n");
    runGit(directory, ["commit", "--quiet", "--all", "--message", "other"]);
    gitStderr(directory, ["am", join(patches, "0001-patched.patch")]);

    const result = await observed(directory);

    expect(result.operation).toEqual({ kind: "am" });
  });

  it("reports a cherry-pick, a revert, and a bisect", async () => {
    const cherry = divergedRepository();
    gitStderr(cherry, ["cherry-pick", "other"]);
    const revert = repositoryWithCommit();
    writeFileSync(join(revert, "README.md"), "changed\n");
    runGit(revert, ["commit", "--quiet", "--all", "--message", "change"]);
    writeFileSync(join(revert, "README.md"), "changed again\n");
    runGit(revert, ["commit", "--quiet", "--all", "--message", "again"]);
    gitStderr(revert, ["revert", "--no-edit", "HEAD~1"]);
    const bisect = repositoryWithCommit();
    commitFile(bisect, "next.txt");
    runGit(bisect, ["bisect", "start", "HEAD", "HEAD~1"]);

    expect((await observed(cherry)).operation).toEqual({ kind: "cherry-pick" });
    expect((await observed(revert)).operation).toEqual({ kind: "revert" });
    expect((await observed(bisect)).operation).toEqual({ kind: "bisect" });
  });
});

describe("stateRepository paths", () => {
  /** A repository with changes in the root, in `sub`, and in a sibling. */
  function changedTree() {
    const directory = repositoryWithCommit();
    for (const path of ["sub/deep/in.txt", "other/out.txt"]) {
      mkdirSync(join(directory, path, ".."), { recursive: true });
      writeFileSync(join(directory, path), "x\n");
    }
    runGit(directory, ["add", "."]);
    runGit(directory, ["commit", "--quiet", "--message", "tree"]);
    return directory;
  }

  it("reports paths relative to a subdirectory root, root paths first", async () => {
    const directory = changedTree();
    const root = join(directory, "sub", "deep");
    writeFileSync(join(directory, "other", "out.txt"), "changed\n");
    writeFileSync(join(directory, "sub", "deep", "in.txt"), "changed\n");
    writeFileSync(join(directory, "sub", "deep", "fresh.txt"), "new\n");
    writeFileSync(join(directory, "README.md"), "changed\n");

    const result = await observed(root);

    expect(result.rootRelative).toBe("sub/deep");
    expect(result.entries).toEqual([
      { xy: " M", path: "in.txt" },
      { xy: "??", path: "fresh.txt" },
      { xy: " M", path: "../../README.md" },
      { xy: " M", path: "../../other/out.txt" },
    ]);
  });

  it("lists an untracked directory as one entry", async () => {
    const directory = repositoryWithCommit();
    mkdirSync(join(directory, "build", "nested"), { recursive: true });
    writeFileSync(join(directory, "build", "a.txt"), "x\n");
    writeFileSync(join(directory, "build", "nested", "b.txt"), "x\n");

    const result = await observed(directory);

    expect(result.entries).toEqual([{ xy: "??", path: "build/" }]);
    expect(result.counts.untracked).toBe(1);
  });

  it("names a root that is itself an untracked directory as ./", async () => {
    const directory = repositoryWithCommit();
    const root = join(directory, "scratch");
    mkdirSync(root);
    writeFileSync(join(root, "a.txt"), "x\n");

    const result = await observed(root);

    expect(result.entries).toEqual([{ xy: "??", path: "./" }]);
  });

  it("counts paths above the bound as omitted", async () => {
    const directory = repositoryWithCommit();
    for (let index = 0; index < 26; index += 1) {
      writeFileSync(
        join(directory, `file-${String(index).padStart(2, "0")}.txt`),
        "x\n",
      );
    }

    const result = await observed(directory);
    const none = await observed(directory, { limit: 0 });

    expect(result.entries).toHaveLength(20);
    expect(result.entries[0]?.path).toBe("file-00.txt");
    expect(result.omitted).toBe(6);
    expect(result.counts.untracked).toBe(26);
    expect(none.entries).toEqual([]);
    expect(none.omitted).toBe(26);
    expect(none.counts.untracked).toBe(26);
  });
});

describe("stateRepository submodules", () => {
  function repositoryWithSubmodule() {
    const library = repositoryWithCommit();
    const directory = repositoryWithCommit();
    runGit(directory, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "--quiet",
      "add",
      library,
      "lib",
    ]);
    runGit(directory, ["commit", "--quiet", "--message", "add submodule"]);
    return directory;
  }

  it("lists a submodule path without its state", async () => {
    const directory = repositoryWithSubmodule();
    writeFileSync(join(directory, "lib", "README.md"), "dirty\n");

    const result = await observed(directory);

    expect(result.submodules).toEqual(["lib"]);
    expect(result.entries).toEqual([]);
    expect(result.counts.unstaged).toBe(0);
  });

  it("sees a dirty submodule with check and lists it once", async () => {
    const directory = repositoryWithSubmodule();
    writeFileSync(join(directory, "lib", "README.md"), "dirty\n");

    const result = await observed(directory, { submodules: "check" });

    expect(result.entries).toEqual([{ xy: " M", path: "lib" }]);
    expect(result.submodules).toEqual([]);
    expect(result.omitted).toBe(0);
  });

  it("shares the bound between changed paths and submodules", async () => {
    const directory = repositoryWithSubmodule();
    writeFileSync(join(directory, "new.txt"), "x\n");

    const result = await observed(directory, { limit: 1 });

    expect(result.entries).toEqual([{ xy: "??", path: "new.txt" }]);
    expect(result.submodules).toEqual([]);
    expect(result.omitted).toBe(1);
  });
});

describe("stateRepository pinning and refusals", () => {
  it("fails on an empty .git directory and never reads the parent repository", async () => {
    const parent = repositoryWithCommit();
    const nested = join(parent, "sub");
    mkdirSync(join(nested, ".git"), { recursive: true });
    const log = join(tempDirectory(), "argv.log");

    const result = await withGitShim(
      `echo "$@" >> '${log}'\nexec "$REAL_GIT" "$@"`,
      () => observe(nested),
    );

    expect(result).toMatchObject({ status: "error", type: "git_failed" });
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toContain(`-C ${nested} --work-tree=${nested}`);
    }
  });

  it("refuses a repository of another user and runs no filter from it", async () => {
    const directory = repositoryWithCommit();
    const marker = join(tempDirectory(), "filter-ran");
    writeFileSync(join(directory, ".gitattributes"), "*.txt filter=mark\n");
    writeFileSync(join(directory, "data.txt"), "data\n");
    runGit(directory, [
      "config",
      "filter.mark.clean",
      `touch '${marker}'; cat`,
    ]);
    runGit(directory, ["add", ".gitattributes", "data.txt"]);
    runGit(directory, ["commit", "--quiet", "--message", "attributes"]);
    writeFileSync(join(directory, "data.txt"), "changed\n");
    const refuse =
      'export GIT_TEST_ASSUME_DIFFERENT_OWNER=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1\nexec "$REAL_GIT" "$@"';

    // Without the refusal the filter does run, so the marker proves the test.
    await observed(directory);
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);

    const result = await withGitShim(refuse, () => observe(directory));

    expect(result).toMatchObject({ status: "error", type: "git_failed" });
    expect(JSON.stringify(result)).toContain("dubious ownership");
    expect(existsSync(marker)).toBe(false);
  });

  it("never runs a signature program named by the repository configuration", async () => {
    const directory = repositoryWithCommit();
    const marker = join(tempDirectory(), "gpg-ran");
    const program = join(tempDirectory(), "gpg");
    writeFileSync(program, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
    chmodSync(program, 0o755);
    const commit = runGit(directory, ["cat-file", "commit", "HEAD"]);
    const signed = commit.replace(
      "\n\n",
      "\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n abc\n -----END PGP SIGNATURE-----\n\n",
    );
    const id = execFileSync(
      "git",
      ["hash-object", "-t", "commit", "-w", "--stdin"],
      {
        ...GIT_OPTIONS,
        cwd: directory,
        input: signed,
      },
    ).trim();
    runGit(directory, ["update-ref", "HEAD", id]);
    runGit(directory, ["config", "log.showSignature", "true"]);
    runGit(directory, ["config", "gpg.program", program]);

    // The configuration is real: a plain `git log` runs the program.
    gitStderr(directory, ["log", "-1"]);
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);

    const result = await observed(directory);

    expect(result.commits).toHaveLength(1);
    expect(existsSync(marker)).toBe(false);
  });

  it("fails the whole call as output_bound when status output is cut", async () => {
    const directory = repositoryWithCommit();
    const folder = join(directory, "many");
    mkdirSync(folder);
    for (let index = 0; index < 6000; index += 1) {
      writeFileSync(join(folder, `${"n".repeat(200)}-${index}`), "");
    }
    runGit(directory, ["add", "many"]);

    const result = await observe(folder);

    expect(result).toEqual({
      status: "error",
      type: "output_bound",
      stderr: "",
    });
  });

  it("reports a git that outlives the deadline as timed_out", async () => {
    const directory = repositoryWithCommit();

    const result = await withSlowGit(() =>
      observe(directory, {}, { timeoutMs: 3000 }),
    );

    expect(result).toMatchObject({ status: "error", type: "timed_out" });
  });
});

describe("stateRepository admission", () => {
  it("fails as git_entry_changed when a nearer entry appears", async () => {
    const directory = repositoryWithCommit();
    const sub = join(directory, "sub");
    mkdirSync(sub);
    const located = await locateRepository({ path: sub });
    if (located.status !== "ok") throw new Error("expected a repository");
    mkdirSync(join(sub, ".git"));

    await expect(
      stateRepository({
        path: sub,
        gitEntry: located.gitEntry,
        limit: 20,
        submodules: "skip",
      }),
    ).resolves.toEqual({
      status: "error",
      type: "git_entry_changed",
      stderr: "",
    });
  });

  it("reports a missing path as root_missing", async () => {
    await expect(
      stateRepository({
        path: join(tempDirectory(), "missing"),
        gitEntry: "/x/.git",
        limit: 20,
        submodules: "skip",
      }),
    ).resolves.toMatchObject({ status: "error", type: "root_missing" });
  });

  it("refuses a relative path or entry before any lookup", async () => {
    const directory = repositoryWithCommit();
    for (const input of [
      { path: "relative", gitEntry: join(directory, ".git") },
      { path: directory, gitEntry: ".git" },
    ]) {
      await expect(
        stateRepository({ ...input, limit: 20, submodules: "skip" }),
      ).resolves.toMatchObject({ status: "error", type: "invalid_input" });
    }
  });

  it("refuses a common directory outside the confinement and starts no git", async () => {
    const main = repositoryWithCommit();
    const linked = join(tempDirectory(), "linked");
    runGit(main, ["worktree", "add", "--quiet", "-b", "feature", linked]);
    const marker = join(tempDirectory(), "started");

    const result = await withGitShim(`touch '${marker}'; exit 99`, () =>
      observe(linked, { confine: (path) => path.startsWith(linked) }),
    );

    expect(result).toEqual({
      status: "error",
      type: "outside_registered_root",
      stderr: "",
    });
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses an alternate outside the confinement, however deep", async () => {
    const directory = repositoryWithCommit();
    const outside = tempDirectory();
    const middle = join(directory, "middle-objects");
    mkdirSync(join(middle, "info"), { recursive: true });
    mkdirSync(join(directory, ".git", "objects", "info"), { recursive: true });
    writeFileSync(
      join(directory, ".git", "objects", "info", "alternates"),
      "# comment\n../../middle-objects\n",
    );
    writeFileSync(join(middle, "info", "alternates"), `${outside}\n`);
    const inside = (path: string) => path.startsWith(directory);

    await expect(
      observe(directory, { confine: inside }),
    ).resolves.toMatchObject({ type: "outside_registered_root" });
    writeFileSync(join(middle, "info", "alternates"), `${middle}\n`);
    await expect(
      observe(directory, { confine: inside }),
    ).resolves.toMatchObject({ status: "ok" });
  });

  it("follows the gitdir of a .git file for the confinement", async () => {
    const directory = tempDirectory();
    const elsewhere = tempDirectory();
    writeFileSync(join(directory, ".git"), `gitdir: ${elsewhere}\n`);

    await expect(
      observe(directory, { confine: (path) => path.startsWith(directory) }),
    ).resolves.toMatchObject({ type: "outside_registered_root" });

    writeFileSync(join(directory, ".git"), "not a gitdir line\n");
    await expect(
      observe(directory, { confine: () => true }),
    ).resolves.toMatchObject({ type: "git_failed" });
  });
});
