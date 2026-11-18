import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import type { ChatDelivery } from '../db/schema';
import type { Db } from '../db/tenant-db.service';

export async function markCompactItemsDelivered(
  tx: Db,
  items: ReadonlyArray<ChatDelivery>,
  userId: string,
  runId: string,
): Promise<void> {
  const deliveries = new ChatDeliveriesRepository(tx);

  for (const item of items) {
    if (!(await deliveries.markDelivered(item.id, userId, { runId }))) {
      throw new Error(`Compact item ${item.id} was not pending.`);
    }
  }
}
