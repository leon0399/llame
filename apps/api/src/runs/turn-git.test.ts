import {
  createContextItemPart,
  type AuthoredContextItemPart,
} from '../chats/context-item';
import {
  createWorkspaceDetachNoticeItem,
  createWorkspaceSnapshotItem,
} from '../chats/context-item-producers';
import type { MessagePart } from '../chats/context-builder';
import { createGitItem, type GitToldState } from '../git-state/git-item';
import { type GitObservation } from '../git-state/git-state-view';
import { placeRailPart, refreshTurnGit, type TurnGit } from './turn-git';

const RUN_ID = '3b0f5b8e-6d2e-4c0a-9c1d-0f6a7c8d9e10';
const CLEAN: GitObservation = { kind: 'not_a_repository' };
const FAILED: GitObservation = { kind: 'unavailable', reason: 'git_failed' };

const textOf = (observation: GitObservation) =>
  createGitItem({ runId: RUN_ID, observation }).data.text;

function item(
  producer: 'workspace' | 'git' | 'instructions' | 'temporal',
): AuthoredContextItemPart {
  return createContextItemPart({
    producer,
    form: 'snapshot',
    runId: RUN_ID,
    payload: {},
    text: `<${producer}>`,
  });
}

describe('placeRailPart', () => {
  it('places a git item after the workspace item and before instructions', () => {
    const parts: Array<MessagePart> = [
      item('workspace'),
      item('instructions'),
      { type: 'text', text: 'hi' },
    ];

    const git = item('git');

    placeRailPart(parts, git);

    expect(parts[1]).toBe(git);
    expect(parts).toHaveLength(4);
  });

  it('places an instructions item after the git item', () => {
    const git = item('git');

    const parts: Array<MessagePart> = [
      item('workspace'),
      git,
      item('temporal'),
    ];

    const instructions = item('instructions');

    placeRailPart(parts, instructions);

    expect(parts[2]).toBe(instructions);
  });

  it('leads the turn when no earlier producer staged an item', () => {
    const git = item('git');
    const parts: Array<MessagePart> = [{ type: 'text', text: 'hi' }];

    placeRailPart(parts, git);

    expect(parts[0]).toBe(git);
  });
});

describe('refreshTurnGit', () => {
  const fresh = (observation: GitObservation | undefined): TurnGit => ({
    observation,
    part: undefined,
    toldText: undefined,
  });

  const history = (
    text: string | undefined,
    root: string | null | undefined = '/repo',
  ): GitToldState => ({ text, root });

  const refresh = (
    turn: TurnGit,
    stagedParts: Array<MessagePart>,
    told: GitToldState,
  ) => refreshTurnGit({ turn, stagedParts, history: told, runId: RUN_ID });

  it('does nothing for an unbound Chat', () => {
    const turn = fresh(undefined);
    const staged: Array<MessagePart> = [];

    refresh(turn, staged, history(undefined));

    expect(staged).toEqual([]);
    expect(turn.part).toBeUndefined();
  });

  it('stages the item after the workspace snapshot', () => {
    const turn = fresh(CLEAN);

    const workspace = createWorkspaceSnapshotItem({
      runId: RUN_ID,
      root: '/repo',
    });

    const staged: Array<MessagePart> = [workspace, item('instructions')];

    refresh(turn, staged, history(undefined));

    expect(staged[0]).toBe(workspace);
    expect(staged[1]).toBe(turn.part);
    expect(turn.part?.data.text).toBe(textOf(CLEAN));
  });

  it('adds nothing when the history told the same text', () => {
    const turn = fresh(CLEAN);
    const staged: Array<MessagePart> = [];

    refresh(turn, staged, history(textOf(CLEAN)));

    expect(staged).toEqual([]);
    expect(turn.toldText).toBe(textOf(CLEAN));
  });

  it('tells again when this turn stages a snapshot of another root', () => {
    const turn = fresh(CLEAN);

    const staged: Array<MessagePart> = [
      createWorkspaceSnapshotItem({ runId: RUN_ID, root: '/other' }),
    ];

    refresh(turn, staged, history(textOf(CLEAN)));

    expect(staged[1]).toBe(turn.part);
    expect(turn.part?.data.text).toBe(textOf(CLEAN));
    expect(turn.toldText).toBeUndefined();
  });

  it('adds nothing when this turn re-tells the root the history holds', () => {
    const turn = fresh(CLEAN);

    const staged: Array<MessagePart> = [
      createWorkspaceSnapshotItem({ runId: RUN_ID, root: '/repo' }),
    ];

    refresh(turn, staged, history(textOf(CLEAN)));

    expect(staged).toHaveLength(1);
    expect(turn.part).toBeUndefined();
  });

  it('tells again when this turn stages a detach notice', () => {
    const turn = fresh(CLEAN);

    const staged: Array<MessagePart> = [
      createWorkspaceDetachNoticeItem({
        runId: RUN_ID,
        reason: 'root_missing',
      }),
    ];

    refresh(turn, staged, history(textOf(CLEAN)));

    expect(turn.part?.data.text).toBe(textOf(CLEAN));
  });

  it('replaces its earlier item on a second pass with the same observation', () => {
    const turn = fresh(FAILED);
    const staged: Array<MessagePart> = [];
    refresh(turn, staged, history(undefined));
    const first = turn.part;

    // A checkpoint published: the rebuilt history holds no git item.
    refresh(turn, staged, history(undefined));

    expect(staged).toHaveLength(1);
    expect(staged[0]).toBe(turn.part);
    expect(turn.part).not.toBe(first);
    expect(turn.part?.data.text).toBe(first?.data.text);
  });

  it('drops its earlier item when the rebuilt history already told the state', () => {
    const turn = fresh(CLEAN);
    const staged: Array<MessagePart> = [];
    refresh(turn, staged, history(undefined));

    refresh(turn, staged, history(textOf(CLEAN)));

    expect(staged).toEqual([]);
    expect(turn.part).toBeUndefined();
  });
});
