import { execFileSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';
import { isRecord, isString } from '@workspace/runtime-safety';

type GitCommandResult = {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
};

type GitFailure = {
  readonly status: 'error';
  readonly type:
    | 'not_a_repository'
    | 'timed_out'
    | 'git_failed'
    | 'no_repository_in_root'
    | 'root_missing'
    | 'git_entry_changed'
    | 'outside_registered_root'
    | 'output_bound';
  readonly stderr: string;
};

type GitEntry = {
  readonly status: 'ok';
  readonly gitEntry: string;
  readonly kind: 'directory' | 'file';
};

type GitRemote = { readonly name: string; readonly url: string };

function runGit(
  path: string,
  args: ReadonlyArray<string>,
  timeout = 30_000,
): GitCommandResult {
  try {
    return {
      ok: true,
      stdout: String(
        execFileSync(
          'git',
          [
            '-c',
            'core.hooksPath=/dev/null',
            '-c',
            'core.fsmonitor=false',
            '-C',
            path,
            ...args,
          ],
          {
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024,
            timeout,
            windowsHide: true,
          },
        ),
      ),
      stderr: '',
    };
  } catch (error) {
    const stderr =
      isRecord(error) && isString(error['stderr']) ? error['stderr'] : '';

    return { ok: false, stdout: '', stderr };
  }
}

function gitFailure(type: GitFailure['type'], stderr = ''): GitFailure {
  return { status: 'error', type, stderr };
}

function gitValue(
  path: string,
  args: ReadonlyArray<string>,
  timeout?: number,
): string | undefined {
  const result = runGit(path, args, timeout);

  return result.ok ? result.stdout.replace(/\n$/u, '') : undefined;
}

function remotes(path: string): Array<GitRemote> {
  const result = runGit(path, [
    'config',
    '--null',
    '--get-regexp',
    String.raw`^remote\..*\.url$`,
  ]);

  if (!result.ok) return [];

  return result.stdout.split('\0').flatMap((record) => {
    const separator = record.indexOf('\n');

    if (separator < 0) return [];
    const key = record.slice(0, separator);
    const name = key.slice('remote.'.length, key.length - '.url'.length);

    return key.startsWith('remote.') && key.endsWith('.url') && name !== ''
      ? [{ name, url: record.slice(separator + 1) }]
      : [];
  });
}

function worktreeRecords(output: string): Array<Record<string, string>> {
  const records: Array<Record<string, string>> = [];
  let record: Record<string, string> = {};

  for (const field of output.split('\0')) {
    if (field === '') {
      if (Object.keys(record).length > 0) records.push(record);
      record = {};
      continue;
    }

    const separator = field.indexOf(' ');
    const key = separator < 0 ? field : field.slice(0, separator);
    const value = separator < 0 ? '' : field.slice(separator + 1);
    record[key] = value;
  }

  if (Object.keys(record).length > 0) records.push(record);

  return records;
}

function repoPath(
  path: string,
): { readonly commonDir: string; readonly gitDir: string } | undefined {
  const commonDir = gitValue(path, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);

  const gitDir = gitValue(path, [
    'rev-parse',
    '--path-format=absolute',
    '--git-dir',
  ]);

  return commonDir === undefined || gitDir === undefined
    ? undefined
    : { commonDir, gitDir };
}

export function inspectRepository(input: { readonly path: string }) {
  const toplevel = gitValue(input.path, ['rev-parse', '--show-toplevel']);

  if (toplevel === undefined) return gitFailure('not_a_repository');

  const paths = repoPath(input.path);

  if (paths === undefined) return gitFailure('git_failed');

  const linked = paths.commonDir !== paths.gitDir;

  const listing = linked
    ? runGit(input.path, ['worktree', 'list', '--porcelain', '-z'])
    : undefined;

  const mainWorktree =
    listing?.ok === true
      ? (worktreeRecords(listing.stdout)[0]?.['worktree'] ?? null)
      : null;

  return {
    status: 'ok' as const,
    toplevel,
    commonDir: paths.commonDir,
    linked,
    mainWorktree,
    remotes: remotes(input.path),
    branch:
      gitValue(input.path, [
        'symbolic-ref',
        '--short',
        '--quiet',
        'HEAD',
      ])?.trim() ?? null,
    head:
      gitValue(input.path, ['rev-parse', '--verify', 'HEAD'])?.trim() ?? null,
  };
}

async function entryIn(directory: string): Promise<GitEntry | undefined> {
  const gitEntry = `${directory}${directory.endsWith(sep) ? '' : sep}.git`;

  try {
    const entry = await stat(gitEntry);

    if (entry.isDirectory())
      return { status: 'ok', gitEntry, kind: 'directory' };

    if (entry.isFile()) return { status: 'ok', gitEntry, kind: 'file' };
  } catch (error) {
    if (
      !isRecord(error) ||
      (error['code'] !== 'ENOENT' && error['code'] !== 'ENOTDIR')
    )
      return undefined;
  }
}

export async function locateRepository(input: { readonly path: string }) {
  let directory = input.path;

  try {
    if (!(await stat(directory)).isDirectory())
      return gitFailure('root_missing');
  } catch {
    return gitFailure('root_missing');
  }

  for (;;) {
    const found = await entryIn(directory);

    if (found !== undefined) return found;

    const parent = dirname(directory);

    if (parent === directory) return gitFailure('not_a_repository');

    directory = parent;
  }
}

function statusEntries(path: string, timeout: number) {
  const status = runGit(
    path,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    timeout,
  );

  if (!status.ok) return { failure: gitFailure('git_failed', status.stderr) };

  const entries = status.stdout
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => ({
      xy: entry.slice(0, 2),
      path: entry.slice(3),
    }));

  const counts = {
    staged: entries.filter(
      (entry) => entry.xy[0] !== ' ' && entry.xy[0] !== '?',
    ).length,
    unstaged: entries.filter((entry) => entry.xy[1] !== ' ').length,
    untracked: entries.filter((entry) => entry.xy === '??').length,
    conflicted: entries.filter((entry) => entry.xy.includes('U')).length,
  };

  return { entries, counts };
}

function upstreamState(
  path: string,
  branch: string | undefined,
  timeout: number,
) {
  if (branch === undefined) return null;

  const name = gitValue(
    path,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    timeout,
  );

  if (name === undefined) return null;

  const result = runGit(
    path,
    ['rev-list', '--left-right', '--count', `HEAD...${name}`],
    timeout,
  );

  const match = result.stdout.trim().match(/^(\d+)\s+(\d+)$/u);

  return {
    name,
    gone: !result.ok,
    ahead: match === null ? null : Number(match[1]),
    behind: match === null ? null : Number(match[2]),
    updatedAt: null,
  };
}

function recentCommits(path: string, timeout: number) {
  const result = runGit(path, ['log', '-5', '--format=%h%x00%s'], timeout);

  if (!result.ok) return [];

  return result.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const separator = line.indexOf('\0');

      return {
        short: line.slice(0, separator),
        subject: line.slice(separator + 1),
      };
    });
}

export function stateRepository(
  input: { readonly path: string; readonly limit: number },
  options: { readonly timeoutMs?: number } = {},
) {
  const timeout = options.timeoutMs ?? 30_000;

  const toplevel = gitValue(
    input.path,
    ['rev-parse', '--show-toplevel'],
    timeout,
  );

  if (toplevel === undefined) return gitFailure('not_a_repository');

  const status = statusEntries(input.path, timeout);

  if ('failure' in status) return status.failure;

  const branch = gitValue(
    input.path,
    ['symbolic-ref', '--short', '--quiet', 'HEAD'],
    timeout,
  );

  const head = gitValue(input.path, ['rev-parse', '--verify', 'HEAD'], timeout);

  const listed = status.entries.slice(0, Math.max(0, input.limit));

  return {
    status: 'ok' as const,
    toplevel,
    rootRelative: relative(toplevel, input.path).split(sep).join('/'),
    branch: branch?.trim() ?? null,
    detached: branch === undefined,
    head: head?.trim() ?? null,
    upstream: upstreamState(input.path, branch, timeout),
    operation: null,
    counts: status.counts,
    entries: listed,
    omitted: status.entries.length - listed.length,
    submodules: [],
    commits: recentCommits(input.path, timeout),
    remotes: remotes(input.path),
  };
}

export function addWorktree(input: {
  readonly source: string;
  readonly branch: string;
  readonly directory: string;
  readonly baseRef?: string;
}) {
  const args = ['worktree', 'add', '-b', input.branch, input.directory];

  if (input.baseRef !== undefined) args.push(input.baseRef);

  const result = runGit(input.source, args);

  if (!result.ok) return gitFailure('git_failed', result.stderr);

  const head = gitValue(input.directory, ['rev-parse', '--verify', 'HEAD']);

  if (head === undefined) return gitFailure('git_failed');

  return {
    status: 'ok' as const,
    path: input.directory,
    branch: input.branch,
    head: head.trim(),
  };
}

export function listWorktrees(input: { readonly path: string }) {
  const result = runGit(input.path, ['worktree', 'list', '--porcelain', '-z']);

  if (!result.ok) return gitFailure('git_failed', result.stderr);

  return {
    status: 'ok' as const,
    worktrees: worktreeRecords(result.stdout).map((record) => ({
      path: record['worktree'] ?? '',
      branch: record['branch']?.replace(/^refs\/heads\//u, '') ?? null,
      head: record['HEAD'] ?? null,
      locked: 'locked' in record,
      prunable: 'prunable' in record,
    })),
  };
}

export function removeWorktree(input: { readonly path: string }) {
  const commonDir = gitValue(input.path, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);

  if (commonDir === undefined) return gitFailure('git_failed');

  const result = runGit(dirname(commonDir), ['worktree', 'remove', input.path]);

  return result.ok
    ? { status: 'ok' as const }
    : gitFailure('git_failed', result.stderr);
}
