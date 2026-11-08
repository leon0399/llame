import { createWorkspaceSnapshotItem } from '../chats/context-item-producers';
import { createGitItem, gitToldText } from './git-item';
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

  it('renders identical text for an identical observation', () => {
    expect(git(STATE).data.text).toBe(git(STATE).data.text);
  });
});

describe('gitToldText', () => {
  it('holds nothing for an empty history', () => {
    expect(gitToldText([])).toBeUndefined();
  });

  it('is the text of the last git item', () => {
    const first = git({ kind: 'not_a_repository' });
    const last = git(STATE);

    expect(gitToldText([first, { type: 'text', text: 'hi' }, last])).toBe(
      last.data.text,
    );
  });

  it('keeps a git item that follows the workspace snapshot of its turn', () => {
    const item = git(STATE);

    expect(gitToldText([workspace(), item])).toBe(item.data.text);
  });

  it('voids a git item when a workspace item follows it', () => {
    expect(gitToldText([git(STATE), workspace()])).toBeUndefined();
  });

  it.each(['bound', 'switched'] as const)(
    'voids a git item when an entry %s the root',
    (state) => {
      expect(gitToldText([git(STATE), entry(state)])).toBeUndefined();
    },
  );

  it('keeps a git item across a same-root re-entry', () => {
    const item = git(STATE);

    expect(gitToldText([item, entry('unchanged')])).toBe(item.data.text);
  });

  it('keeps a git item across a failed entry', () => {
    const item = git(STATE);
    const failed = { ...entry('bound'), state: 'output-error' };

    expect(gitToldText([item, failed])).toBe(item.data.text);
  });

  it('voids a git item at a successful exit', () => {
    const exit = {
      type: 'tool-exit_workspace',
      toolCallId: 'call-2',
      state: 'output-available',
      input: {},
      output: { status: 'success' },
    };

    expect(gitToldText([git(STATE), exit])).toBeUndefined();
  });

  it('tells the new item after an entry that bound the root', () => {
    const after = git({ kind: 'not_a_repository' });

    expect(gitToldText([git(STATE), entry('switched'), after])).toBe(
      after.data.text,
    );
  });
});
