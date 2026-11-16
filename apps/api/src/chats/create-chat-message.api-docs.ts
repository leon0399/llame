import { applyDecorators } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ApiChatCommandResultResponse } from './commands/chat-command-response';
import { ModelDomainErrorResponse } from '../models/dto/models.dto';
import { CreateMessageDto } from './dto/chats.dto';
import { ChatDeliveryResponse } from './dto/chat-deliveries.dto';
import {
  CreateFileMessagePartDto,
  CreateTextMessagePartDto,
} from './dto/message-parts.dto';

const createChatMessageDocs: Array<MethodDecorator> = [
  ApiOperation({ operationId: 'createChatMessage' }),
  ApiTags('streaming'),
  ApiParam({ name: 'id', format: 'uuid' }),
  ApiBody({ type: CreateMessageDto }),
  ApiExtraModels(CreateTextMessagePartDto, CreateFileMessagePartDto),
  ApiChatCommandResultResponse(),
  ApiOkResponse({
    description: 'AI SDK v5 UI-message stream (SSE)',
    content: {
      'text/event-stream': {
        schema: { type: 'string' },
      },
    },
  }),
  ApiAcceptedResponse({
    description:
      'A send with `delivery` to a Chat with a live Run: the pending item ' +
      '(also the answer to a retry of the same message id, in any state). ' +
      'No Run and no message row were created.',
    type: ChatDeliveryResponse,
  }),
  ApiBadRequestResponse({
    description:
      'Malformed chat id or invalid message body, including a file part ' +
      'naming media the sender does not own',
  }),
  ApiUnauthorizedResponse(),
  ApiResponse({
    status: 503,
    description: 'Model catalog is not configured correctly',
    type: ModelDomainErrorResponse,
  }),
  ApiUnprocessableEntityResponse({
    description:
      'Selected model is not available, or the requested effort is not one of ' +
      "that model's declared levels",
    type: ModelDomainErrorResponse,
  }),
  ApiNotFoundResponse({ description: 'Chat not found or not owned' }),
  ApiConflictResponse({
    description:
      'Message id already exists, or another run is already in flight for ' +
      'this chat and the send names no `delivery` mode',
  }),
];

export function ApiCreateChatMessageDocs(): MethodDecorator {
  return applyDecorators(...createChatMessageDocs);
}
