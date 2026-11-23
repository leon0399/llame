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
