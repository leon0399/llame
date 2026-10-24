import { randomBytes } from 'node:crypto';
import path from 'node:path';

/*
 * The name, branch, and placement rules of a worktree entry (openspec
 * `repositories`, "Worktree names, branches, and base refs follow one rule" and
 * "Worktree placement follows the source clone and its worktree base").
 *
 * Everything here is pure: the caller resolves the source clone, renders the
 * directory on its executor, and canonicalizes it through its deepest existing
 * ancestor. A rule that could reach git, the filesystem, or the database does
 * not live here, so a refused name or base reference starts nothing.
 */

/** The hidden directory that holds the worktrees of one clone. */
export const WORKTREE_DIRECTORY = '.llame-worktrees';

/** How many generated names one call tries before the caller gives up. */
export const WORKTREE_NAME_ATTEMPTS = 8;

/** The model-facing values of the `worktree` object. */
export type WorktreeRequest = {
  readonly name?: string;
  readonly baseRef?: string;
};

/** One worktree's name, its directory segment, and its branch. */
export type WorktreeName = {
  readonly name: string;
  readonly slug: string;
  readonly branch: string;
};

/** Why a submitted value is not usable, in the caller's error vocabulary. */
export type WorktreeInputProblem = { readonly message: string };

/** Characters git forbids anywhere in a ref name, plus whitespace and control
 *  bytes: a ref reaches git as one argv element, and a newline in one is never
 *  a name a caller meant. The same set `@workspace/git-executor` refuses. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_REF_CHARACTERS = /[\s~^:?*[\\\u0000-\u001f\u007f]/u;

/** The adjectives and nouns a generated name is drawn from. */
const ADJECTIVES = [
  'amber',
  'brave',
  'calm',
  'clear',
  'crisp',
  'eager',
  'fair',
  'gentle',
  'happy',
  'lively',
  'mellow',
  'noble',
  'quiet',
  'rapid',
  'steady',
  'vivid',
] as const;
const NOUNS = [
  'badger',
  'cedar',
  'delta',
  'ember',
  'falcon',
  'garnet',
  'harbor',
  'island',
  'jasper',
  'kestrel',
  'linden',
  'meadow',
  'otter',
  'pine',
  'quartz',
  'river',
] as const;

/**
 * The name rule both entry points share, so a supplied and a generated name
 * cannot drift: the slug replaces each `/` with `-`, and a name that carries a
 * `/` is the whole branch, so `feature/login` keeps its hierarchy while
 * `calm-otter-9f2c` becomes `llame/calm-otter-9f2c`.
 */
function worktreeNameOf(name: string): WorktreeName {
  return {
    name,
    slug: name.replaceAll('/', '-'),
    branch: name.includes('/') ? name : `llame/${name}`,
  };
}

/** Why a branch name git would refuse, or `undefined` when it would accept it. */
function branchProblem(branch: string): string | undefined {
  if (branch === '') return 'A worktree name must not be empty.';
  if (FORBIDDEN_REF_CHARACTERS.test(branch))
    return 'A worktree name must not hold whitespace or ref punctuation.';
  if (branch.includes('..') || branch.includes('@{'))
    return 'A worktree name must not hold `..` or `@{`.';
  if (branch.endsWith('/') || branch.endsWith('.'))
    return 'A worktree name must not end with `/` or `.`.';
  if (branch.endsWith('.lock'))
    return 'A worktree name must not end with `.lock`.';
  if (
    branch
      .split('/')
      .some((segment) => segment === '' || segment.startsWith('.'))
  ) {
    return 'A worktree name must not hold an empty or dot-leading segment.';
  }
  return undefined;
}

/**
 * The name a caller supplied, or why it is refused. The name itself is checked
 * as well as the branch it produces: `-upload` would become a harmless
 * `llame/-upload` branch, and a leading `-` is still never a name a caller
 * meant.
 */
export function namedWorktree(
  name: string,
): WorktreeName | WorktreeInputProblem {
  if (name === '') return { message: 'A worktree name must not be empty.' };
  if (name.startsWith('-'))
    return { message: 'A worktree name must not start with `-`.' };
  const worktree = worktreeNameOf(name);
  const problem = branchProblem(worktree.branch);
  return problem === undefined ? worktree : { message: problem };
}

/** The base ref a caller supplied, or why it is refused. */
export function readBaseRef(
  baseRef: string | undefined,
): { readonly baseRef?: string } | WorktreeInputProblem {
  if (baseRef === undefined) return {};
  if (baseRef === '') return { message: 'A base ref must not be empty.' };
  if (baseRef.startsWith('-'))
    return { message: 'A base ref must not start with `-`.' };
  if (FORBIDDEN_REF_CHARACTERS.test(baseRef)) {
    return { message: 'A base ref must not hold whitespace or control bytes.' };
  }
  return { baseRef };
}

/**
 * The submitted `worktree` object, validated before any probe: a name and a
 * base ref are refused here, so neither reaches git.
 */
export function readWorktreeRequest(
  request: WorktreeRequest,
):
  | { readonly name?: WorktreeName; readonly baseRef?: string }
  | WorktreeInputProblem {
  const base = readBaseRef(request.baseRef);
  if ('message' in base) return base;
  if (request.name === undefined) return base;
  const name = namedWorktree(request.name);
  return 'message' in name ? name : { ...base, name };
}

/**
 * One generated `<adjective>-<noun>-<4 hex>` name. The caller retries with a new
 * suffix while its directory or branch exists, so one collision costs no call.
 */
export function generatedWorktreeName(
  random: (size: number) => Buffer = randomBytes,
): WorktreeName {
  const bytes = random(4);
  // `Buffer` indexes always exist for an in-range byte offset; `?? 0` keeps the
  // index access total without a throw, which the length above guarantees.
  const adjective = ADJECTIVES[(bytes[0] ?? 0) % ADJECTIVES.length] ?? 'calm';
  const noun = NOUNS[(bytes[1] ?? 0) % NOUNS.length] ?? 'otter';
  const suffix = bytes.subarray(2, 4).toString('hex');
  return worktreeNameOf(`${adjective}-${noun}-${suffix}`);
}

/** The default base: the clone's own parent directory plus `.llame-worktrees`. */
export function defaultWorktreeBase(mainClone: string): string {
  return path.posix.join(path.posix.dirname(mainClone), WORKTREE_DIRECTORY);
}

/**
 * One worktree's directory on its executor: `<base>/<display name>/<slug>`.
 * `base` is the clone's parent directory plus `.llame-worktrees`, or the main
 * checkout's own `worktree_base`.
 */
export function worktreeDirectory(
  base: string,
  displayName: string,
  slug: string,
): string {
  return path.posix.join(base, displayName, slug);
}
