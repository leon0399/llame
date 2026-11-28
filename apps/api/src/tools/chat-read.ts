import { ChatReadRepository } from '../chats/chat-read-repository';
import { parseChatLocator, type ChatLocator } from '../chats/chat-locator';
import { readChatMessage } from './chat-read-message';
import { readChatIndex } from './chat-read-index';
import { readChatCollection } from './chat-read-collection';
import { error, nativeError } from './chat-read-utils';
import { type ToolContext, type ToolResult } from './types';

const CLOSED_NOT_FOUND = 'The Chat resource was not found.';

export async function readChatResource(
  context: ToolContext,
  operation: 'read' | 'edit' | 'write',
  locator: string,
): Promise<ToolResult> {
  if (operation !== 'read')
    return error('unsupported_operation', 'Chat resources are read-only.');
  let parsed: ChatLocator;

  try {
    parsed = parseChatLocator(locator);
  } catch (error) {
    return nativeError(error, 'invalid_path');
  }

  if (!context.userId.trim()) return error('not_found', CLOSED_NOT_FOUND);

  return context.tenantDb.runAs(
    context.userId,
    (tx) =>
      readOwnedResource(new ChatReadRepository(tx), context.userId, parsed),
    { isolationLevel: 'repeatable read' },
  );
}

function readOwnedResource(
  repository: ChatReadRepository,
  owner: string,
  parsed: ChatLocator,
): Promise<ToolResult> {
  if (parsed.kind === 'collection')
    return readChatCollection(repository, owner, parsed.selector);

  if (parsed.kind === 'index')
    return readChatIndex({
      repository,
      owner,
      chatId: parsed.chatId,
      path: parsed.locator,
      selector: parsed.selector,
    });

  return readChatMessage({
    repository,
    owner,
    chatId: parsed.chatId,
    seq: parsed.messageSeq,
    path: parsed.locator,
    selector: parsed.selector,
  });
}
