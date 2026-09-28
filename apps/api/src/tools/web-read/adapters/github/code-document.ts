import { appendFiles, type GithubFile } from './document';

/** Path relative to the requested directory (or repository root), as GitHub's
 * recursive tree reports it after stripping the requested prefix. */
export type GithubTreeEntry = {
  readonly path: string;
  readonly type: 'blob' | 'tree' | 'commit';
};

export type GithubRepositoryDocument = {
  readonly kind: 'repository';
  readonly displayPath: string;
  readonly description: string | null;
  readonly defaultBranch: string;
  readonly visibility: string;
  readonly language: string | null;
  /** undefined when the tree request failed (omission note added by the adapter). */
  readonly entries?: ReadonlyArray<GithubTreeEntry>;
  /** undefined when the README request failed or none exists. */
  readonly readme?: string;
};

export type GithubTreeDocument = {
  readonly kind: 'tree';
  readonly displayPath: string;
  readonly entries: ReadonlyArray<GithubTreeEntry>;
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
  | GithubTreeDocument
  | GithubCommitDocument;

const DIRECTORY_CHILD_CAP = 20;

type TreeLevels = {
  readonly root: Array<GithubTreeEntry>;
  readonly children: Map<string, Array<GithubTreeEntry>>;
};

export function renderGithubCodeDocument(document: GithubCodeDocument): string {
  switch (document.kind) {
    case 'repository':
      return renderRepository(document);
    case 'tree':
      return renderTree(document.displayPath, document.entries).join('\n');
    case 'commit':
      return renderCommit(document);
  }
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
      ? []
      : renderTree(document.displayPath, document.entries);
  lines.push(...listing);
  if (document.readme !== undefined) {
    if (listing.length > 0) lines.push('');
    lines.push('## README', '', document.readme);
  }
  return lines.join('\n').trim();
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

function renderTree(
  displayPath: string,
  entries: ReadonlyArray<GithubTreeEntry>,
): Array<string> {
  if (entries.length === 0) return [displayPath, '(empty directory)'];

  const { root, children } = collectTreeLevels(entries);
  const lines: Array<string> = [displayPath];
  for (const entry of root) {
    lines.push(formatTreeEntry(entry, '  '));
    if (entry.type !== 'tree') continue;
    appendChildEntries(lines, children.get(entry.path));
  }
  return lines;
}

function collectTreeLevels(
  entries: ReadonlyArray<GithubTreeEntry>,
): TreeLevels {
  const root: Array<GithubTreeEntry> = [];
  const children = new Map<string, Array<GithubTreeEntry>>();
  for (const entry of entries) {
    const segments = entry.path.split('/');
    if (segments.length === 1) {
      root.push(entry);
      continue;
    }
    if (segments.length !== 2) continue;
    const parent = segments[0];
    const siblings = children.get(parent) ?? [];
    siblings.push(entry);
    children.set(parent, siblings);
  }
  root.sort(compareTreeEntries);
  for (const siblings of children.values()) siblings.sort(compareTreeEntries);
  return { root, children };
}

function appendChildEntries(
  lines: Array<string>,
  entries: ReadonlyArray<GithubTreeEntry> | undefined,
): void {
  if (entries === undefined) return;
  for (const entry of entries.slice(0, DIRECTORY_CHILD_CAP)) {
    lines.push(formatTreeEntry(entry, '    '));
  }
  if (entries.length > DIRECTORY_CHILD_CAP) {
    lines.push(`    … ${entries.length - DIRECTORY_CHILD_CAP} more`);
  }
}

function compareTreeEntries(
  left: GithubTreeEntry,
  right: GithubTreeEntry,
): number {
  const leftDirectory = left.type === 'tree' ? 0 : 1;
  const rightDirectory = right.type === 'tree' ? 0 : 1;
  if (leftDirectory !== rightDirectory) return leftDirectory - rightDirectory;
  return left.path.localeCompare(right.path);
}

function formatTreeEntry(entry: GithubTreeEntry, indent: string): string {
  const name = entry.path.split('/').pop() ?? entry.path;
  return `${indent}- ${name}${entry.type === 'tree' ? '/' : ''}`;
}
