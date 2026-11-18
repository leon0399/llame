import { isCompactCommand } from '../chats/commands/parse-chat-command';

import type { ChatDelivery } from '../db/schema';
import type { DeliveryCause, DeliveryInput } from './segment-delivery-close';

export function deliveryCause(
  input: DeliveryInput,
  items: ReadonlyArray<ChatDelivery>,
): DeliveryCause {
  const hasOwnerSteer = items.some(
    (item) =>
      item.producer === 'owner' &&
      item.mode === 'steer' &&
      !isCompactCommand(item),
  );

  const hasInterrupt = items.some(
    (item) => item.producer === 'owner' && item.mode === 'interrupt',
  );

  if (input.stoppedCalls !== undefined || hasInterrupt) return 'interrupt';

  if (hasOwnerSteer) return 'steer';

  if (items.some((item) => !isCompactCommand(item))) return 'notice';

  return 'compaction';
}
