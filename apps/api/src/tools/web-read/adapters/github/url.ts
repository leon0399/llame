export type GithubThreadTarget = {
  readonly kind: 'issue' | 'pull';
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
};

export type GithubRepositoryTarget = {
  readonly kind: 'repository';
  readonly owner: string;
  readonly repo: string;
};

export type GithubPathTarget = {
  readonly kind: 'tree' | 'blob';
  readonly owner: string;
  readonly repo: string;
  readonly segments: ReadonlyArray<string>;
};

export type GithubCommitTarget = {
  readonly kind: 'commit';
  readonly owner: string;
  readonly repo: string;
  readonly sha: string;
};

export type GithubDiscussionTarget = {
  readonly kind: 'discussion';
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
};

export type GithubReleaseTarget = {
  readonly kind: 'release';
  readonly owner: string;
  readonly repo: string;
  /** The decoded tag name, which may contain `/`. */
  readonly tag: string;
};

export type GithubReleaseListTarget = {
  readonly kind: 'latest-release' | 'release-list';
  readonly owner: string;
  readonly repo: string;
};

export type GithubJobTarget = {
  readonly kind: 'job';
  readonly owner: string;
  readonly repo: string;
  readonly job: string;
};

export type GithubGistTarget = {
  readonly kind: 'gist';
  readonly id: string;
};

export type GithubTarget =
  | GithubThreadTarget
  | GithubDiscussionTarget
  | GithubRepositoryTarget
  | GithubPathTarget
  | GithubCommitTarget
  | GithubReleaseTarget
  | GithubReleaseListTarget
  | GithubJobTarget
  | GithubGistTarget;

const OWNER_PATTERN = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const REPO_PATTERN = '[A-Za-z0-9._-]{1,100}';
const THREAD_PATH = new RegExp(
  `^/(${OWNER_PATTERN})/(${REPO_PATTERN})/(issues|pull)/([1-9][0-9]{0,9})$`,
  'u',
);
const ROOT_PATH = new RegExp(`^/(${OWNER_PATTERN})/(${REPO_PATTERN})$`, 'u');
const CODE_PATH = new RegExp(
  `^/(${OWNER_PATTERN})/(${REPO_PATTERN})/(tree|blob|commit)(?:/(.*))?$`,
  'u',
);
const DISCUSSION_PATH = new RegExp(
  `^/(${OWNER_PATTERN})/(${REPO_PATTERN})/discussions/([1-9][0-9]{0,9})$`,
  'u',
);
const RELEASE_PATH = new RegExp(
  `^/(${OWNER_PATTERN})/(${REPO_PATTERN})/releases(?:/(latest)|/tag/(.+))?$`,
  'u',
);
const JOB_PATH = new RegExp(
  `^/(${OWNER_PATTERN})/(${REPO_PATTERN})/actions/runs/[1-9][0-9]{0,14}/job/([1-9][0-9]{0,14})$`,
  'u',
);
const GIST_PATH = new RegExp(
  `^/(?:${OWNER_PATTERN}/)?([0-9a-f]{20,40}|[1-9][0-9]{0,9})$`,
  'u',
);
const COMMIT_SHA = /^[0-9a-fA-F]{7,40}$/u;
const INVALID_SEGMENT = /[\\\p{Cc}]/u;
const RESERVED_ROOT_NAMES = {
  about: true,
  apps: true,
  codespaces: true,
  collections: true,
  'customer-stories': true,
  enterprise: true,
  enterprises: true,
  explore: true,
  features: true,
  issues: true,
  login: true,
  logout: true,
  marketplace: true,
  new: true,
  notifications: true,
  organizations: true,
  orgs: true,
  pricing: true,
  pulls: true,
  readme: true,
  security: true,
  search: true,
  settings: true,
  signup: true,
  sponsors: true,
  topics: true,
  trending: true,
  users: true,
} as const satisfies Readonly<Record<string, true>>;

/** Matches canonical public GitHub locators claimed by the native adapter. */
export function parseGithubUrl(source: URL): GithubTarget | undefined {
  if (
    source.protocol !== 'https:' ||
    source.port !== '' ||
    source.username !== '' ||
    source.password !== ''
  ) {
    return undefined;
  }
  if (source.hostname === 'gist.github.com') {
    return parseGistPath(source.pathname);
  }
  if (source.hostname !== 'github.com') return undefined;
  const target = parseRepositoryPath(source.pathname);
  // The list endpoint answers its first page, so a later page is not a read
  // it can serve.
  return target?.kind === 'release-list' && source.searchParams.has('page')
    ? undefined
    : target;
}

function parseRepositoryPath(pathname: string): GithubTarget | undefined {
  const thread = parseThreadPath(pathname);
  if (thread !== undefined) return thread;

  const root = ROOT_PATH.exec(pathname);
  if (root !== null) {
    if (isReservedOwner(root[1])) return undefined;
    return { kind: 'repository', owner: root[1], repo: root[2] };
  }

  const code = CODE_PATH.exec(pathname);
  if (code !== null) return parseCodePath(code);

  return (
    parseDiscussionPath(pathname) ??
    parseReleasePath(pathname) ??
    parseJobPath(pathname)
  );
}

function isReservedOwner(owner: string): boolean {
  return RESERVED_ROOT_NAMES[owner.toLowerCase()] === true;
}

function parseThreadPath(pathname: string): GithubThreadTarget | undefined {
  const match = THREAD_PATH.exec(pathname);
  if (match === null) return undefined;

  return {
    kind: match[3] === 'issues' ? 'issue' : 'pull',
    owner: match[1],
    repo: match[2],
    number: Number(match[4]),
  };
}

function parseDiscussionPath(
  pathname: string,
): GithubDiscussionTarget | undefined {
  const match = DISCUSSION_PATH.exec(pathname);
  if (match === null || isReservedOwner(match[1])) return undefined;
  return {
    kind: 'discussion',
    owner: match[1],
    repo: match[2],
    number: Number(match[3]),
  };
}

function parseReleasePath(
  pathname: string,
): GithubReleaseTarget | GithubReleaseListTarget | undefined {
  const match = RELEASE_PATH.exec(pathname);
  if (match === null || isReservedOwner(match[1])) return undefined;
  const [, owner, repo, latest, tag] = match;
  if (latest !== undefined) return { kind: 'latest-release', owner, repo };
  if (tag === undefined) return { kind: 'release-list', owner, repo };
  const segments = decodeSegments(tag, false);
  return segments === undefined
    ? undefined
    : { kind: 'release', owner, repo, tag: segments.join('/') };
}

function parseJobPath(pathname: string): GithubJobTarget | undefined {
  const match = JOB_PATH.exec(pathname);
  if (match === null || isReservedOwner(match[1])) return undefined;
  const [, owner, repo, job] = match;
  return { kind: 'job', owner, repo, job };
}

function parseGistPath(pathname: string): GithubGistTarget | undefined {
  const match = GIST_PATH.exec(pathname);
  return match === null ? undefined : { kind: 'gist', id: match[1] };
}

function parseCodePath(match: RegExpExecArray): GithubTarget | undefined {
  const kind = match[3];
  const suffix = match[4] ?? '';
  if (kind === 'commit') {
    return COMMIT_SHA.test(suffix)
      ? { kind, owner: match[1], repo: match[2], sha: suffix }
      : undefined;
  }

  const segments = decodeSegments(suffix, kind === 'tree');
  if (segments === undefined) return undefined;
  if (kind === 'tree') {
    return { kind, owner: match[1], repo: match[2], segments };
  }
  if (kind === 'blob' && segments.length >= 2) {
    return { kind, owner: match[1], repo: match[2], segments };
  }
  return undefined;
}

function decodeSegments(
  suffix: string,
  allowTrailingSlash: boolean,
): ReadonlyArray<string> | undefined {
  const rawSegments = suffix.split('/');
  if (allowTrailingSlash && rawSegments.at(-1) === '') {
    rawSegments.pop();
  }
  if (rawSegments.length === 0) return undefined;

  const segments = rawSegments.map(decodeSegment);
  return segments.every((segment): segment is string => segment !== undefined)
    ? segments
    : undefined;
}

function decodeSegment(rawSegment: string): string | undefined {
  let segment: string;
  try {
    segment = decodeURIComponent(rawSegment);
  } catch {
    return undefined;
  }
  const components = segment.split('/');
  return components.every(
    (component) =>
      component !== '' &&
      component !== '.' &&
      component !== '..' &&
      !INVALID_SEGMENT.test(component),
  )
    ? segment
    : undefined;
}
