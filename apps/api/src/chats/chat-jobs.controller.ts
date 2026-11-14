import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { ChatJobsService } from './chat-jobs.service';
import {
  ChangeChatJobDto,
  ChatJobResponse,
  ChatJobsResponse,
  toChatJobResponse,
} from './dto/chat-jobs.dto';

@ApiTags('chats')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/chats/:chatId/jobs')
export class ChatJobsController {
  constructor(
    @Inject(ChatJobsService)
    private readonly jobs: Pick<ChatJobsService, 'list' | 'stop'>,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listChatJobs' })
  @ApiParam({ name: 'chatId', format: 'uuid' })
  @ApiOkResponse({
    type: ChatJobsResponse,
    description: 'The jobs of the Chat, the live jobs first.',
  })
  @ApiBadRequestResponse({ description: 'Malformed chat id (not a UUID)' })
  @ApiNotFoundResponse({ description: 'Chat not found or not owned' })
  @ApiUnauthorizedResponse()
  async listChatJobs(
    @CurrentUser() userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
  ): Promise<ChatJobsResponse> {
    const items = await this.jobs.list(chatId, userId);

    return { items: items.map(toChatJobResponse) };
  }

  @Patch(':jobId')
  @ApiOperation({ operationId: 'stopChatJob' })
  @ApiParam({ name: 'chatId', format: 'uuid' })
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiOkResponse({
    type: ChatJobResponse,
    description:
      'The job after the request. A running job carries the recorded stop ' +
      'request; a job that the owner already stopped is returned as it is.',
  })
  @ApiBadRequestResponse({ description: 'Malformed id, or a state to set' })
  @ApiNotFoundResponse({ description: 'Chat or job not found, or not owned' })
  @ApiConflictResponse({
    description: 'The job settled in a state other than an owner stop',
  })
  @ApiUnauthorizedResponse()
  async stopChatJob(
    @CurrentUser() userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() _input: ChangeChatJobDto,
  ): Promise<ChatJobResponse> {
    return toChatJobResponse(await this.jobs.stop(chatId, jobId, userId));
  }
}
