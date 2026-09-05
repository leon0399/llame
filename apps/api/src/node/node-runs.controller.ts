import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { type Request } from 'express';
import { assertHttpBinding, NODE_PRINCIPAL_HEADER, NODE_VERSION_HEADER, NodeProtocolError } from '@workspace/node-protocol';
import { CurrentUser } from '../auth/auth-context';
import { ChatLoopService } from '../chats/chat-loop.service';
import { mapModelDomainError } from '../chats/model-domain-error';
import { AcceptedNodeRunResponse, CreateNodeRunDto } from './node-runs.dto';

@ApiExcludeController()
@Controller('api/v1/runs')
export class NodeRunsController {
  constructor(@Inject(ChatLoopService) private readonly loop: Pick<ChatLoopService, 'acceptMessage'>) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@CurrentUser() userId: string, @Body() input: CreateNodeRunDto,
    @Req() request: Pick<Request, 'headers'>,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }): Promise<AcceptedNodeRunResponse> {
    response.setHeader('Cache-Control', 'no-store');
    try {
      assertHttpBinding(userId, request.headers[NODE_PRINCIPAL_HEADER], request.headers[NODE_VERSION_HEADER], 'execution.runs.create');
      const accepted = await this.loop.acceptMessage({
        userId, chatId: input.chatId, modelId: input.modelId, message: input.message,
        ...(input.effort === undefined ? {} : { effort: input.effort }),
      });
      response.setHeader('Location', `/api/v1/runs/${accepted.runId}`);
      return accepted;
    } catch (error) {
      if (error instanceof NodeProtocolError) throw new BadRequestException({ code: error.code, message: error.message });
      return mapModelDomainError(error);
    }
  }
}
