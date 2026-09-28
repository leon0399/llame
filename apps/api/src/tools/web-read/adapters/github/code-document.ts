import {
  renderCollectedDirectory,
  type DirectoryListingEntry,
} from '@workspace/native-file-tools';

import { appendFiles, type GithubFile } from './document';

/** Path relative to the requested directory (or repository root), as GitHub's
 * recursive tree reports it after stripping the requested prefix. */
export type GithubTreeEntry = {
  readonly path: string;
  readonly type: 'blob' | 'tree' | 'commit';
  readonly mode?: string;
};

export type GithubRepositoryDocument = {
  readonly kind: 'repository';
  readonly displayPath: string;
  readonly description: string | null;
  readonly defaultBranch: string;
  readonly visibility: string;
  readonly language: string | null;
  /** undefined when the tree is unavailable (omission note added by the adapter). */
  readonly entries?: ReadonlyArray<GithubTreeEntry>;
  /** undefined when the README request failed or none exists. */
  readonly readme?: string;
};

export type GithubCommitDocument = {
  readonly kind: 'commit';
  readonly sha: string;
  readonly message: string;
  readonly author: string;
  readonly authoredAt: string;
  readonly files: ReadonlyArray<GithubFile>;
  readonly diffUrl: string;
};

export type GithubCodeDocument =
  | GithubRepositoryDocument
  | GithubCommitDocument;

export function renderGithubCodeDocument(document: GithubCodeDocument): string {
  return document.kind === 'repository'
    ? renderRepository(document)
    : renderCommit(document);
}

/**
 * Converts GitHub's flat recursive paths into the entries expected by the
 * native directory renderer. Deeper descendants are intentionally omitted.
 */
export function toGithubDirectoryEntries(
  entries: ReadonlyArray<GithubTreeEntry>,
): ReadonlyArray<DirectoryListingEntry> {
  const roots = new Map<string, DirectoryListingEntry>();
  const children = new Map<string, Array<DirectoryListingEntry>>();
  for (const entry of entries) {
    const segments = entry.path.split('/');
    if (segments.length === 1) {
      roots.set(segments[0], {
        name: segments[0],
        kind: githubEntryKind(entry),
      });
      continue;
    }
    if (segments.length !== 2) continue;
    const siblings = children.get(segments[0]) ?? [];
    siblings.push({
      name: segments[1],
      kind: githubEntryKind(entry),
    });
    children.set(segments[0], siblings);
  }
  return [...roots.values()].map((entry) =>
    entry.kind === 'directory'
      ? { ...entry, children: children.get(entry.name) ?? [] }
      : entry,
  );
}

function githubEntryKind(
  entry: GithubTreeEntry,
): DirectoryListingEntry['kind'] {
  if (entry.mode === '120000') return 'symlink';
  if (entry.type === 'tree') return 'directory';
  if (entry.type === 'commit' || entry.mode === '160000') return 'special';
  return 'file';
}

function renderRepository(document: GithubRepositoryDocument): string {
  const lines = [
    `Description: ${document.description ?? 'none'}`,
    `Default branch: ${document.defaultBranch}`,
    `Visibility: ${document.visibility}`,
    `Language: ${document.language ?? 'none'}`,
    '',
  ];
  const listing =
    document.entries === undefined
      ? undefined
      : renderGithubListing(document.displayPath, document.entries);
  if (listing !== undefined) lines.push(listing);
  if (document.readme !== undefined) {
    if (listing !== undefined) lines.push('');
    lines.push('## README', '', document.readme);
  }
  return lines.join('\n').trim();
}

function renderGithubListing(
  displayPath: string,
  entries: ReadonlyArray<GithubTreeEntry>,
): string {
  const result = renderCollectedDirectory(
    displayPath,
    toGithubDirectoryEntries(entries),
  );
  return result.status === 'success' ? result.content.trimEnd() : '';
}

function renderCommit(document: GithubCommitDocument): string {
  const lines = [
    `# Commit ${document.sha}`,
    '',
    document.message,
    '',
    `Author: ${document.author}`,
    `Date: ${document.authoredAt}`,
  ];
  appendFiles(lines, document.files);
  lines.push('', `Diff: ${document.diffUrl}`);
  return lines.join('\n').trim();
}
