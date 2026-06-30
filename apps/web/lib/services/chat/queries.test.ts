import { describe, expect, it } from 'vitest';
import { ChatGroupPeriod, groupChatsByTimePeriod } from './queries';

describe('groupChatsByTimePeriod', () => {
  it('groups chats by updatedAt from the api response shape', () => {
    const today = new Date();
    const oldCreatedAt = new Date(today);
    oldCreatedAt.setMonth(today.getMonth() - 2);

    const grouped = groupChatsByTimePeriod([
      {
        id: 'chat-1',
        title: 'Updated today',
        visibility: 'private',
        createdAt: oldCreatedAt.toISOString(),
        updatedAt: today.toISOString(),
      },
    ]);

    expect(grouped[ChatGroupPeriod.TODAY]?.map((chat) => chat.id)).toEqual([
      'chat-1',
    ]);
  });
});
