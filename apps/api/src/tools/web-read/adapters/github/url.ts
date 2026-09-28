export type GithubThreadTarget = {
  readonly kind: 'issue' | 'pull';
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
};

const OWNER_PATTERN = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const REPO_PATTERN = '[A-Za-z0-9._-]{1,100}';
const THREAD_PATH = new RegExp(
  `^/(${OWNER_PATTERN})/(${REPO_PATTERN})/(issues|pull)/([1-9][0-9]{0,9})$`,
  'u',
);

/** Matches only the canonical public GitHub issue and pull request shapes. */
export function parseGithubThreadUrl(
  source: URL,
): GithubThreadTarget | undefined {
  if (
    source.protocol !== 'https:' ||
    source.hostname !== 'github.com' ||
    source.port !== '' ||
    source.username !== '' ||
    source.password !== ''
  ) {
    return undefined;
  }

  const match = THREAD_PATH.exec(source.pathname);
  if (match === null || match[2] === '.' || match[2] === '..') {
    return undefined;
  }

  return {
    kind: match[3] === 'issues' ? 'issue' : 'pull',
    owner: match[1],
    repo: match[2],
    number: Number(match[4]),
  };
}
