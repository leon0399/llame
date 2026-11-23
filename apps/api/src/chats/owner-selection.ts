/**
 * The one write of an owner admission's selection. A send, `/compact` and
 * Regenerate all resolve through `resolveSendSettings` and then store its
 * `nextSelection` the same way: the write happens only when the request
 * changed the selection, and it happens inside the transaction that holds the
 * Chat row. The write is owner-scoped, like every other Chat write.
 */

import type { ResolvedSendSettings } from '../models/models.service';
import type { ChatsRepository } from './chats-repository';

/** Store the selection an owner request resolved, when it resolved a write. */
export async function storeOwnerSelection(
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
