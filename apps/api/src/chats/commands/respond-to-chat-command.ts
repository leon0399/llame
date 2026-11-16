import type { ChatStreamResponse } from '../chat-stream-response';
import type { CreateMessageDto } from '../dto/chats.dto';
import { toChatDeliveryResponse } from '../dto/chat-deliveries.dto';
import type {
  ChatCommandExecutionResult,
  ChatCommandsService,
} from './chat-commands.service';
import type { ChatCommand } from './parse-chat-command';
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

  let result: ChatCommandExecutionResult | undefined;

  try {
    result = await executeCommand(commands, { chatId, userId, input, command });
  } catch (error) {
    throwModelDomainError(error);
  }

  if (!result) return false;

  if (result.type === 'delivery') {
    response.status(202).json(toChatDeliveryResponse(result.delivery));
  } else {
    response.status(200).json(result);
  }

  return true;
}

async function executeCommand(
  commands: ChatCommandsService,
  input: {
    chatId: string;
    userId: string;
    input: CreateMessageDto;
    command: ChatCommand;
  },
): Promise<ChatCommandExecutionResult | undefined> {
  const { input: request, command } = input;

  return commands.execute({
    chatId: input.chatId,
    userId: input.userId,
    command,
    parts: request.message.parts,
    messageId: request.message.id,
    ...(command.name === 'compact' &&
      request.delivery !== undefined && { delivery: request.delivery }),
    ...(command.name === 'compact' && {
      rawText: request.message.parts.find((part) => part.type === 'text')?.text,
    }),
    modelId: request.modelId,
    ...(request.effort !== undefined && { effort: request.effort }),
    ...(request.permissionMode !== undefined && {
      permissionMode: request.permissionMode,
    }),
  });
}
