import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { locateRepository } from "./locate";
import {
  cleanupRepositories,
  initRepository,
  repositoryWithCommit,
  runGit,
  tempDirectory,
  withGitShim,
} from "./testing";

/**
 * Stat-walk tests of `git.locate`.
 *
 * Covers openspec `workspace-git-state` — "A subdirectory root finds the
 * repository entry", "A linked worktree uses its own .git file", "A plain
 * folder is not a repository", and the ceiling's `no_repository_in_root`.
 */
afterAll(cleanupRepositories);

describe("locateRepository", () => {
  it("finds the repository entry from a subdirectory root", async () => {
    const directory = repositoryWithCommit();
    const sub = join(directory, "packages", "app");
    mkdirSync(sub, { recursive: true });

    await expect(locateRepository({ path: sub })).resolves.toEqual({
      status: "ok",
      gitEntry: join(directory, ".git"),
      kind: "directory",
    });
  });

  it("uses the .git file of a linked worktree, not the main clone's", async () => {
    const main = repositoryWithCommit();
    const linked = join(tempDirectory(), "linked");
    runGit(main, ["worktree", "add", "--quiet", "-b", "feature", linked]);

    await expect(locateRepository({ path: linked })).resolves.toEqual({
      status: "ok",
      gitEntry: join(linked, ".git"),
      kind: "file",
    });
  });

  it("reports a plain folder as not a repository", async () => {
    await expect(
      locateRepository({ path: tempDirectory() }),
    ).resolves.toMatchObject({ status: "error", type: "not_a_repository" });
  });

  it("stops at the ceiling and reports no repository in the root", async () => {
    const outer = initRepository(tempDirectory());
    const root = join(outer, "root");
    const sub = join(root, "sub");
    mkdirSync(sub, { recursive: true });

    await expect(
      locateRepository({ path: sub, ceiling: root }),
    ).resolves.toMatchObject({
      status: "error",
      type: "no_repository_in_root",
    });
  });

  it("stops at a ceiling written with a trailing slash or a .. segment", async () => {
    const outer = initRepository(tempDirectory());
    const root = join(outer, "root");
    const sub = join(root, "sub");
    mkdirSync(sub, { recursive: true });

    for (const ceiling of [`${root}/`, join(sub, "..")]) {
      await expect(
        locateRepository({ path: sub, ceiling }),
      ).resolves.toMatchObject({
        status: "error",
        type: "no_repository_in_root",
      });
    }
  });

  it("normalizes the path before walking", async () => {
    const root = initRepository(tempDirectory());
    const sub = join(root, "sub");
    mkdirSync(sub);

    await expect(
      locateRepository({ path: `${sub}/../sub/`, ceiling: root }),
    ).resolves.toMatchObject({ status: "ok", gitEntry: join(root, ".git") });
  });

  it("finds an entry in the ceiling directory itself", async () => {
    const root = initRepository(tempDirectory());
    const sub = join(root, "sub");
    mkdirSync(sub);

    await expect(
      locateRepository({ path: sub, ceiling: root }),
    ).resolves.toMatchObject({ status: "ok", gitEntry: join(root, ".git") });
  });

  it("prefers the nearest entry over a parent repository", async () => {
    const parent = repositoryWithCommit();
    const nested = join(parent, "nested");
    mkdirSync(join(nested, ".git"), { recursive: true });

    await expect(locateRepository({ path: nested })).resolves.toEqual({
      status: "ok",
      gitEntry: join(nested, ".git"),
      kind: "directory",
    });
  });

  it("takes the kind of a symlinked entry from its target", async () => {
    const directory = tempDirectory();
    const target = join(tempDirectory(), "real-git");
    mkdirSync(target);
    symlinkSync(target, join(directory, ".git"));

    await expect(locateRepository({ path: directory })).resolves.toEqual({
      status: "ok",
      gitEntry: join(directory, ".git"),
      kind: "directory",
    });
  });

  it("reports a missing path and a file as root_missing", async () => {
    const directory = tempDirectory();
    writeFileSync(join(directory, "file"), "x");

    for (const path of [join(directory, "missing"), join(directory, "file")]) {
      await expect(locateRepository({ path })).resolves.toMatchObject({
        status: "error",
        type: "root_missing",
      });
    }
  });

  it("refuses a relative path before any lookup", async () => {
    await expect(locateRepository({ path: "relative" })).resolves.toMatchObject(
      { status: "error", type: "invalid_input" },
    );
    await expect(
      locateRepository({ path: tempDirectory(), ceiling: "relative" }),
    ).resolves.toMatchObject({ status: "error", type: "invalid_input" });
  });

  it("starts no git process", async () => {
    const directory = repositoryWithCommit();
    const marker = join(tempDirectory(), "started");

    const result = await withGitShim(`touch '${marker}'; exit 99`, () =>
      locateRepository({ path: directory }),
    );

    expect(result).toMatchObject({ status: "ok" });
    expect(existsSync(marker)).toBe(false);
  });

  it("reports an aborted walk as timed_out", async () => {
    await expect(
      locateRepository(
        { path: tempDirectory() },
        { signal: AbortSignal.abort() },
      ),
    ).resolves.toMatchObject({ status: "error", type: "timed_out" });
  });
});
