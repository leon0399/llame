import { stat } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";

import type { GrepIgnoreFile } from "./types";

/** The two ignore files one directory holds, `.ignore` last because it wins. */
export const GREP_IGNORE_FILE_NAMES = [".gitignore", ".ignore"] as const;

export type GrepIgnoreFileName = (typeof GREP_IGNORE_FILE_NAMES)[number];

/** The directories an ignore walk reads above a scope prefix, shallowest first. */
export function ignoreAncestorDirectories(
  prefix: string,
  root: string,
): ReadonlyArray<string> {
  if (prefix === root) return [];
  const directories: Array<string> = [];
  let current = dirname(prefix);

  for (;;) {
    directories.push(current);

    if (current === root) break;
    const parent = dirname(current);

    if (parent === current) break;
    current = parent;
  }

  return directories.reverse();
}

/** The path from one ancestor directory to the prefix, `/`-separated and ending with '/'. */
export function ignoreAbovePath(directory: string, prefix: string): string {
  return `${relative(directory, prefix).split(sep).join("/")}/`;
}

/** Whether `directory` is `ancestor` or below it. */
export function isAtOrBelow(directory: string, ancestor: string): boolean {
  return (
    directory === ancestor ||
    directory.startsWith(ancestor === "/" ? "/" : `${ancestor}/`)
  );
}

async function holdsGitEntry(directory: string): Promise<boolean> {
  try {
    const stats = await stat(`${directory}/.git`);

    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

/**
 * The nearest directory from the prefix up to `root` that holds a `.git`
 * entry, or `fallback` when there is none. The fallback makes the root the
 * repository directory on a Machine.
 */
export async function repositoryDirectory(
  prefix: string,
  root: string,
  fallback: string | undefined,
): Promise<string | undefined> {
  let current = prefix;

  for (;;) {
    if (await holdsGitEntry(current)) return current;

    if (current === root) return fallback;
    const parent = dirname(current);

    if (parent === current) return fallback;
    current = parent;
  }
}

/** Reads one ignore file of an absolute directory, or undefined when absent. */
export type ReadIgnoreFile = (
  directory: string,
  name: GrepIgnoreFileName,
) => Promise<string | undefined>;

/** Where one walk's ancestor ignore files come from. */
export type AncestorIgnoreInput = {
  readonly prefix: string;
  /** The directory the walk stops at: `/` or the registered root. */
  readonly root: string;
  /** The repository directory when no `.git` is found up to `root`. */
  readonly fallbackRepository: string | undefined;
  readonly signal?: AbortSignal;
};

/**
 * Every ignore file from the stop root down to the prefix's parent:
 * `.gitignore` from the repository directory down, and `.ignore` everywhere.
 */
export async function collectAncestorIgnoreFiles(
  input: AncestorIgnoreInput,
  read: ReadIgnoreFile,
): Promise<ReadonlyArray<GrepIgnoreFile>> {
  const repository = await repositoryDirectory(
    input.prefix,
    input.root,
    input.fallbackRepository,
  );

  const files: Array<GrepIgnoreFile> = [];

  for (const directory of ignoreAncestorDirectories(input.prefix, input.root)) {
    input.signal?.throwIfAborted();
    const above = ignoreAbovePath(directory, input.prefix);

    if (repository !== undefined && isAtOrBelow(directory, repository)) {
      const gitignore = await read(directory, ".gitignore");

      if (gitignore !== undefined) files.push({ above, text: gitignore });
    }

    const ignore = await read(directory, ".ignore");

    if (ignore !== undefined) files.push({ above, text: ignore });
  }

  return files;
}
