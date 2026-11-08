import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { ChatGitStateService } from './chat-git-state.service';
import {
  GIT_STATE_RESPONSE_MODELS,
  gitStateResponseSchema,
  type GitStateResponse,
} from './dto/git-state.dto';

@ApiTags('chats')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/chats')
export class ChatGitStateController {
  constructor(
    @Inject(ChatGitStateService)
    private readonly gitState: Pick<ChatGitStateService, 'read'>,
  ) {}

  /** Live, uncached git state of the Chat's Workspace root, for its owner. */
  @Get(':id/git-state')
  @ApiOperation({ operationId: 'getChatGitState' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiExtraModels(...GIT_STATE_RESPONSE_MODELS)
  @ApiOkResponse({ schema: gitStateResponseSchema() })
  @ApiBadRequestResponse({ description: 'Malformed chat id (not a UUID)' })
  @ApiNotFoundResponse({ description: 'Chat not found or not owned' })
  @ApiUnauthorizedResponse()
  getChatGitState(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GitStateResponse> {
    return this.gitState.read(id, userId);
  }
}
