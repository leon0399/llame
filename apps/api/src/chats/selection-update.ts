/**
 * The one write of an admission's selection, for every Run creator. A send,
 * `/compact`, Regenerate, a delivery start, queue promotion, and a job notice
 * all resolve through `resolveSendSettings` and then store its `nextSelection`
 * the same way: the write happens only when the resolution asks for one, and
 * it happens inside the transaction that holds the Chat row. The write is
 * owner-scoped, like every other Chat write.
 *
 * An owner request stores the selection it resolved; a derived creator stores
 * exactly one thing, the removal of a hold its admission dropped
 * (`model-roles`: "Other Run creators do not write the owner's choice").
 */

import type { ChatModelSelection } from '../models/model-selection';
import type { ResolvedSendSettings } from '../models/models.service';
import type { ChatsRepository } from './chats-repository';

/** Store the selection an admission resolved, when it resolved a write. */
export async function storeSelectionUpdate(
  chats: Pick<ChatsRepository, 'setModelSelection'>,
  chat: { readonly id: string; readonly ownerUserId: string },
  resolved: Pick<ResolvedSendSettings, 'nextSelection'>,
): Promise<void> {
  if (resolved.nextSelection === undefined) return;

  await chats.setModelSelection(
    chat.id,
    chat.ownerUserId,
    resolved.nextSelection,
  );
}

/** The hold a switch writes; `revertAt` is already the instant it ends. */
export type SwitchHoldInput = {
  /** `runs.selection_revision` of the Run that switches, or null for none. */
  readonly runSelectionRevision: number | null;
  /** `runs.selector` of the Run that switches. */
  readonly runSelector: string;
  readonly modelId: string;
  readonly effort: string | null;
  readonly revertAt: Date;
};

/**
 * Store the fallback hold of a model switch (design D4), and only when the
 * owner has not chosen since admission: the selection must still carry the
 * revision the Run read AND the selector the Run resolved, so a steer that
 * re-picked another selector or the same role wins and keeps no hold. The
 * revision does not move — a hold is the Run's record, not an owner write —
 * and `revertAt` is stored as the ISO instant admission later compares.
 *
 * Answers whether it wrote, so the caller can assert the gate instead of
 * re-reading the Chat.
 */
export async function writeSwitchHold(
  chats: Pick<ChatsRepository, 'setModelSelection'>,
  chat: {
    readonly id: string;
    readonly ownerUserId: string;
    readonly modelSelection: ChatModelSelection | null;
  },
  input: SwitchHoldInput,
): Promise<boolean> {
  const selection = chat.modelSelection;

  if (
    selection === null ||
    selection.revision !== input.runSelectionRevision ||
    selection.selector !== input.runSelector
  ) {
    return false;
  }

  await chats.setModelSelection(chat.id, chat.ownerUserId, {
    ...selection,
    hold: {
      selector: input.runSelector,
      modelId: input.modelId,
      effort: input.effort,
      revertAt: input.revertAt.toISOString(),
    },
  });

  return true;
}
