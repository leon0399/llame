import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { GitStateSuccess } from "@workspace/machine-protocol";

/*
 * What `git.state` reads from the repository's own files instead of from git:
 * the directories its data lives in (checked against the registered roots
 * before any git process runs) and the marker files of an operation in
 * progress.
 */

const MAX_ALTERNATE_DEPTH = 5;

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The git directory: the entry itself, or the target of a `gitdir:` file. */
async function gitDirectory(
  gitEntry: string,
  kind: "directory" | "file",
): Promise<string | undefined> {
  if (kind === "directory") return gitEntry;
  const text = await readText(gitEntry);
  const target = /^gitdir:[ \t]*(.+?)[ \t]*$/mu.exec(text ?? "")?.[1];
  return target === undefined ? undefined : resolve(dirname(gitEntry), target);
}

/** The lines of an `alternates` file: blank lines and comments are skipped. */
async function alternateLines(
  objectsDirectory: string,
): Promise<Array<string>> {
  const text = await readText(join(objectsDirectory, "info", "alternates"));
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => resolve(objectsDirectory, line));
}

/** Each alternate object directory, followed to its own alternates. */
async function alternates(
  objectsDirectory: string,
  seen: Set<string>,
  depth: number,
): Promise<Array<string>> {
  const found: Array<string> = [];
  for (const alternate of await alternateLines(objectsDirectory)) {
    if (seen.has(alternate)) continue;
    seen.add(alternate);
    found.push(alternate);
    if (depth < MAX_ALTERNATE_DEPTH) {
      found.push(...(await alternates(alternate, seen, depth + 1)));
    }
  }
  return found;
}

/**
 * Every directory the repository's data lives in: the git directory, the
 * common directory, and the alternate object directories. `undefined` when a
 * `.git` file does not name a git directory.
 */
export async function repositoryDirectories(
  gitEntry: string,
  kind: "directory" | "file",
): Promise<Array<string> | undefined> {
  const gitDir = await gitDirectory(gitEntry, kind);
  if (gitDir === undefined) return undefined;
  const common = (await readText(join(gitDir, "commondir")))?.trim();
  const commonDir = common ? resolve(gitDir, common) : gitDir;
  const objects = join(commonDir, "objects");
  return [
    gitDir,
    commonDir,
    ...(await alternates(objects, new Set([objects]), 1)),
  ];
}

type Operation = {
  kind: NonNullable<GitStateSuccess["operation"]>["kind"];
  step?: number;
  total?: number;
};

async function number(path: string): Promise<number | undefined> {
  const value = Number.parseInt((await readText(path)) ?? "", 10);
  return Number.isNaN(value) ? undefined : value;
}

async function withSteps(
  kind: Operation["kind"],
  directory: string,
  current: string,
  last: string,
): Promise<Operation> {
  const step = await number(join(directory, current));
  const total = await number(join(directory, last));
  const operation: Operation = { kind };
  if (step !== undefined) operation.step = step;
  if (total !== undefined) operation.total = total;
  return operation;
}

/**
 * The operation in progress, from `rev-parse --git-path` locations in this
 * order: `rebase-merge`, `rebase-apply`, merge, cherry-pick, revert, bisect.
 */
export async function detectOperation(paths: {
  readonly mergeHead: string;
  readonly rebaseMerge: string;
  readonly rebaseApply: string;
  readonly cherryPickHead: string;
  readonly revertHead: string;
  readonly bisectLog: string;
}): Promise<Operation | null> {
  if (await exists(paths.rebaseMerge)) {
    return withSteps("rebase", paths.rebaseMerge, "msgnum", "end");
  }
  if (await exists(paths.rebaseApply)) {
    return (await exists(join(paths.rebaseApply, "applying")))
      ? { kind: "am" }
      : withSteps("rebase", paths.rebaseApply, "next", "last");
  }
  const markers: ReadonlyArray<readonly [string, Operation["kind"]]> = [
    [paths.mergeHead, "merge"],
    [paths.cherryPickHead, "cherry-pick"],
    [paths.revertHead, "revert"],
    [paths.bisectLog, "bisect"],
  ];
  for (const [path, kind] of markers) {
    if (await exists(path)) return { kind };
  }
  return null;
}
