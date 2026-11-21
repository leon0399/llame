/**
 * The daemon's root guard, re-expressed for the file peer (host-as-machine
 * layer 3): the same lexical-then-canonical containment, the same symbolic
 * link walk for a target that does not exist yet, and the same refusal the
 * daemon answers as `path_not_registered`. Split from the peer so each file
 * stays small; the daemon suite owns the behaviour's parity.
 *
 * Deliberately under `src/testing/`: scaffolding, excluded from coverage and
 * mutation, never imported by production code.
 */

import { lstat, readlink, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const MAX_LINK_DEPTH = 16;

/** A path that passed root enforcement, with what the filesystem says of it. */
export type GuardedPath = {
  readonly path: string;
  readonly canonical: string;
  readonly kind: 'file' | 'directory' | 'other' | 'missing';
  readonly size?: number;
  readonly isLink: boolean;
};

/** A refusal the daemon would answer as a JSON-RPC error. */
export class PeerRefusal extends Error {
  constructor(readonly code: 'path_not_registered' | 'invalid_params') {
    super(code);
  }
}

function isAbsentEntry(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

async function describe(
  target: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(target);
  } catch {
    return undefined;
  }
}

async function describeFollowed(
  target: string,
): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(target);
  } catch {
    return undefined;
  }
}

function insideRoots(roots: ReadonlyArray<string>, path: string): boolean {
  return roots.some(
    (root) => root === '/' || path === root || path.startsWith(`${root}/`),
  );
}

/**
 * The canonical location of `target`, which need not exist: the deepest
 * existing ancestor is resolved as a whole and the missing suffix appended,
 * following a symbolic link at or above the missing part by its own text.
 */
async function canonicalTarget(target: string, depth: number): Promise<string> {
  if (depth > MAX_LINK_DEPTH) throw new PeerRefusal('path_not_registered');

  try {
    return await realpath(target);
  } catch (error) {
    if (!isAbsentEntry(error)) throw new PeerRefusal('path_not_registered');
  }

  const parent = dirname(target);

  if (parent === target) return target;
  const entry = await describe(target);

  if (entry !== undefined && entry.isSymbolicLink()) {
    const hop = await readlink(target).catch(() => undefined);

    if (hop === undefined) throw new PeerRefusal('path_not_registered');

    return canonicalTarget(
      isAbsolute(hop) ? hop : join(await canonicalTarget(parent, depth), hop),
      depth + 1,
    );
  }

  return join(await canonicalTarget(parent, depth), basename(target));
}

/** The guard every file answer resolves its path through. */
export function rootGuard(roots: ReadonlyArray<string>) {
  const canonicalRoots = roots.map((root) => resolve(root));

  return async function resolvePath(path: string): Promise<GuardedPath> {
    if (!isAbsolute(path) || path.includes('\0'))
      throw new PeerRefusal('invalid_params');
    const lexical = resolve(path);

    if (!insideRoots(canonicalRoots, lexical))
      throw new PeerRefusal('path_not_registered');
    const canonical = await canonicalTarget(lexical, 0);

    if (!insideRoots(canonicalRoots, canonical))
      throw new PeerRefusal('path_not_registered');
    const isLink = (await describe(lexical))?.isSymbolicLink() ?? false;
    const followed = await describeFollowed(lexical);

    if (followed === undefined)
      return { path: lexical, canonical, kind: 'missing', isLink };

    return {
      path: lexical,
      canonical,
      kind: followed.isFile()
        ? 'file'
        : followed.isDirectory()
          ? 'directory'
          : 'other',
      size: Number(followed.size),
      isLink,
    };
  };
}
