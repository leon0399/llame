import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { statusRepository } from "./status";
import {
  cleanupRepositories,
  commitFile,
  initRepository,
  runGit,
  tempDirectory,
  withSlowGit,
} from "./testing";

/**
 * Real-git tests of `git.status` against throwaway repositories, under the
 * same conventions as `inspect.test.ts`.
 *
 * Covers openspec `repositories` — "Executors expose typed git operations".
 */
afterAll(cleanupRepositories);

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
    await withSlowGit(async () => {
      const result = await statusRepository(
        { path: directory },
        { timeoutMs: 200 },
      );

      expect(result).toMatchObject({ status: "error", type: "timed_out" });
    });
  });
});
