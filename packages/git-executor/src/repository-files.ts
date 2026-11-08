import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { GitStateSuccess } from "@workspace/machine-protocol";

/*
 * What `git.state` reads from the repository's own files instead of from git:
 * the directories its data lives in (checked against the registered roots
 * before any git process runs) and the marker files of an operation in
 * progress.
 */

/** A longer chain of alternates is refused, not followed. */
const MAX_ALTERNATE_CHAIN = 64;

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

/** The real path, or `undefined` for one that does not exist. */
export async function realPath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

type RepositoryFailure = {
  readonly failure: "no_git_directory" | "unconfinable";
};

const UNCONFINABLE = { failure: "unconfinable" } as const;
const NO_GIT_DIRECTORY = { failure: "no_git_directory" } as const;

/**
 * The one value of a file git reads as a path: the text without its single
 * trailing line break. A NUL byte or a further line break makes git and this
 * parser read different paths, so such a file has no value.
 */
function singleLine(text: string): string | undefined {
  const body = text.replace(/\r?\n$/u, "");
  return /[\0\r\n]/u.test(body) ? undefined : body;
}

/** The git directory: the entry itself, or the target of a `gitdir:` file. */
async function gitDirectory(
  gitEntry: string,
  kind: "directory" | "file",
): Promise<{ readonly path: string } | RepositoryFailure> {
  if (kind === "directory") return { path: gitEntry };
  const text = await readText(gitEntry);
  if (text === undefined) return NO_GIT_DIRECTORY;
  const line = singleLine(text);
  if (line === undefined) return UNCONFINABLE;
  const target = /^gitdir:[ \t]*(.+?)[ \t]*$/u.exec(line)?.[1];
  return target === undefined
    ? NO_GIT_DIRECTORY
    : { path: resolve(dirname(gitEntry), target) };
}

/** The lines of an `alternates` file: blank lines and comments are skipped. */
async function alternateLines(
  objectsDirectory: string,
): Promise<Array<string>> {
  const text = await readText(join(objectsDirectory, "info", "alternates"));
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * Each alternate object directory, followed to its own alternates, as real
 * paths. `undefined` when one cannot be judged: a line git would C-unquote
 * (it starts with `"`), a directory that does not exist, or a chain longer
 * than the cap.
 */
async function alternates(
  objectsDirectory: string,
  seen: Set<string>,
  depth: number,
): Promise<Array<string> | undefined> {
  if (depth > MAX_ALTERNATE_CHAIN) return undefined;
  const found: Array<string> = [];
  for (const line of await alternateLines(objectsDirectory)) {
    if (line.startsWith('"')) return undefined;
    const alternate = await realPath(resolve(objectsDirectory, line));
    if (alternate === undefined) return undefined;
    if (seen.has(alternate)) continue;
    seen.add(alternate);
    found.push(alternate);
    const nested = await alternates(alternate, seen, depth + 1);
    if (nested === undefined) return undefined;
    found.push(...nested);
  }
  return found;
}

/** The directories of a repository, or why they cannot be listed: a `.git`
 *  file that names no git directory, or a path that cannot be confined. */
export type RepositoryDirectories =
  | { readonly directories: Array<string> }
  | RepositoryFailure;

/**
 * Every directory the repository's data lives in, as real paths: the git
 * directory, the common directory, `objects`, and the alternate object
 * directories.
 */
export async function repositoryDirectories(
  gitEntry: string,
  kind: "directory" | "file",
): Promise<RepositoryDirectories> {
  const named = await gitDirectory(gitEntry, kind);
  if ("failure" in named) return named;
  const gitDir = await realPath(named.path);
  if (gitDir === undefined) return UNCONFINABLE;
  const commonText = await readText(join(gitDir, "commondir"));
  const common = commonText === undefined ? "" : singleLine(commonText)?.trim();
  if (common === undefined) return UNCONFINABLE;
  const commonDir = await realPath(common ? resolve(gitDir, common) : gitDir);
  if (commonDir === undefined) return UNCONFINABLE;
  const objects = await realPath(join(commonDir, "objects"));
  if (objects === undefined) return UNCONFINABLE;
  const found = await alternates(objects, new Set([objects]), 1);
  if (found === undefined) return UNCONFINABLE;
  return { directories: [gitDir, commonDir, objects, ...found] };
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

/** The paths `rev-parse --git-path` locates, in the order it is asked. */
export const OPERATION_PATHS = [
  "MERGE_HEAD",
  "rebase-merge",
  "rebase-apply",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
] as const;

export type OperationPath = (typeof OPERATION_PATHS)[number];

/**
 * The operation in progress, from `rev-parse --git-path` locations in this
 * order: `rebase-merge`, `rebase-apply`, merge, cherry-pick, revert, bisect.
 * `located` gives the absolute path of one of {@link OPERATION_PATHS}.
 */
export async function detectOperation(
  located: (name: OperationPath) => string,
): Promise<Operation | null> {
  const rebaseMerge = located("rebase-merge");
  if (await exists(rebaseMerge)) {
    return withSteps("rebase", rebaseMerge, "msgnum", "end");
  }
  const rebaseApply = located("rebase-apply");
  if (await exists(rebaseApply)) {
    return (await exists(join(rebaseApply, "applying")))
      ? { kind: "am" }
      : withSteps("rebase", rebaseApply, "next", "last");
  }
  const markers: ReadonlyArray<readonly [OperationPath, Operation["kind"]]> = [
    ["MERGE_HEAD", "merge"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
    ["BISECT_LOG", "bisect"],
  ];
  for (const [name, kind] of markers) {
    if (await exists(located(name))) return { kind };
  }
  return null;
}
