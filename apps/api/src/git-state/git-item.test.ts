import {
  createWorkspaceDetachNoticeItem,
  createWorkspaceSnapshotItem,
} from '../chats/context-item-producers';
import { createWorkspaceMachineAvailabilityItem } from '../chats/machine-context-item-producers';
import { createGitItem, gitToldState } from './git-item';
import { normalizeGitState } from './git-state-normalize';
import { type GitObservation } from './git-state-view';

const RUN_ID = '3b0f5b8e-6d2e-4c0a-9c1d-0f6a7c8d9e10';

const STATE: GitObservation = {
  kind: 'state',
  view: normalizeGitState({
    status: 'ok',
    toplevel: '/repo',
    rootRelative: '',
    branch: 'main',
    detached: false,
    head: 'abc1234def5678abc1234def5678abc1234def56',
    upstream: null,
    operation: null,
    counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
    entries: [],
    omitted: 0,
    submodules: [],
    commits: [],
    remotes: [
      { name: 'origin', url: 'https://user:secret@example.com/a/b.git' },
    ],
  }),
};

const git = (observation: GitObservation) =>
  createGitItem({ runId: RUN_ID, observation });

const workspace = () =>
  createWorkspaceSnapshotItem({ runId: RUN_ID, root: '/repo' });

function entry(state: 'bound' | 'switched' | 'unchanged') {
  return {
    type: 'tool-enter_workspace',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { path: '/repo' },
    output: { status: 'success', root: '/repo', state },
  };
}

describe('createGitItem', () => {
  it('is a git snapshot whose payload is the observation', () => {
    const item = git(STATE);

    expect(item.data.producer).toBe('git');
    expect(item.data.form).toBe('snapshot');
    expect(item.data.payload).toEqual(STATE);
    expect(item.data.text).toContain('Branch: `main`');
  });

  it('keeps raw remote credentials out of the payload and the text', () => {
    const item = git(STATE);

    expect(JSON.stringify(item)).not.toContain('secret');
  });

  it('carries an absence as its closed reason', () => {
    const item = git({ kind: 'unavailable', reason: 'timeout' });

    expect(item.data.payload).toEqual({
      kind: 'unavailable',
      reason: 'timeout',
    });
    expect(item.data.text).toContain('git state unavailable: timeout');
  });
});

describe('gitToldState', () => {
  const told = (...parts: Array<unknown>) => gitToldState(parts).text;

  const rootedAt = (root: string) =>
    createWorkspaceSnapshotItem({ runId: RUN_ID, root });

  it('holds nothing for an empty history', () => {
    expect(gitToldState([])).toEqual({ text: undefined, root: undefined });
  });

  it('is the text of the last git item', () => {
    const first = git({ kind: 'not_a_repository' });
    const last = git(STATE);

    expect(told(first, { type: 'text', text: 'hi' }, last)).toBe(
      last.data.text,
    );
  });

  it('keeps a git item that follows the workspace snapshot of its turn', () => {
    const item = git(STATE);

    expect(told(workspace(), item)).toBe(item.data.text);
  });

  it('voids a git item when a snapshot names another root', () => {
    expect(told(git(STATE), rootedAt('/other'))).toBeUndefined();
  });

  it('keeps a git item across a same-root snapshot after an entry', () => {
    const item = git(STATE);

    expect(told(entry('bound'), item, workspace())).toBe(item.data.text);
  });

  it('keeps a git item across a same-root snapshot of the bound history', () => {
    const item = git(STATE);

    expect(told(workspace(), item, workspace())).toBe(item.data.text);
  });

  it('voids a git item when a snapshot names no root', () => {
    const none = createWorkspaceSnapshotItem({ runId: RUN_ID, root: null });

    expect(told(workspace(), git(STATE), none)).toBeUndefined();
  });

  it('voids a git item at a detach notice', () => {
    const detach = createWorkspaceDetachNoticeItem({
      runId: RUN_ID,
      reason: 'root_missing',
    });

    expect(told(workspace(), git(STATE), detach)).toBeUndefined();
    expect(gitToldState([workspace(), detach]).root).toBeNull();
  });

  it('keeps a git item across a Machine availability notice', () => {
    const item = git(STATE);

    const notice = createWorkspaceMachineAvailabilityItem({
      runId: RUN_ID,
      machine: 'box',
      available: false,
    });

    expect(told(workspace(), item, notice)).toBe(item.data.text);
  });

  it.each(['bound', 'switched'] as const)(
    'voids a git item when an entry %s the root',
    (state) => {
      expect(told(git(STATE), entry(state))).toBeUndefined();
    },
  );

  it('tracks the root an entry bound', () => {
    expect(gitToldState([entry('switched')]).root).toBe('/repo');
  });

  it('keeps a git item across a same-root re-entry', () => {
    const item = git(STATE);

    expect(told(item, entry('unchanged'))).toBe(item.data.text);
  });

  it('keeps a git item across a failed entry', () => {
    const item = git(STATE);
    const failed = { ...entry('bound'), state: 'output-error' };

    expect(told(item, failed)).toBe(item.data.text);
  });

  it('voids a git item at a successful exit, leaving no root bound', () => {
    const exit = {
      type: 'tool-exit_workspace',
      toolCallId: 'call-2',
      state: 'output-available',
      input: {},
      output: { status: 'success' },
    };

    expect(gitToldState([git(STATE), exit])).toEqual({
      text: undefined,
      root: null,
    });
  });

  it('tells the new item after an entry that bound the root', () => {
    const after = git({ kind: 'not_a_repository' });

    expect(told(git(STATE), entry('switched'), after)).toBe(after.data.text);
  });
});
