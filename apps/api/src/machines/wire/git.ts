import { randomUUID } from 'node:crypto';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import { GitFailureReason, OperationKind, SubmoduleMode, type MachineMethod, type GitFailure, type GitInspectResult, type GitLocateResult, type GitStateResult, type GitWorktreeAddResult, type GitWorktreeListResult, type GitWorktreeRemoveResult } from '@workspace/machine-protocol';
import { formatMachineLocator, parseMachineLocator } from '../machine-locator';
import type { MachineSession } from '../machine-session';
import type { Handler } from './index';

const FAILURE_TYPES: Record<GitFailureReason, GitFailure['type']> = {
  [GitFailureReason.UNSPECIFIED]: 'git_failed', [GitFailureReason.NOT_A_REPOSITORY]: 'not_a_repository',
  [GitFailureReason.OUTSIDE_ROOTS]: 'outside_registered_root', [GitFailureReason.INVALID_INPUT]: 'invalid_input',
  [GitFailureReason.TIMED_OUT]: 'timed_out', [GitFailureReason.GIT_FAILED]: 'git_failed',
  [GitFailureReason.OUTPUT_TOO_LARGE]: 'output_bound',
};
const OPERATION_KINDS: Record<OperationKind, 'merge' | 'rebase' | 'am' | 'cherry-pick' | 'revert' | 'bisect' | undefined> = {
  [OperationKind.UNSPECIFIED]: undefined, [OperationKind.MERGE]: 'merge', [OperationKind.REBASE]: 'rebase',
  [OperationKind.AM]: 'am', [OperationKind.CHERRY_PICK]: 'cherry-pick', [OperationKind.REVERT]: 'revert', [OperationKind.BISECT]: 'bisect',
};

function hostPath(session: MachineSession, value: string): string {
  const parsed = parseMachineLocator(value);
  if (parsed.kind === 'path' && parsed.name === session.name && parsed.selector === undefined) return parsed.path;
  if (value.startsWith('/')) return value;
  throw new Error(`Git path does not identify a path on Machine ${session.name}.`);
}
function locator(session: MachineSession, value: string): string {
  const rendered = formatMachineLocator(session.name, value);
  if (rendered === undefined) throw new Error(`Git returned a path that cannot be rendered: ${value}`);
  return rendered;
}
function rewriteRoots(text: string, session: MachineSession): string {
  const roots = session.hello?.roots ?? [];
  return [...roots].sort((a, b) => b.length - a.length).reduce((out, root) => {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return out.replace(new RegExp(`(^|[\\s'"(])${escaped}(?=$|/|[:,'")\\s])`, 'gu'), (_match, before: string) => `${before}machine://${session.name}${root}`);
  }, text);
}
function failure(value: { reason: GitFailureReason; message: string; stderr: string }, session: MachineSession): GitFailure {
  const type = FAILURE_TYPES[value.reason] ?? 'git_failed';
  return type === 'invalid_input'
    ? { status: 'error', type, message: rewriteRoots(value.message, session) }
    : { status: 'error', type, stderr: rewriteRoots(value.stderr, session) };
}

export const gitHandlers = {
  'git.inspect': async (session, params, options) => {
    const response = await session.clients.git.getRepository({ path: hostPath(session, params.path) }, session.callOptions(options));
    if (response.result.case === 'failure') return failure(response.result.value, session) as GitInspectResult;
    if (response.result.case !== 'repository') throw new Error('GitService.GetRepository returned no result.');
    const repo = response.result.value;
    return { status: 'ok', toplevel: locator(session, repo.worktree), commonDir: locator(session, repo.commonDir), linked: repo.mainWorktree !== undefined, mainWorktree: repo.mainWorktree === undefined ? null : locator(session, repo.mainWorktree), remotes: repo.remotes, branch: repo.branch ?? null, head: repo.head ?? null };
  },
  'git.locate': async (session, params, options) => {
    const response = await session.clients.git.getRepository({ path: hostPath(session, params.path) }, session.callOptions(options));
    if (response.result.case === 'failure') return failure(response.result.value, session) as GitLocateResult;
    if (response.result.case !== 'repository') throw new Error('GitService.GetRepository returned no result.');
    const repository = response.result.value;
    return { status: 'ok', gitEntry: locator(session, `${repository.worktree.replace(/\/$/u, '')}/.git`), kind: repository.mainWorktree === undefined ? 'directory' : 'file' };
  },
  'git.state': async (session, params, options) => {
    const response = await session.clients.git.getStatus({ path: hostPath(session, params.path), maxEntries: params.limit, maxCommits: 10, submodules: params.submodules === 'check' ? SubmoduleMode.CHECK : SubmoduleMode.SKIP }, session.callOptions(options));
    if (response.result.case === 'failure') return failure(response.result.value, session) as GitStateResult;
    if (response.result.case !== 'status') throw new Error('GitService.GetStatus returned no result.');
    const state = response.result.value;
    if (state.repository === undefined || state.counts === undefined) throw new Error('GitService.GetStatus returned incomplete status.');
    const operationKind = OPERATION_KINDS[state.operation?.kind ?? OperationKind.UNSPECIFIED];
    return { status: 'ok', toplevel: locator(session, state.repository.worktree), rootRelative: state.relativePath, branch: state.repository.branch ?? null, detached: state.repository.branch === undefined, head: state.repository.head ?? null,
      upstream: state.upstream === undefined ? null : { name: state.upstream.name, gone: state.upstream.gone, ahead: state.upstream.ahead ?? null, behind: state.upstream.behind ?? null, updatedAt: state.upstream.updatedAt === undefined ? null : timestampDate(state.upstream.updatedAt).toISOString() },
      operation: operationKind === undefined ? null : { kind: operationKind, ...(state.operation?.step === undefined ? {} : { step: state.operation.step }), ...(state.operation?.total === undefined ? {} : { total: state.operation.total }) },
      counts: { staged: state.counts.staged, unstaged: state.counts.unstaged, untracked: state.counts.untracked, conflicted: state.counts.conflicted },
      entries: state.changes.map(change => ({ xy: change.status, path: change.path, ...(change.from === undefined ? {} : { from: change.from }) })), omitted: state.omitted, submodules: state.submodules, commits: state.commits.map(commit => ({ short: commit.id, subject: commit.subject })), remotes: state.repository.remotes };
  },
  'git.worktreeAdd': async (session, params, options) => {
    const response = await session.clients.git.createWorktree({ requestId: randomUUID(), repository: hostPath(session, params.source), branch: params.branch, ...(params.baseRef === undefined ? {} : { base: params.baseRef }), path: hostPath(session, params.directory) }, session.callOptions(options));
    if (response.result.case === 'failure') return failure(response.result.value, session) as GitWorktreeAddResult;
    if (response.result.case !== 'worktree') throw new Error('GitService.CreateWorktree returned no result.');
    return { status: 'ok', path: locator(session, response.result.value.path), branch: response.result.value.branch ?? params.branch, head: response.result.value.head ?? '' };
  },
  'git.worktreeList': async (session, params, options) => {
    const response = await session.clients.git.listWorktrees({ repository: hostPath(session, params.source) }, session.callOptions(options));
    if (response.result.case === 'failure') return failure(response.result.value, session) as GitWorktreeListResult;
    if (response.result.case !== 'worktrees') throw new Error('GitService.ListWorktrees returned no result.');
    return { status: 'ok', worktrees: response.result.value.worktrees.map(w => ({ path: locator(session, w.path), branch: w.branch ?? null, head: w.head ?? null, locked: w.locked, prunable: w.prunable })) };
  },
  'git.worktreeRemove': async (session, params, options) => {
    const response = await session.clients.git.deleteWorktree({ requestId: randomUUID(), path: hostPath(session, params.path) }, session.callOptions(options));
    if (response.result.case === 'failure') return failure(response.result.value, session) as GitWorktreeRemoveResult;
    if (response.result.case !== 'deleted') throw new Error('GitService.DeleteWorktree returned no result.');
    return { status: 'ok' };
  },
} satisfies Partial<{ [M in MachineMethod]: Handler<M> }>;
