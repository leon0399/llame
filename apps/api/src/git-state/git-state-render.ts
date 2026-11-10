import { neutralizeReservedDelimiters } from '@workspace/runtime-safety';

import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { loadPackagedTemplate } from '../prompts/template-engine';
import {
  GIT_ABSENCE_LABELS,
  type GitObservation,
  type GitStateView,
} from './git-state-view';

type SnapshotValues = {
  readonly repository: string;
  readonly hasRoot: boolean;
  readonly root: string;
  readonly detached: boolean;
  readonly branch: string;
  readonly hasHead: boolean;
  readonly headShort: string;
  readonly hasUpstream: boolean;
  readonly upstreamGone: boolean;
  readonly upstream: string;
  readonly ahead: number;
  readonly behind: number;
  readonly hasUpdatedAt: boolean;
  readonly updatedAt: string;
  readonly hasOperation: boolean;
  readonly operation: {
    readonly kind: string;
    readonly hasStep: boolean;
    readonly step: number;
    readonly total: number;
  };
  readonly counts: GitStateView['counts'];
  readonly entries: ReadonlyArray<{
    readonly xy: string;
    readonly path: string;
    readonly hasFrom: boolean;
    readonly from: string;
  }>;
  readonly submodules: ReadonlyArray<{ readonly path: string }>;
  readonly hasOmitted: boolean;
  readonly omitted: number;
  readonly hasCommits: boolean;
  readonly commits: GitStateView['commits'];
  readonly hasRemotes: boolean;
  readonly remotes: GitStateView['remotes'];
  readonly hasRemotesOmitted: boolean;
  readonly remotesOmitted: number;
};

const renderSnapshotTemplate = loadPackagedTemplate<SnapshotValues>(
  __dirname,
  'git-snapshot',
);

const NAMED_ESCAPES = new Map([
  ['\u0007', String.raw`\a`],
  ['\b', String.raw`\b`],
  ['\t', String.raw`\t`],
  ['\n', String.raw`\n`],
  ['\u000b', String.raw`\v`],
  ['\f', String.raw`\f`],
  ['\r', String.raw`\r`],
  ['"', String.raw`\"`],
  ['\\', String.raw`\\`],
]);

// Control characters, the two Unicode line separators, and the quote and
// backslash that the quoted form escapes.
const UNSAFE_PATH_CHARACTER = /[\p{Cc}"\\\u2028\u2029]/gu;
const SINGLE_LINE_BREAKERS = /[\p{Cc}\u2028\u2029]/gu;

function octal(character: string): string {
  return Array.from(
    Buffer.from(character, 'utf8'),
    (byte) => `\\${byte.toString(8).padStart(3, '0')}`,
  ).join('');
}

/**
 * A path as git quotes it: untouched when safe, otherwise wrapped in double
 * quotes with C escapes (octal for control bytes without a name). The result
 * never holds a line break.
 */
export function quoteGitPath(value: string): string {
  const body = value.replaceAll(
    UNSAFE_PATH_CHARACTER,
    (character) => NAMED_ESCAPES.get(character) ?? octal(character),
  );

  return body === value ? value : `"${body}"`;
}

/** Repository text that is not a path: one line, neutralized. */
function text(value: string): string {
  return sanitizeAuthoredText(value.replaceAll(SINGLE_LINE_BREAKERS, ' '));
}

function path(value: string): string {
  return sanitizeAuthoredText(quoteGitPath(value));
}

function branchValues(view: GitStateView) {
  const { upstream, operation } = view;
  const total = operation?.total;
  const step = operation?.step;

  return {
    detached: view.detached,
    branch: text(view.branch ?? ''),
    hasHead: view.head !== null,
    headShort: text(view.head?.short ?? ''),
    hasUpstream: upstream !== null,
    upstreamGone: upstream?.gone ?? false,
    upstream: text(upstream?.name ?? ''),
    ahead: upstream?.ahead ?? 0,
    behind: upstream?.behind ?? 0,
    hasUpdatedAt: upstream?.updatedAt != null,
    updatedAt: (upstream?.updatedAt ?? '').slice(0, 16).replace('T', ' '),
    hasOperation: operation !== null,
    operation: {
      kind: text(operation?.kind ?? ''),
      hasStep: step !== undefined && total !== undefined,
      step: step ?? 0,
      total: total ?? 0,
    },
  };
}

function snapshotValues(view: GitStateView): SnapshotValues {
  return {
    ...branchValues(view),
    repository: path(view.toplevel),
    hasRoot: view.rootRelative !== '',
    root: path(view.rootRelative),
    counts: view.counts,
    entries: view.entries.map((entry) => ({
      xy: entry.xy,
      path: path(entry.path),
      hasFrom: entry.from !== undefined,
      from: path(entry.from ?? ''),
    })),
    submodules: view.submodules.map((submodule) => ({ path: path(submodule) })),
    hasOmitted: view.omitted > 0,
    omitted: view.omitted,
    hasCommits: view.commits.length > 0,
    commits: view.commits.map((commit) => ({
      short: text(commit.short),
      subject: text(commit.subject),
    })),
    hasRemotes: view.remotes.length > 0,
    remotes: view.remotes.map((remote) => ({
      name: text(remote.name),
      value: text(remote.value),
    })),
    hasRemotesOmitted: view.remotesOmitted > 0,
    remotesOmitted: view.remotesOmitted,
  };
}

/** The item body of one observation; the envelope belongs to the producer. */
export function renderGitObservation(observation: GitObservation): string {
  switch (observation.kind) {
    case 'not_a_repository':
      return 'not a git repository';
    case 'unavailable':
      return `git state unavailable: ${GIT_ABSENCE_LABELS[observation.reason]}`;
    case 'state':
      return neutralizeReservedDelimiters(
        renderSnapshotTemplate(snapshotValues(observation.view)),
      );
  }
}
