import type { UIMessage } from 'ai';
import { buildApiUrl } from '../../api/client';

type PrepareSendMessagesOptions = {
  messages: Array<Pick<UIMessage, 'id' | 'parts'>>;
};

export function buildChatMessagesUrl(chatId: string): string {
  return buildApiUrl(`/api/v1/chats/${chatId}/messages`);
}

export function prepareSendMessagesRequest({
  messages,
}: PrepareSendMessagesOptions): {
  body: { message: { id: string; parts: UIMessage['parts'] } };
} {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new Error('Cannot send an empty chat request');
  }

  return {
    body: {
      message: {
        id: lastMessage.id,
        parts: lastMessage.parts,
      },
    },
  };
}
