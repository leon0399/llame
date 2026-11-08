import { type GitStateSuccess } from '@workspace/machine-protocol';

import { normalizeRemote } from '../repositories/remote';
import { type GitStateView } from './git-state-view';

const MAX_REMOTES = 10;
const MAX_COMMITS = 5;
const MAX_LISTED = 20;
const MAX_PATH_LENGTH = 4096;
const NAME_LIMIT = 100;
const SUBJECT_LIMIT = 72;
const SHORT_HEAD = 7;
const LOCAL_REMOTE = 'local';

/** Cut at `limit` characters without splitting a surrogate pair. */
function cut(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('');
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;
const DRIVE_PATH = /^[a-z]:[\\/]/iu;
const HELPER_FORM = /^[a-z][a-z0-9+.-]*::(.*)$/isu;
const SCP_ADDRESS = /^(?:[^@/\s:]+@)?[^:/\s]+:(?!\/)/u;
const UNSAFE_VALUE = /[@\s\p{Cc}]/u;

/** Git's rule: a value with no `://` and no `:` before its first `/` is a path. */
function isLocalPath(value: string): boolean {
  const colon = value.indexOf(':');
  const slash = value.indexOf('/');
  return colon === -1 || (slash !== -1 && slash < colon);
}

/**
 * A remote's display value. A `<transport>::<address>` helper form shows its
 * address part, and only when that is a URL or scp form. The query and
 * fragment go first, and a URL's userinfo goes through the last `@`, so a
 * token that holds a `/` cannot stay in the host part. A value without a host
 * is `local`: its path is private. A result that still holds `@`, a space, or
 * a control character is `local` too: the daemon's answer is untrusted.
 */
function remoteValue(url: string): string {
  const trimmed = url.trim();
  const helper = HELPER_FORM.exec(trimmed);
  const address = helper === null ? trimmed : helper[1].trim();
  if (helper !== null && !SCHEME.test(address) && !SCP_ADDRESS.test(address)) {
    return LOCAL_REMOTE;
  }
  if (DRIVE_PATH.test(address) || isLocalPath(address)) return LOCAL_REMOTE;
  const withoutTail = address.split(/[?#]/u, 1)[0];
  const scheme = SCHEME.exec(withoutTail);
  if (scheme?.[0].toLowerCase() === 'file://') return LOCAL_REMOTE;
  const afterScheme =
    scheme === null ? withoutTail : withoutTail.slice(scheme[0].length);
  const credentialFree =
    scheme === null
      ? withoutTail
      : `${scheme[0]}${afterScheme.slice(afterScheme.lastIndexOf('@') + 1)}`;
  const normalized = normalizeRemote(credentialFree);
  const hostless =
    normalized.startsWith('/') ||
    normalized.startsWith('.') ||
    normalized.startsWith('~') ||
    normalized.includes('\\') ||
    !normalized.includes('/') ||
    UNSAFE_VALUE.test(normalized);
  return hostless ? LOCAL_REMOTE : cut(normalized, NAME_LIMIT);
}

const STATUS_CODE = /^[ MTADRCU?!]{2}$/u;

/** The upstream time as `YYYY-MM-DDTHH:MM:SS.mmmZ`, or `null` when it is not a date. */
function canonicalTime(value: string | null): string | null {
  if (value === null) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  const iso = new Date(time).toISOString();
  return /^\d{4}-/u.test(iso) ? iso : null;
}

/** At most 20 listed paths in all; what is invalid or over the bound is counted. */
function boundLists(state: GitStateSuccess) {
  const valid = state.entries.filter((entry) => STATUS_CODE.test(entry.xy));
  const entries = valid.slice(0, MAX_LISTED);
  const listable = state.submodules.filter(
    (path) => path.length <= MAX_PATH_LENGTH,
  );
  const submodules = listable.slice(0, MAX_LISTED - entries.length);
  const dropped =
    state.entries.length -
    entries.length +
    state.submodules.length -
    submodules.length;
  return { entries, submodules, dropped };
}

/** The state result as the view: bounded, normalized, no raw URL. */
export function normalizeGitState(state: GitStateSuccess): GitStateView {
  const { entries, submodules, dropped } = boundLists(state);
  return {
    toplevel: state.toplevel,
    rootRelative: state.rootRelative,
    branch: state.branch === null ? null : cut(state.branch, NAME_LIMIT),
    detached: state.detached,
    head:
      state.head === null
        ? null
        : { short: state.head.slice(0, SHORT_HEAD), oid: state.head },
    upstream:
      state.upstream === null
        ? null
        : {
            ...state.upstream,
            name: cut(state.upstream.name, NAME_LIMIT),
            updatedAt: canonicalTime(state.upstream.updatedAt),
          },
    operation: state.operation,
    counts: state.counts,
    entries,
    omitted: state.omitted + dropped,
    submodules,
    commits: state.commits.slice(0, MAX_COMMITS).map((commit) => ({
      short: commit.short,
      subject: cut(commit.subject, SUBJECT_LIMIT),
    })),
    remotes: state.remotes.slice(0, MAX_REMOTES).map((remote) => ({
      name: cut(remote.name, NAME_LIMIT),
      value: remoteValue(remote.url),
    })),
    remotesOmitted: Math.max(0, state.remotes.length - MAX_REMOTES),
  };
}
