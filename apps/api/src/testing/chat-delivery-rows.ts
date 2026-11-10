import { type ChatDelivery } from '../db/schema';

/** A pending `queue` item row of a Chat, as the repository returns it. */
export function chatDeliveryRow(
  overrides: Partial<ChatDelivery> = {},
): ChatDelivery {
  const at = new Date('2026-11-08T00:00:00.000Z');

  return {
    id: '44444444-4444-4444-8444-444444444444',
    chatId: '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10',
    ownerUserId: 'user-id',
    producer: 'owner',
    senderRef: null,
    mode: 'queue',
    parts: [{ type: 'text', text: 'then summarize it' }],
    settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
    state: 'pending',
    position: 1,
    deliveredMessageId: null,
    runId: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}
