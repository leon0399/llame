import type { ChatStreamResponse } from '../chat-stream-response';
import type { CreateMessageDto } from '../dto/chats.dto';
import type { ChatCommandsService } from './chat-commands.service';
import { parseChatCommand } from './parse-chat-command';

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

  const result = await commands.execute({
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

  if (!result) return false;

  response.status(200).json(result);

  return true;
}
