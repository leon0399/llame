import { Injectable, Logger } from '@nestjs/common';
import type { ModelMessage as AiModelMessage } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type ModelClient } from '../models/model-client';
import { ChatsRepository, DEFAULT_CHAT_TITLE } from './chats-repository';
import { sanitizeTitle, titlePromptInput, TITLE_SYSTEM_PROMPT } from './title';

/**
 * TitleService (#78) — names a chat from the user's message after a completed
 * turn, replacing the LangGraph title generator dropped in the #63 cutover.
 *
 * Same shape as CompactionService except the chat loop awaits this work before
 * ending the stream, so the first chat-list refresh can see the generated title.
 * The model call stays outside any transaction and never throws into the chat
 * turn. Skips the model call entirely unless the title is still the default, and
 * persists through the atomic still-default/manual-title guard so a user rename
 * mid-generation always wins.
 */
@Injectable()
export class TitleService {
  private readonly logger = new Logger(TitleService.name);

  constructor(private readonly tenantDb: TenantDbService) {}

  async maybeGenerateTitle(input: {
    chatId: string;
    userId: string;
    client: ModelClient;
    userText: string;
  }): Promise<void> {
    try {
      await this.generateIfDefault(input);
    } catch (error) {
      this.logger.error(
        `Title generation failed for chat ${input.chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async generateIfDefault(input: {
    chatId: string;
    userId: string;
    client: ModelClient;
    userText: string;
  }): Promise<void> {
    const userText = titlePromptInput(input.userText);
    if (userText.length === 0) {
      return;
    }

    // Cheap pre-check saves the model call for already-titled chats; the
    // repository guard below stays the authoritative (atomic) check.
    const stillDefault = await this.tenantDb.runAs(input.userId, async (tx) => {
      const chat = await new ChatsRepository(tx).findById(
        input.chatId,
        input.userId,
      );
      return chat?.title === DEFAULT_CHAT_TITLE;
    });
    if (!stillDefault) {
      return;
    }

    const result = input.client.streamText({
      system: TITLE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }] as AiModelMessage[],
    });
    const title = sanitizeTitle(await result.text);
    if (title.length === 0) {
      return;
    }

    await this.tenantDb.runAs(input.userId, (tx) =>
      new ChatsRepository(tx).setGeneratedTitle(
        input.chatId,
        input.userId,
        title,
      ),
    );
  }
}
