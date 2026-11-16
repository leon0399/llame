import type { ChatStreamResponse } from '../chat-stream-response';
import type { CreateMessageDto } from '../dto/chats.dto';
import type { ChatCommandsService } from './chat-commands.service';
import { parseChatCommand } from './parse-chat-command';
import { throwModelDomainError } from '../model-domain-error';

export async function respondToChatCommand(
  commands: ChatCommandsService,
  request: {
    userId: string;
    chatId: string;
    input: CreateMessageDto;
    response: ChatStreamResponse;
  },
): Promise<boolean> {
  const { userId, chatId, input, response } = request;
  const command = parseChatCommand(input.message.parts);

  if (!command) return false;

  let result;

  try {
    result = await commands.execute({
      chatId,
      userId,
      command,
      parts: input.message.parts,
      modelId: input.modelId,
      ...(input.effort !== undefined && { effort: input.effort }),
      ...(input.permissionMode !== undefined && {
        permissionMode: input.permissionMode,
      }),
    });
  } catch (error) {
    throwModelDomainError(error);
  }

  if (!result) return false;

  response.status(200).json(result);

  return true;
}
