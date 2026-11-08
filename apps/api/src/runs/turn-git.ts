import {
  CONTEXT_ITEM_PRODUCERS,
  isContextItemPart,
  type AuthoredContextItemPart,
} from '../chats/context-item';
import { type MessagePart } from '../chats/context-builder';
import { type GitObservation } from '../git-state/git-state-view';
import { type InRunContextProducer } from './in-run-context-items';

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
 * dispatch transaction both see it. A `workspace` item this turn stages is a
 * binding change, so it voids what the history told. Calls no git: the
 * observation was read once for the attempt.
 */
export async function refreshTurnGit(input: {
  readonly producer: InRunContextProducer | undefined;
  readonly turn: TurnGit;
  readonly stagedParts: Array<MessagePart>;
  /** The `git` text the rebuilt history told since its last binding change. */
  readonly historyTold: string | undefined;
  readonly runId: string;
}): Promise<void> {
  const { producer, turn, stagedParts } = input;
  if (producer?.prepareTurn === undefined || turn.observation === undefined) {
    return;
  }
  const restarted = stagedParts.some(
    (staged) =>
      isContextItemPart(staged) && staged.data.producer === 'workspace',
  );
  turn.toldText = restarted ? undefined : input.historyTold;
  const part = await producer.prepareTurn({
    runId: input.runId,
    admitsRead: () => false,
    seenKeys: new Set(),
    git: { observation: turn.observation, toldText: turn.toldText },
  });
  const previous = turn.part;
  if (previous !== undefined) {
    const index = stagedParts.indexOf(previous);
    if (index >= 0) stagedParts.splice(index, 1);
  }
  turn.part = part;
  if (part !== undefined) placeRailPart(stagedParts, part);
}
