import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  absoluteGitPath,
  gitFailure,
  DEFAULT_GIT_TIMEOUT_MS,
  type GitCallOptions,
} from "./invocation";
import type {
  GitFailure,
  GitLocateResult,
  GitLocateSuccess,
} from "@workspace/machine-protocol";

/*
 * `git.locate`: the nearest `.git` entry at or above a directory, found with
 * `stat` alone. No git process starts, so a model-facing caller can decide
 * whether it may read the entry before git ever does.
 */

export type LocateInput = {
  readonly path: string;
  /** An absolute directory that holds `path`; the walk ends there. */
  readonly ceiling?: string;
};

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/** The entry a directory holds, following a symlink to its target's kind. */
async function entryIn(
  directory: string,
): Promise<GitLocateSuccess | undefined> {
  const gitEntry = join(directory, ".git");
  try {
    const found = await stat(gitEntry);
    if (found.isDirectory())
      return { status: "ok", gitEntry, kind: "directory" };
    if (found.isFile()) return { status: "ok", gitEntry, kind: "file" };
    return undefined;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Walk from `path` to the ceiling (or `/`); the nearest entry wins. */
export async function locateNearest(
  input: LocateInput,
  options: { readonly endsAt: number; readonly signal?: AbortSignal },
): Promise<GitLocateResult> {
  if (!(await isDirectory(input.path))) return gitFailure("root_missing");
  let directory = input.path;
  try {
    for (;;) {
      if (options.signal?.aborted || Date.now() > options.endsAt) {
        return gitFailure("timed_out");
      }
      const found = await entryIn(directory);
      if (found !== undefined) return found;
      const parent = dirname(directory);
      if (parent === directory || directory === input.ceiling) break;
      directory = parent;
    }
  } catch (error) {
    return gitFailure(
      "git_failed",
      error instanceof Error ? error.message : "",
    );
  }
  return gitFailure(
    input.ceiling === undefined ? "not_a_repository" : "no_repository_in_root",
  );
}

/** The absolute-path refusal for a path and an optional ceiling; both come
 *  back normalized, so a trailing slash or `..` cannot miss the ceiling. */
export function absoluteLocateInput(
  input: LocateInput,
): LocateInput | Extract<GitFailure, { readonly type: "invalid_input" }> {
  const path = absoluteGitPath(input.path);
  if ("status" in path) return path;
  if (input.ceiling === undefined) return { path: resolve(path.path) };
  const ceiling = absoluteGitPath(input.ceiling);
  if ("status" in ceiling) return ceiling;
  return { path: resolve(path.path), ceiling: resolve(ceiling.path) };
}

export async function locateRepository(
  input: LocateInput,
  options: GitCallOptions = {},
): Promise<GitLocateResult> {
  const checked = absoluteLocateInput(input);
  if ("status" in checked) return checked;
  return locateNearest(checked, {
    endsAt: Date.now() + (options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS),
    signal: options.signal,
  });
}
