import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ChatCommandResultResponse } from './chat-command-result.dto';

export function ApiChatCommandResultResponse(): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    ApiExtraModels(ChatCommandResultResponse)(target, propertyKey, descriptor);
    ApiResponse({
      status: 200,
      description: 'Command result (JSON)',
      content: {
        'application/json': {
          schema: { $ref: getSchemaPath(ChatCommandResultResponse) },
        },
      },
    })(target, propertyKey, descriptor);
  };
}
