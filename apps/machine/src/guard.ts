import type { Stats } from "node:fs";
import { lstat, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { PATH_NOT_REGISTERED_MESSAGE } from "@workspace/machine-protocol";
import { MachineRequestError } from "./errors";

/** How many symbolic-link hops one resolution follows before refusing. */
const MAX_LINK_DEPTH = 16;

/** A path that passed root enforcement, with what the filesystem says of it. */
export type GuardedPath = {
  /** The path as submitted, lexically normalised. */
  readonly path: string;
  /** Where it resolves, which may not exist yet. */
  readonly canonical: string;
  readonly kind: "file" | "directory" | "other" | "missing";
  readonly size?: number;
  readonly isLink: boolean;
};

export type RootGuard = {
  readonly roots: ReadonlyArray<string>;
  /**
   * The path's guarded form, or the fixed refusal. Callers run it again after
   * the effect, which is the contract's re-verification after opening: a leaf
   * or ancestor swapped mid-operation resolves elsewhere and is refused.
   */
  resolvePath(path: string): Promise<GuardedPath>;
};

/** The one refusal, identical whether or not anything exists outside. */
function refuse(): never {
  throw new MachineRequestError(
    "path_not_registered",
    PATH_NOT_REGISTERED_MESSAGE,
  );
}

async function describe(target: string): Promise<Stats | undefined> {
  try {
    return await lstat(target);
  } catch {
    return undefined;
  }
}

async function describeFollowed(target: string): Promise<Stats | undefined> {
  try {
    return await stat(target);
  } catch {
    return undefined;
  }
}

/**
 * The canonical location of `target`, which need not exist: the deepest
 * existing ancestor is resolved as a whole and the missing suffix appended,
 * and a symbolic link at or above the missing part is followed by its own
 * text, so a link that points outside the roots cannot hide behind a target
 * that is not there yet.
 */
async function canonicalTarget(target: string, depth: number): Promise<string> {
  if (depth > MAX_LINK_DEPTH) refuse();
  try {
    return await realpath(target);
  } catch {
    // Missing, dangling, or unresolvable here; the steps below decide.
  }
  const parent = dirname(target);
  if (parent === target) return target;
  const entry = await describe(target);
  if (entry !== undefined && entry.isSymbolicLink()) {
    const hop = await readlink(target).catch(() => undefined);
    if (hop === undefined) refuse();
    return canonicalTarget(
      isAbsolute(hop) ? hop : join(parent, hop),
      depth + 1,
    );
  }
  return join(await canonicalTarget(parent, depth), basename(target));
}

export function createRootGuard(roots: ReadonlyArray<string>): RootGuard {
  const canonicalRoots = roots.map((root) => resolve(root));

  function isInside(target: string): boolean {
    return canonicalRoots.some(
      (root) =>
        target === root || target.startsWith(root === "/" ? "/" : `${root}/`),
    );
  }

  async function resolvePath(path: string): Promise<GuardedPath> {
    if (!isAbsolute(path) || path.includes("\0"))
      throw new MachineRequestError(
        "invalid_params",
        "A Machine path must be an absolute POSIX path.",
      );
    const lexical = resolve(path);
    // Lexical first, before any probe: a path outside the roots is refused
    // whether or not anything exists there.
    if (!isInside(lexical)) refuse();
    const canonical = await canonicalTarget(lexical, 0);
    if (!isInside(canonical)) refuse();
    const entry = await describe(lexical);
    const followed = await describeFollowed(lexical);
    const isLink = entry !== undefined && entry.isSymbolicLink();
    if (followed === undefined)
      return { path: lexical, canonical, kind: "missing", isLink };
    return {
      path: lexical,
      canonical,
      kind: followed.isFile()
        ? "file"
        : followed.isDirectory()
          ? "directory"
          : "other",
      size: followed.size,
      isLink,
    };
  }

  return { roots: canonicalRoots, resolvePath };
}
