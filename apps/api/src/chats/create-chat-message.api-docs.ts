import { applyDecorators } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiExtraModels,
  getSchemaPath,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  CompactChatCommandResultResponse,
  RenameChatCommandResultResponse,
} from './commands/chat-command-result.dto';
import { ErrorResponse } from '../common/dto/error-response.dto';
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
  ApiExtraModels(
    CreateTextMessagePartDto,
    CreateFileMessagePartDto,
    RenameChatCommandResultResponse,
    CompactChatCommandResultResponse,
    ErrorResponse,
    ModelDomainErrorResponse,
  ),
  ApiOkResponse({
    description: 'AG-UI event stream (SSE) or chat command result',
    content: {
      'text/event-stream': {
        schema: { type: 'string' },
      },
      'application/json': {
        schema: {
          oneOf: [
            { $ref: getSchemaPath(RenameChatCommandResultResponse) },
            { $ref: getSchemaPath(CompactChatCommandResultResponse) },
          ],
          discriminator: {
            propertyName: 'command',
            mapping: {
              rename: getSchemaPath(RenameChatCommandResultResponse),
              compact: getSchemaPath(CompactChatCommandResultResponse),
            },
          },
        },
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
      'Malformed chat id or invalid message body, including unsupported ' +
      '`/compact` focus text or a file part naming media the sender does not own',
  }),
  ApiUnauthorizedResponse(),
  ApiResponse({
    status: 503,
    description: 'Model catalog is not configured correctly',
    type: ModelDomainErrorResponse,
  }),
  ApiResponse({
    status: 422,
    description:
      'Selected model is unavailable, effort is invalid, or bare `/rename` ' +
      'has no configured title-generation model',
    content: {
      'application/json': {
        schema: {
          anyOf: [
            { $ref: getSchemaPath(ModelDomainErrorResponse) },
            { $ref: getSchemaPath(ErrorResponse) },
          ],
        },
      },
    },
  }),
  ApiResponse({
    status: 502,
    description: 'Title generation failed',
  }),
  ApiNotFoundResponse({ description: 'Chat not found or not owned' }),
  ApiConflictResponse({
    description:
      'Message id already exists, a Run is already in flight, the Chat is ' +
      'archived, compaction has nothing to absorb, or bare `/rename` has nothing to name',
  }),
];

export function ApiCreateChatMessageDocs(): MethodDecorator {
  return applyDecorators(...createChatMessageDocs);
}
