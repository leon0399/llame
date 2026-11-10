import {
  CONTEXT_ITEM_PRODUCERS,
  isContextItemPart,
  type AuthoredContextItemPart,
} from '../chats/context-item';
import { type MessagePart } from '../chats/context-builder';
import {
  advanceGitTold,
  createGitItem,
  type GitToldState,
} from '../git-state/git-item';
import { type GitObservation } from '../git-state/git-state-view';

/**
 * The accepted turn's git state: the attempt's one observation (absent for an
 * unbound Chat), the item this turn stages, and the text the effective history
 * already told. A checkpoint's second pass replaces `part` and `toldText` and
 * keeps the observation, so one attempt reads git once.
 */
export type TurnGit = {
  readonly observation: GitObservation | undefined;
  part: AuthoredContextItemPart | undefined;
  toldText: string | undefined;
};

/**
 * Places a staged item at its rail position: directly after every item whose
 * producer precedes its own, and before the items that follow (design D10).
 */
export function placeRailPart(
  parts: Array<MessagePart>,
  part: AuthoredContextItemPart,
): void {
  const rank = CONTEXT_ITEM_PRODUCERS.findIndex(
    (known) => known === part.data.producer,
  );

  const index = parts.findLastIndex(
    (staged) =>
      isContextItemPart(staged) &&
      CONTEXT_ITEM_PRODUCERS.findIndex(
        (known) => known === staged.data.producer,
      ) < rank,
  );

  parts.splice(index + 1, 0, part);
}

/**
 * Recomputes the turn's `git` item against the attempt's effective history and
 * replaces the previous one in `stagedParts`, where the request assembly and the
 * dispatch transaction both see it. A `workspace` item this turn stages voids
 * the told text when it changes the binding (the same rule the history follows).
 * Calls no git: the observation was read once for the attempt.
 */
export function refreshTurnGit(input: {
  readonly turn: TurnGit;
  readonly stagedParts: Array<MessagePart>;
  /** What the rebuilt history told, with the root it leaves bound. */
  readonly history: GitToldState;
  readonly runId: string;
}): void {
  const { turn, stagedParts } = input;

  if (turn.observation === undefined) return;
  let state = input.history;

  for (const staged of stagedParts) {
    if (isContextItemPart(staged) && staged.data.producer === 'workspace') {
      state = advanceGitTold(state, staged);
    }
  }

  turn.toldText = state.text;

  const item = createGitItem({
    runId: input.runId,
    observation: turn.observation,
  });

  const part = item.data.text === turn.toldText ? undefined : item;
  const previous = turn.part;

  if (previous !== undefined) {
    const index = stagedParts.indexOf(previous);

    if (index >= 0) stagedParts.splice(index, 1);
  }

  turn.part = part;

  if (part !== undefined) placeRailPart(stagedParts, part);
}
