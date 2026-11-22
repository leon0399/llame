/**
 * The daemon side of the git and `fs.stat` methods for hub unit tests
 * (host-as-machine git layer): the real `@workspace/git-executor` operations
 * run against this process's filesystem behind the real wire, with the same
 * registered-root enforcement, locator rendering, and display prefix the daemon
 * applies.
 *
 * The api unit project builds nothing from `apps/machine`, so a hub test cannot
 * spawn the real daemon; this answer keeps the hub's own dispatch, failure
 * vocabulary, and locator mapping real while the daemon's parsing stays the
 * daemon suite's concern. The integration suites use the real child instead.
 *
 * Deliberately under `src/testing/`: scaffolding, excluded from coverage and
 * mutation, never imported by production code.
 */

import { lstat, realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';

import {
  addWorktree,
  inspectRepository,
  listWorktrees,
  locateRepository,
  removeWorktree,
  stateRepository,
} from '@workspace/git-executor';
import {
  GIT_INSPECT_METHOD,
  GIT_LOCATE_METHOD,
  GIT_METHODS,
  GIT_STATE_METHOD,
  GIT_WORKTREE_ADD_METHOD,
  GIT_WORKTREE_LIST_METHOD,
  GIT_WORKTREE_REMOVE_METHOD,
  type FsStatResult,
  type JsonValue,
} from '@workspace/machine-protocol';
import { z } from 'zod';

import type { PeerAnswer, PeerCall } from './machine-protocol-peer';

/** Every method a daemon that answers this helper advertises in `hello`. */
export const GIT_SURFACE: ReadonlyArray<string> = [...GIT_METHODS];

const GIT_METHOD_NAMES: ReadonlyArray<string> = GIT_METHODS;

/** The methods this helper answers: every git method and the path probe. */
const answeredMethods = new Set<string>(['fs.stat', ...GIT_METHOD_NAMES]);

export type GitMachineAnswersOptions = {
  /** The registered roots, canonicalized here as `roots add` does. */
  readonly roots: ReadonlyArray<string>;
  /**
   * Answer one request before the real operation: a scripted refusal or answer
   * for one path, as a suite needs. `undefined` falls through.
   */
  readonly answer?: (
    call: PeerCall,
  ) => PeerAnswer | Promise<PeerAnswer> | undefined;
};

/** A result path outside every registered root: the daemon's own refusal. */
class OutsideRoots extends Error {}

const displayOptions = z.looseObject({
  displayPrefix: z.string(),
  selector: z.string().optional(),
  reserveCodeUnits: z.number().optional(),
});

const optionsParams = z.looseObject({ options: displayOptions });

const pathParams = z.looseObject({ path: z.string() });

const sourceParams = z.looseObject({ source: z.string() });

const stateParams = z.looseObject({
  path: z.string(),
  gitEntry: z.string(),
  limit: z.number(),
  submodules: z.enum(['skip', 'check']),
  timeoutMs: z.number().optional(),
});

const worktreeAddParams = z.looseObject({
  source: z.string(),
  branch: z.string(),
  baseRef: z.string().optional(),
  directory: z.string(),
});

/** One root bounds `value` when it is the root itself or sits below it. */
function within(root: string, value: string): boolean {
  const base = root.length > 1 && root.endsWith('/') ? root.slice(0, -1) : root;

  if (base === '/') return value.startsWith('/');

  return value === base || value.startsWith(`${base}/`);
}

function insideRoots(roots: ReadonlyArray<string>, value: string): boolean {
  return roots.some((root) => within(root, value));
}

function displayPrefix(call: PeerCall): string {
  return optionsParams.parse(call.params).options.displayPrefix;
}

/** One absolute path of a request, in the locator form of this Machine. */
function resultLocator(
  prefix: string,
  roots: ReadonlyArray<string>,
  value: string,
): string {
  if (!insideRoots(roots, value)) throw new OutsideRoots();

  return `${prefix}${value}`;
}

/**
 * The canonical location of `value`, which need not exist: its deepest existing
 * ancestor is resolved, and the segments below it are appended lexically.
 */
async function canonicalOf(value: string): Promise<string> {
  const segments = value.split('/');

  for (let end = segments.length; end >= 1; end -= 1) {
    const ancestor = segments.slice(0, end).join('/') || '/';
    const resolved = await realpath(ancestor).catch(() => undefined);

    if (resolved !== undefined)
      return path.posix.join(resolved, ...segments.slice(end));
  }

  return path.posix.normalize(value);
}

/** The path guard: the daemon refuses every address no root bounds. */
async function guardedPath(
  roots: ReadonlyArray<string>,
  value: string,
): Promise<string> {
  if (!path.posix.isAbsolute(value))
    throw new Error(`A Machine path must be absolute: ${value}`);

  const canonical = await canonicalOf(value);

  if (!insideRoots(roots, canonical)) throw new OutsideRoots();

  return canonical;
}

/** The outermost registered root that holds `value`, as `git.locate` passes it. */
function ceilingOf(
  roots: ReadonlyArray<string>,
  value: string,
): string | undefined {
  return roots
    .filter((root) => within(root, value))
    .sort((first, second) => first.length - second.length)[0];
}

async function statAnswer(
  roots: ReadonlyArray<string>,
  value: string,
): Promise<FsStatResult> {
  const canonical = await guardedPath(roots, value);
  const entry = await stat(canonical).catch(() => undefined);
  const link = await lstat(value).catch(() => undefined);

  if (entry === undefined)
    return { kind: 'missing', isLink: link?.isSymbolicLink() === true };

  const kind = entry.isDirectory()
    ? 'directory'
    : entry.isFile()
      ? 'file'
      : 'other';

  return {
    kind,
    isLink: link?.isSymbolicLink() === true,
    realPath: canonical,
    size: entry.size,
  };
}

/** The typed git answer for one request, or `undefined` for another method. */
async function gitResult(
  roots: ReadonlyArray<string>,
  prefix: string,
  call: PeerCall,
): Promise<JsonValue> {
  switch (call.method) {
    case GIT_INSPECT_METHOD:
      return inspect(roots, prefix, call);
    case GIT_LOCATE_METHOD:
      return locate(roots, prefix, call);
    case GIT_STATE_METHOD:
      return state(roots, prefix, call);
    case GIT_WORKTREE_ADD_METHOD:
      return worktreeAdd(roots, prefix, call);
    case GIT_WORKTREE_LIST_METHOD:
      return worktreeList(roots, prefix, call);
    case GIT_WORKTREE_REMOVE_METHOD:
      return removeWorktreeAt(roots, call);
    default:
      throw new Error(`gitMachineAnswers does not answer ${call.method}`);
  }
}

/**
 * The answer function one protocol peer uses: `fs.stat` and every `git.*`
 * method answer from the real filesystem and the real git, or the daemon's
 * `path_not_registered` refusal.
 */
export function gitMachineAnswers(
  options: GitMachineAnswersOptions,
): (call: PeerCall) => PeerAnswer | Promise<PeerAnswer> | undefined {
  const roots = options.roots.map((root) => realpathSync(root));

  return (call) => {
    const scripted = options.answer?.(call);

    if (scripted !== undefined) return scripted;

    if (!answeredMethods.has(call.method)) return undefined;

    return answer(roots, call).catch((error: unknown) => {
      if (error instanceof OutsideRoots)
        return { error: 'path_not_registered' };

      throw error;
    });
  };
}

async function answer(
  roots: ReadonlyArray<string>,
  call: PeerCall,
): Promise<PeerAnswer> {
  if (call.method === 'fs.stat') {
    const entry = await statAnswer(roots, pathParams.parse(call.params).path);

    return { value: wireJson(entry) };
  }

  return { value: await gitResult(roots, displayPrefix(call), call) };
}

async function inspect(
  roots: ReadonlyArray<string>,
  prefix: string,
  call: PeerCall,
): Promise<JsonValue> {
  const { path: submitted } = pathParams.parse(call.params);
  const target = await guardedPath(roots, submitted);
  const result = await inspectRepository({ path: target });

  if (result.status === 'error') return wireJson(result);

  return wireJson({
    ...result,
    toplevel: resultLocator(prefix, roots, result.toplevel),
    commonDir: resultLocator(prefix, roots, result.commonDir),
    mainWorktree:
      result.mainWorktree === null
        ? null
        : resultLocator(prefix, roots, result.mainWorktree),
  });
}

async function locate(
  roots: ReadonlyArray<string>,
  prefix: string,
  call: PeerCall,
): Promise<JsonValue> {
  const { path: submitted } = pathParams.parse(call.params);
  const target = await guardedPath(roots, submitted);

  const result = await locateRepository({
    path: target,
    ceiling: ceilingOf(roots, target),
  });

  if (result.status === 'error') return wireJson(result);

  return wireJson({
    ...result,
    gitEntry: resultLocator(prefix, roots, result.gitEntry),
  });
}

async function state(
  roots: ReadonlyArray<string>,
  prefix: string,
  call: PeerCall,
): Promise<JsonValue> {
  const state = stateParams.parse(call.params);
  const target = await guardedPath(roots, state.path);
  const entry = path.posix.normalize(state.gitEntry);

  const result = await stateRepository({
    path: target,
    gitEntry: entry,
    limit: state.limit,
    submodules: state.submodules,
    ceiling: ceilingOf(roots, target),
    confine: (candidate) => insideRoots(roots, candidate),
    ...(state.timeoutMs !== undefined && { timeoutMs: state.timeoutMs }),
  });

  if (result.status === 'error') return wireJson(result);

  return wireJson({
    ...result,
    toplevel: resultLocator(prefix, roots, result.toplevel),
  });
}

async function worktreeAdd(
  roots: ReadonlyArray<string>,
  prefix: string,
  call: PeerCall,
): Promise<JsonValue> {
  const add = worktreeAddParams.parse(call.params);
  const source = await guardedPath(roots, add.source);
  const directory = await guardedPath(roots, add.directory);

  const result = await addWorktree({
    source,
    branch: add.branch,
    directory,
    ...(add.baseRef !== undefined && { baseRef: add.baseRef }),
  });

  if (result.status === 'error') return wireJson(result);

  return wireJson({
    ...result,
    path: resultLocator(prefix, roots, result.path),
  });
}

async function worktreeList(
  roots: ReadonlyArray<string>,
  prefix: string,
  call: PeerCall,
): Promise<JsonValue> {
  const { source: submitted } = sourceParams.parse(call.params);
  const source = await guardedPath(roots, submitted);
  const result = await listWorktrees({ path: source });

  if (result.status === 'error') return wireJson(result);

  return wireJson({
    status: 'ok',
    worktrees: result.worktrees.map((entry) => ({
      ...entry,
      path: resultLocator(prefix, roots, entry.path),
    })),
  });
}

async function removeWorktreeAt(
  roots: ReadonlyArray<string>,
  call: PeerCall,
): Promise<JsonValue> {
  const { path: submitted } = pathParams.parse(call.params);
  const target = await guardedPath(roots, submitted);

  return wireJson(await removeWorktree({ path: target }));
}

/**
 * A typed result as wire JSON. The protocol's own result shapes are plain data,
 * and a peer's answer union is written against `JsonValue`; the JSON schema
 * admits exactly such a value.
 */
export function wireJson<T>(value: T): JsonValue {
  return z.json().parse(value);
}
