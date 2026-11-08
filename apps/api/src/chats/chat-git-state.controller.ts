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
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/auth-context';
import { ChatGitStateService } from './chat-git-state.service';
import {
  GIT_STATE_RESPONSE_MODELS,
  GIT_STATE_RESPONSE_SCHEMA,
  type GitStateResponse,
} from './dto/git-state.dto';

const GIT_STATE_RATE_LIMIT_PER_MINUTE = 30;

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
  // Every call runs git on the executor, unlike a cached read: a per-IP ceiling
  // of its own, roomy enough for open plus focus refetches.
  @Throttle({
    default: { ttl: 60_000, limit: GIT_STATE_RATE_LIMIT_PER_MINUTE },
  })
  @Get(':id/git-state')
  @ApiOperation({ operationId: 'getChatGitState' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiExtraModels(...GIT_STATE_RESPONSE_MODELS)
  @ApiOkResponse({ schema: GIT_STATE_RESPONSE_SCHEMA })
  @ApiBadRequestResponse({ description: 'Malformed chat id (not a UUID)' })
  @ApiNotFoundResponse({ description: 'Chat not found or not owned' })
  @ApiUnauthorizedResponse()
  @ApiTooManyRequestsResponse({ description: 'Too many git state reads' })
  getChatGitState(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GitStateResponse> {
    return this.gitState.read(id, userId);
  }
}
