import { describe, expect, it } from 'vitest';

import {
  buildChatMessagesUrl,
  buildChatStreamUrl,
  prepareReconnectToStreamRequest,
} from './transport';

describe('chat transport urls', () => {
  it('builds the send and resume endpoints for a chat', () => {
    expect(buildChatMessagesUrl('chat-1')).toMatch(
      /\/api\/v1\/chats\/chat-1\/messages$/,
    );
    expect(buildChatStreamUrl('chat-1')).toMatch(
      /\/api\/v1\/chats\/chat-1\/stream$/,
    );
  });

  it('points reconnectToStream at the resume endpoint for the chat id (#49)', () => {
    const request = prepareReconnectToStreamRequest({ id: 'chat-42' });
    expect(request.api).toMatch(/\/api\/v1\/chats\/chat-42\/stream$/);
  });
});
