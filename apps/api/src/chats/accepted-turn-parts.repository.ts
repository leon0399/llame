/**
 * The dispatch-time write that puts an attempt's accepted-turn context items on
 * its triggering user message (design D1, D2), and the placement the request
 * assembly shares with it so the model receives exactly what is stored.
 *
 * Unlike the activation and prompt-import writes, this insert keys nothing on
 * item identity: each dispatch transaction commits at most once per attempt
 * (the attempt fence), and a retry derives only the items its stored state does
 * not already account for, so a repeated transition is stored again.
 */

import { messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  CONTEXT_ITEM_PRODUCERS,
  isContextItemPart,
  type ContextItemPart,
} from './context-item';
import {
  lockParts,
  messageOwner,
  railInsertionIndex,
} from './activation-parts.repository';

/**
 * Where a dispatch places its items: `rank` at producer precedence around the
 * facts stored before a Run's first dispatch (prompt imports, skill
 * activations); `append` after the last stored context item once an earlier
 * attempt of the Run dispatched, keeping that dispatch's items in place.
 */
export type AcceptedTurnPlacement = 'rank' | 'append';

export class AcceptedTurnPartsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Insert one dispatch's items into the locked user row and return the row's
   * resulting parts, or undefined when the row is gone. Callers run this inside
   * the attempt-fenced dispatch transaction, after the runs fence and before
   * any chats write.
   */
  async storeAtDispatch(input: {
    id: string;
    chatId: string;
    items: ReadonlyArray<ContextItemPart>;
    placement: AcceptedTurnPlacement;
  }): Promise<ReadonlyArray<unknown> | undefined> {
    const parts = await lockParts(this.db, input);
    if (parts === undefined) return undefined;
    if (input.items.length === 0) return parts;
    const placed = placeAcceptedTurnItems(parts, input.items, input.placement);
    const [updated] = await this.db
      .update(messages)
      .set({ parts: placed })
      .where(messageOwner(input))
      .returning({ id: messages.id });
    return updated === undefined ? undefined : placed;
  }
}

/**
 * `parts` with `items` placed. `rank` inserts each item in turn at its producer
 * position, so same-rank items keep their emission order; `append` inserts all
 * of them, in order, directly after the last context item and before the
 * user's text.
 */
export function placeAcceptedTurnItems<T>(
  parts: ReadonlyArray<T>,
  items: ReadonlyArray<ContextItemPart>,
  placement: AcceptedTurnPlacement,
): Array<T | ContextItemPart> {
  const placed: Array<T | ContextItemPart> = [...parts];
  if (placement === 'append') {
    placed.splice(placed.findLastIndex(isContextItemPart) + 1, 0, ...items);
    return placed;
  }
  for (const item of items) {
    const rank = CONTEXT_ITEM_PRODUCERS.findIndex(
      (known) => known === item.data.producer,
    );
    placed.splice(railInsertionIndex(placed, rank), 0, item);
  }
  return placed;
}
