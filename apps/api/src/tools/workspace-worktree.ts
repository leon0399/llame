import { randomBytes, randomInt } from 'node:crypto';
import path from 'node:path';

/**
 * The ref-name rules that keep a caller value from becoming an option or an
 * ambiguous revision.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_REF_CHARACTERS = /[\s~^:?*[\\\u0000-\u001f\u007f]/u;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_BYTES = /[\s\u0000-\u001f\u007f]/u;

function branchName(
  value: string,
): { readonly name: string } | { readonly message: string } {
  if (value === '') return { message: 'A branch name must not be empty.' };
  if (value.startsWith('-'))
    return { message: 'A branch name must not start with `-`.' };
  if (FORBIDDEN_REF_CHARACTERS.test(value))
    return {
      message: 'A branch name must not hold whitespace or ref punctuation.',
    };
  if (value.includes('..') || value.includes('@{'))
    return { message: 'A branch name must not hold `..` or `@{`.' };
  if (value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock'))
    return {
      message: 'A branch name must not end with `/`, `.`, or `.lock`.',
    };
  if (
    value
      .split('/')
      .some((segment) => segment === '' || segment.startsWith('.'))
  )
    return {
      message: 'A branch name must not hold an empty or dot-leading segment.',
    };
  return { name: value };
}

function baseReference(
  value: string,
): { readonly ref: string } | { readonly message: string } {
  if (value === '') return { message: 'A base ref must not be empty.' };
  if (value.startsWith('-'))
    return { message: 'A base ref must not start with `-`.' };
  if (FORBIDDEN_BYTES.test(value))
    return { message: 'A base ref must not hold whitespace or control bytes.' };
  return { ref: value };
}

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

/** The validated `worktree` object of one entry. */
export type WorktreeRequest = {
  readonly name?: WorktreeName;
  readonly baseRef?: string;
};

/** One worktree's name, its directory segment, and its branch. */
export type WorktreeName = {
  readonly name: string;
  readonly slug: string;
  readonly branch: string;
};

/** Why a submitted value is not usable, in the caller's error vocabulary. */
type WorktreeInputProblem = { readonly message: string };

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

/**
 * The name a caller supplied, or why it is refused. The name itself is checked
 * as well as the branch it produces: `-upload` would become a harmless
 * `llame/-upload` branch, and a leading `-` is still never a name a caller
 * meant. The branch rule is the executor's own.
 */
export function namedWorktree(
  name: string,
): WorktreeName | WorktreeInputProblem {
  if (name === '') return { message: 'A worktree name must not be empty.' };

  if (name.startsWith('-'))
    return { message: 'A worktree name must not start with `-`.' };
  const worktree = worktreeNameOf(name);
  const branch = branchName(worktree.branch);

  return 'message' in branch ? branch : worktree;
}

/**
 * The submitted `worktree` object, validated before any probe: a name and a
 * base ref are refused here, so neither reaches git.
 */
export function readWorktreeRequest(request: {
  readonly name?: string;
  readonly baseRef?: string;
}): WorktreeRequest | WorktreeInputProblem {
  const base =
    request.baseRef === undefined ? undefined : baseReference(request.baseRef);

  if (base !== undefined && 'message' in base) return base;
  const baseRef = base?.ref;

  if (request.name === undefined)
    return baseRef === undefined ? {} : { baseRef };
  const name = namedWorktree(request.name);

  return 'message' in name
    ? name
    : baseRef === undefined
      ? { name }
      : { baseRef, name };
}

/** The two randomness seams one generated name draws from. */
export type WorktreeNameRandomness = {
  /** A whole number in `[0, max)`, for one table index. */
  readonly int: (max: number) => number;
  /** The bytes of the hex suffix. */
  readonly bytes: (size: number) => Buffer;
};

const CRYPTO_RANDOM: WorktreeNameRandomness = {
  int: randomInt,
  bytes: randomBytes,
};

/**
 * One generated `<adjective>-<noun>-<4 hex>` name. Each word is an index the
 * platform draws within its own table, so no byte is reduced modulo a length
 * the tables may outgrow. The caller retries with a new suffix while its
 * directory or branch exists, so one collision costs no call.
 */
export function generatedWorktreeName(
  random: WorktreeNameRandomness = CRYPTO_RANDOM,
): WorktreeName {
  const adjective = ADJECTIVES[random.int(ADJECTIVES.length)] ?? 'calm';
  const noun = NOUNS[random.int(NOUNS.length)] ?? 'otter';
  const suffix = random.bytes(2).toString('hex');

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
