import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository } from './chats-repository';
import { TODOS_MAX_PER_CHAT, TodosRepository } from './todos-repository';
import {
  CreateTodoDto,
  TodoResponse,
  UpdateTodoDto,
  toTodoResponse,
} from './dto/todos.dto';

/**
 * User-facing management of a chat's todos — the task panel. Chat-scoped and
 * RLS-guarded (`todos_owner` = chat ownership). The user's todos are
 * `source='user'`; the agent's `write_todos` plan (`source='agent'`) is shown
 * read-through by GET but never mutated here, and never wipes the user's list.
 */
@ApiTags('chats')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/chats/:id/todos')
export class ChatTodosController {
  constructor(private readonly tenantDb: TenantDbService) {}

  @Get()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [TodoResponse] })
  @ApiUnauthorizedResponse()
  async list(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) chatId: string,
  ): Promise<TodoResponse[]> {
    const rows = await this.tenantDb.runAs(userId, (tx) =>
      new TodosRepository(tx).list(chatId),
    );
    return rows.map(toTodoResponse);
  }

  @Post()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: TodoResponse })
  @ApiNotFoundResponse({ description: 'Chat not found or not owned' })
  @ApiConflictResponse({ description: 'At the per-chat todo cap' })
  @ApiUnauthorizedResponse()
  async create(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) chatId: string,
    @Body() dto: CreateTodoDto,
  ): Promise<TodoResponse> {
    const created = await this.tenantDb.runAs(userId, async (tx) => {
      // Explicit ownership pre-check → a clean 404 for an absent/cross-tenant
      // chat, rather than surfacing an RLS/FK error from the insert.
      const chat = await new ChatsRepository(tx).findById(chatId, userId);
      if (!chat) {
        throw new NotFoundException(`Chat ${chatId} not found`);
      }
      const repo = new TodosRepository(tx);
      if ((await repo.countUserTodos(chatId)) >= TODOS_MAX_PER_CHAT) {
        throw new ConflictException(
          `Todo limit reached (${TODOS_MAX_PER_CHAT}).`,
        );
      }
      return repo.add(chatId, dto.content.trim());
    });
    return toTodoResponse(created);
  }

  @Patch(':todoId')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'todoId', format: 'uuid' })
  @ApiOkResponse({ type: TodoResponse })
  @ApiNotFoundResponse({ description: 'Todo not found in this chat' })
  @ApiUnauthorizedResponse()
  async update(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) chatId: string,
    @Param('todoId', ParseUUIDPipe) todoId: string,
    @Body() dto: UpdateTodoDto,
  ): Promise<TodoResponse> {
    const updated = await this.tenantDb.runAs(userId, (tx) =>
      new TodosRepository(tx).updateStatus(chatId, todoId, dto.status),
    );
    if (!updated) {
      throw new NotFoundException(`Todo ${todoId} not found`);
    }
    return toTodoResponse(updated);
  }

  @Delete(':todoId')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'todoId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Todo not found in this chat' })
  @ApiUnauthorizedResponse()
  async remove(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) chatId: string,
    @Param('todoId', ParseUUIDPipe) todoId: string,
  ): Promise<void> {
    const deleted = await this.tenantDb.runAs(userId, (tx) =>
      new TodosRepository(tx).deleteById(chatId, todoId),
    );
    if (!deleted) {
      throw new NotFoundException(`Todo ${todoId} not found`);
    }
  }
}
