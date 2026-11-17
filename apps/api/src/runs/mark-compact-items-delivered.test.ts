import { drizzle } from 'drizzle-orm/postgres-js';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { chatDeliveryRow } from '../testing/chat-delivery-rows';
import { markCompactItemsDelivered } from './mark-compact-items-delivered';

const userId = 'owner-1';
const runId = '11111111-1111-4111-8111-111111111111';
const first = chatDeliveryRow({ id: 'first', ownerUserId: userId });
const second = chatDeliveryRow({ id: 'second', ownerUserId: userId });

describe('markCompactItemsDelivered', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks every selected command delivered under the owning Run', async () => {
    const tx = drizzle.mock();

    const markDelivered = vi
      .spyOn(ChatDeliveriesRepository.prototype, 'markDelivered')
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await markCompactItemsDelivered(tx, [first, second], userId, runId);

    expect(markDelivered.mock.calls).toEqual([
      [first.id, userId, { runId }],
      [second.id, userId, { runId }],
    ]);
  });

  it('fails when a selected command is no longer pending', async () => {
    const tx = drizzle.mock();

    const markDelivered = vi
      .spyOn(ChatDeliveriesRepository.prototype, 'markDelivered')
      .mockResolvedValue(undefined);

    await expect(
      markCompactItemsDelivered(tx, [first, second], userId, runId),
    ).rejects.toThrow(`Compact item ${first.id} was not pending.`);

    expect(markDelivered).toHaveBeenCalledOnce();
    expect(markDelivered).toHaveBeenCalledWith(first.id, userId, { runId });
  });
});
