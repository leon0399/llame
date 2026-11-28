import { randomUUID } from 'node:crypto';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import {
  create,
  CreateWorktreeRequestSchema,
  EntryKind,
  GitFailureReason,
  OperationKind,
  SubmoduleMode,
  type Change,
  type GitMethod,
  type Operation,
  type Status,
  type GitFailure,
  type GitStateResult,
  type GitStateSuccess,
} from '@workspace/machine-protocol';
import { formatMachineLocator, parseMachineLocator } from '../machine-locator';
import type { MachineSession } from '../machine-session';
import type { Handler } from './index';

type GitHandlers = { [M in GitMethod]: Handler<M> };

const FAILURE_TYPES: Record<GitFailureReason, GitFailure['type']> = {
  [GitFailureReason.UNSPECIFIED]: 'git_failed',
  [GitFailureReason.NOT_A_REPOSITORY]: 'not_a_repository',
  [GitFailureReason.OUTSIDE_ROOTS]: 'outside_registered_root',
  [GitFailureReason.INVALID_INPUT]: 'invalid_input',
  [GitFailureReason.TIMED_OUT]: 'timed_out',
  [GitFailureReason.GIT_FAILED]: 'git_failed',
  [GitFailureReason.OUTPUT_TOO_LARGE]: 'output_bound',
  [GitFailureReason.ENTRY_CHANGED]: 'git_entry_changed',
  [GitFailureReason.ROOT_MISSING]: 'root_missing',
  [GitFailureReason.NO_REPOSITORY_IN_ROOT]: 'no_repository_in_root',
  [GitFailureReason.COPY_FAILED]: 'copy_failed',
};

const OPERATION_KINDS: Record<
  OperationKind,
  'merge' | 'rebase' | 'am' | 'cherry-pick' | 'revert' | 'bisect' | undefined
> = {
  [OperationKind.UNSPECIFIED]: undefined,
  [OperationKind.MERGE]: 'merge',
  [OperationKind.REBASE]: 'rebase',
  [OperationKind.AM]: 'am',
  [OperationKind.CHERRY_PICK]: 'cherry-pick',
  [OperationKind.REVERT]: 'revert',
  [OperationKind.BISECT]: 'bisect',
};

function hostPath(session: MachineSession, value: string): string {
  const parsed = parseMachineLocator(value);

  if (
    parsed.kind === 'path' &&
    parsed.name === session.name &&
    parsed.selector === undefined
  )
    return parsed.path;

  if (value.startsWith('/')) return value;
  throw new Error(
    `Git path does not identify a path on Machine ${session.name}.`,
  );
}

function locator(session: MachineSession, value: string): string {
  const rendered = formatMachineLocator(session.name, value);

  if (rendered === undefined)
    throw new Error(`Git returned a path that cannot be rendered: ${value}`);

  return rendered;
}

function rewriteRoots(text: string, session: MachineSession): string {
  const roots = session.hello?.roots ?? [];

  return [...roots]
    .sort((a, b) => b.length - a.length)
    .reduce((out, root) => {
      if (root === '/') {
        return out.replaceAll(
          /(^|[\s'"(])\/(?=$|[^/])/gu,
          (_match, before: string) => `${before}machine://${session.name}/`,
        );
      }

      const escaped = root.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

      return out.replaceAll(
        new RegExp(`(^|[\\s'"(])${escaped}(?=$|/|[:,'")\\s])`, 'gu'),
        (_match, before: string) => `${before}machine://${session.name}${root}`,
      );
    }, text);
}

function failure(
  value: { reason: GitFailureReason; message: string; stderr: string },
  session: MachineSession,
): GitFailure {
  const type = FAILURE_TYPES[value.reason] ?? 'git_failed';

  return type === 'invalid_input' || type === 'copy_failed'
    ? { status: 'error', type, message: rewriteRoots(value.message, session) }
    : { status: 'error', type, stderr: rewriteRoots(value.stderr, session) };
}

function mapUpstream(upstream: Status['upstream']) {
  if (upstream === undefined) return null;

  return {
    name: upstream.name,
    gone: upstream.gone,
    ahead: upstream.ahead ?? null,
    behind: upstream.behind ?? null,
    updatedAt:
      upstream.updatedAt === undefined
        ? null
        : timestampDate(upstream.updatedAt).toISOString(),
  };
}

function mapOperation(
  operation: Operation | undefined,
): GitStateSuccess['operation'] {
  const kind = OPERATION_KINDS[operation?.kind ?? OperationKind.UNSPECIFIED];

  if (kind === undefined) return null;

  if (operation?.step !== undefined && operation.total !== undefined)
    return { kind, step: operation.step, total: operation.total };

  if (operation?.step !== undefined) return { kind, step: operation.step };

  if (operation?.total !== undefined) return { kind, total: operation.total };

  return { kind };
}

function mapChanges(
  changes: ReadonlyArray<Change>,
): GitStateSuccess['entries'] {
  return changes.map((change) =>
    change.from === undefined
      ? { xy: change.status, path: change.path }
      : { xy: change.status, path: change.path, from: change.from },
  );
}

function stateResult(session: MachineSession, state: Status): GitStateResult {
  if (state.repository === undefined || state.counts === undefined)
    throw new Error('GitService.GetStatus returned incomplete status.');

  return {
    status: 'ok',
    toplevel: locator(session, state.repository.worktree),
    rootRelative: state.relativePath,
    branch: state.repository.branch ?? null,
    detached: state.repository.branch === undefined,
    head: state.repository.head ?? null,
    upstream: mapUpstream(state.upstream),
    operation: mapOperation(state.operation),
    counts: {
      staged: state.counts.staged,
      unstaged: state.counts.unstaged,
      untracked: state.counts.untracked,
      conflicted: state.counts.conflicted,
    },
    entries: mapChanges(state.changes),
    omitted: state.omitted,
    submodules: state.submodules,
    commits: state.commits.map((commit) => ({
      short: commit.id,
      subject: commit.subject,
    })),
    remotes: state.repository.remotes,
  };
}

export const gitHandlers: GitHandlers = {
  'git.inspect': async (session, params, options) => {
    const response = await session.clients.git.getRepository(
      { path: hostPath(session, params.path) },
      session.callOptions(options),
    );

    if (response.result.case === 'failure')
      return failure(response.result.value, session);

    if (response.result.case !== 'repository')
      throw new Error('GitService.GetRepository returned no result.');
    const repo = response.result.value;

    return {
      status: 'ok',
      toplevel: locator(session, repo.worktree),
      commonDir: locator(session, repo.commonDir),
      linked: repo.mainWorktree !== undefined,
      mainWorktree:
        repo.mainWorktree === undefined
          ? null
          : locator(session, repo.mainWorktree),
      remotes: repo.remotes,
      branch: repo.branch ?? null,
      head: repo.head ?? null,
    };
  },
  'git.locate': async (session, params, options) => {
    const response = await session.clients.git.locateRepository(
      { path: hostPath(session, params.path) },
      session.callOptions(options),
    );

    if (response.result.case === 'failure')
      return failure(response.result.value, session);

    if (response.result.case !== 'gitEntry')
      throw new Error('GitService.LocateRepository returned no result.');
    const entry = response.result.value;

    const stat = await session.clients.files.getEntry(
      { path: entry },
      session.callOptions(options),
    );

    if (stat.result.case !== 'entry')
      return { status: 'error', type: 'git_entry_changed', stderr: '' };

    return {
      status: 'ok',
      gitEntry: locator(session, entry),
      kind:
        stat.result.value.kind === EntryKind.DIRECTORY ? 'directory' : 'file',
    };
  },
  'git.state': async (session, params, options) => {
    const path = hostPath(session, params.path);

    const response = await session.clients.git.getStatus(
      {
        path,
        gitEntry: hostPath(session, params.gitEntry),
        maxEntries: params.limit,
        maxCommits: 10,
        submodules:
          params.submodules === 'check'
            ? SubmoduleMode.CHECK
            : SubmoduleMode.SKIP,
      },
      session.callOptions(options),
    );

    if (response.result.case === 'failure')
      return failure(response.result.value, session);

    if (response.result.case !== 'status')
      throw new Error('GitService.GetStatus returned no result.');

    return stateResult(session, response.result.value);
  },
  'git.worktreeAdd': async (session, params, options) => {
    const request = create(CreateWorktreeRequestSchema, {
      requestId: randomUUID(),
      repository: hostPath(session, params.source),
      branch: params.branch,
      path: hostPath(session, params.directory),
      copySource: hostPath(session, params.copySource),
    });

    if (params.baseRef !== undefined) request.base = params.baseRef;

    const response = await session.clients.git.createWorktree(
      request,
      session.callOptions(options),
    );

    if (response.result.case === 'failure')
      return failure(response.result.value, session);

    if (response.result.case !== 'worktree')
      throw new Error('GitService.CreateWorktree returned no result.');

    return {
      status: 'ok',
      path: locator(session, response.result.value.path),
      branch: response.result.value.branch ?? params.branch,
      head: response.result.value.head ?? '',
    };
  },
  'git.worktreeList': async (session, params, options) => {
    const response = await session.clients.git.listWorktrees(
      { repository: hostPath(session, params.source) },
      session.callOptions(options),
    );

    if (response.result.case === 'failure')
      return failure(response.result.value, session);

    if (response.result.case !== 'worktrees')
      throw new Error('GitService.ListWorktrees returned no result.');

    return {
      status: 'ok',
      worktrees: response.result.value.worktrees.map((w) => ({
        path: locator(session, w.path),
        branch: w.branch ?? null,
        head: w.head ?? null,
        locked: w.locked,
        prunable: w.prunable,
      })),
    };
  },
  'git.worktreeRemove': async (session, params, options) => {
    const response = await session.clients.git.deleteWorktree(
      { requestId: randomUUID(), path: hostPath(session, params.path) },
      session.callOptions(options),
    );

    if (response.result.case === 'failure')
      return failure(response.result.value, session);

    if (response.result.case !== 'deleted')
      throw new Error('GitService.DeleteWorktree returned no result.');

    return { status: 'ok' };
  },
};
