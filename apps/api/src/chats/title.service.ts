import { Injectable, Logger } from '@nestjs/common';
import type { ModelMessage as AiModelMessage } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type ModelClient } from '../models/model-client';
import { ChatsRepository } from './chats-repository';
import {
  sanitizeTitle,
  titlePromptInput,
  titleUserPrompt,
  TITLE_GENERATION_TIMEOUT_MS,
  TITLE_OBJECT_SCHEMA,
  TITLE_SCHEMA_DESCRIPTION,
  TITLE_SCHEMA_NAME,
  TITLE_SYSTEM_PROMPT,
} from './title';

/**
 * TitleService (#78) — names a chat from the user's message after a completed
 * turn, replacing the LangGraph title generator dropped in the #63 cutover.
 *
 * Same shape as CompactionService except the chat loop awaits this work before
 * ending the stream, so the first chat-list refresh can see the generated title.
 * The model call stays outside any transaction and never throws into the chat
 * turn. The chat loop only calls this when the chat was untitled (title NULL)
 * as of the turn's own read — no extra pre-check transaction here — and the
 * write persists through the atomic `title IS NULL` guard, so a title set
 * mid-generation (user rename or concurrent generation) always wins.
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
      await this.generate(input);
    } catch (error) {
      this.logger.error(
        `Title generation failed for chat ${input.chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async generate(input: {
    chatId: string;
    userId: string;
    client: ModelClient;
    userText: string;
  }): Promise<void> {
    const userText = titlePromptInput(input.userText);
    if (userText.length === 0) {
      return;
    }

    const title = sanitizeTitle(
      await this.requestTitle(input.client, userText),
    );
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

  /**
   * Prefer schema-constrained generation (the pre-cutover generator forced a
   * generate_title tool call — structured output can't ramble), falling back to
   * plain text + sanitation: arbitrary OpenAI-compatible endpoints may lack
   * tool/JSON-mode support, and titling retries on every completed turn while
   * the chat is untitled, so a hard-failing structured call must not leave the
   * chat untitled forever.
   */
  private async requestTitle(
    client: ModelClient,
    userText: string,
  ): Promise<string> {
    const messages = [
      { role: 'user', content: titleUserPrompt(userText) },
    ] as AiModelMessage[];
    // One deadline for the whole attempt: the chat loop awaits titling before
    // the stream closes, so a stalled model call must not hold the turn open.
    const abortSignal = AbortSignal.timeout(TITLE_GENERATION_TIMEOUT_MS);

    if (client.generateObject) {
      try {
        // Typed end-to-end: the schema handle carries GeneratedTitle, and the
        // client validated the forced tool call's input against it.
        const object = await client.generateObject({
          system: TITLE_SYSTEM_PROMPT,
          messages,
          abortSignal,
          schema: TITLE_OBJECT_SCHEMA,
          schemaName: TITLE_SCHEMA_NAME,
          schemaDescription: TITLE_SCHEMA_DESCRIPTION,
        });

        return object.title;
      } catch (error) {
        this.logger.warn(
          `Structured title generation failed; falling back to text: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const result = client.streamText({
      system: TITLE_SYSTEM_PROMPT,
      messages,
      abortSignal,
    });

    return result.text;
  }
}
