import { type GitStateSuccess } from '@workspace/machine-protocol';

import { normalizeRemote } from '../repositories/remote';
import { type GitStateView } from './git-state-view';

const MAX_REMOTES = 10;
const NAME_LIMIT = 100;
const SUBJECT_LIMIT = 72;
const SHORT_HEAD = 7;
const LOCAL_REMOTE = 'local';

/** Cut at `limit` characters without splitting a surrogate pair. */
function cut(value: string, limit: number): string {
  const characters = Array.from(value);
  return characters.length <= limit
    ? value
    : characters.slice(0, limit).join('');
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;
const DRIVE_PATH = /^[a-z]:[\\/]/iu;

/**
 * A remote's display value. The query and fragment go first, and a URL's
 * userinfo goes through the last `@`, so a token that holds a `/` cannot stay
 * in the host part. A value without a host is `local`: its path is private.
 */
function remoteValue(url: string): string {
  const withoutTail = url.split(/[?#]/u, 1)[0];
  const scheme = SCHEME.exec(withoutTail);
  if (scheme === null && DRIVE_PATH.test(withoutTail)) return LOCAL_REMOTE;
  if (scheme?.[0].toLowerCase() === 'file://') return LOCAL_REMOTE;
  const afterScheme =
    scheme === null ? withoutTail : withoutTail.slice(scheme[0].length);
  const at = afterScheme.lastIndexOf('@');
  const credentialFree =
    scheme !== null && at !== -1
      ? `${scheme[0]}${afterScheme.slice(at + 1)}`
      : withoutTail;
  const normalized = normalizeRemote(credentialFree);
  const hostless =
    normalized === '' ||
    normalized.startsWith('/') ||
    normalized.startsWith('.') ||
    normalized.startsWith('~') ||
    normalized.includes('\\') ||
    !normalized.includes('/');
  return hostless ? LOCAL_REMOTE : cut(normalized, NAME_LIMIT);
}

/** The state result as the view: bounded, normalized, no raw URL. */
export function normalizeGitState(state: GitStateSuccess): GitStateView {
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
        : { ...state.upstream, name: cut(state.upstream.name, NAME_LIMIT) },
    operation: state.operation,
    counts: state.counts,
    entries: state.entries,
    omitted: state.omitted,
    submodules: state.submodules,
    commits: state.commits.map((commit) => ({
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
