import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { assertNotArchived } from '../../db/assert-not-archived';
import { TenantDbService } from '../../db/tenant-db.service';
import { ChatsRepository } from '../chats-repository';
import { TitleService } from '../../titles/title.service';
import type { ChatCommandResultResponse } from './chat-command-result.dto';
import type { ChatCommand } from './parse-chat-command';

@Injectable()
export class ChatCommandsService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantDbService,
    @Inject(TitleService)
    private readonly titles: Pick<TitleService, 'regenerate'>,
  ) {}

  async execute(input: {
    chatId: string;
    userId: string;
    command: ChatCommand;
    parts: ReadonlyArray<{ type: 'text' | 'file' }>;
  }): Promise<ChatCommandResultResponse | undefined> {
    const chat = await this.findChat(input.chatId, input.userId);

    if (!chat) return undefined;

    if (input.parts.some((part) => part.type === 'file')) {
      throw new BadRequestException('A command cannot include an attachment.');
    }

    if (input.command.argument.length > 0) {
      return this.rename(input.chatId, input.userId, input.command.argument);
    }

    return this.regenerate(input.chatId, input.userId);
  }

  private async findChat(chatId: string, userId: string): Promise<boolean> {
    return this.tenantDb.runAs(userId, async (tx) => {
      const current = await new ChatsRepository(tx).findById(chatId, userId);

      if (current) assertNotArchived(current);

      return current !== undefined;
    });
  }

  private async rename(
    chatId: string,
    userId: string,
    argument: string,
  ): Promise<ChatCommandResultResponse> {
    const title = argument;

    // Code points, as the PATCH validator counts them.
    if (Array.from(title).length > 200) {
      throw new BadRequestException(
        'A title must be between 1 and 200 characters.',
      );
    }

    const updated = await this.tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).update(chatId, userId, { title }),
    );

    if (!updated) throw new NotFoundException('Chat not found.');

    return {
      type: 'command',
      command: 'rename',
      title: updated.title ?? title,
    };
  }

  private async regenerate(
    chatId: string,
    userId: string,
  ): Promise<ChatCommandResultResponse> {
    const result = await this.titles.regenerate({ chatId, userId });

    if (result.ok) {
      return { type: 'command', command: 'rename', title: result.title };
    }

    if (result.reason === 'not_configured') {
      throw new UnprocessableEntityException(
        'Title generation is not configured.',
      );
    }

    if (result.reason === 'empty') {
      throw new ConflictException('Nothing to name.');
    }

    throw new BadGatewayException('Title generation failed.');
  }
}
