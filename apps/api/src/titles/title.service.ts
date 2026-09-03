import { Injectable, Logger } from '@nestjs/common';
import type { ModelMessage as AiModelMessage } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type ModelClient } from '../models/model-client';
import { ModelsService } from '../models/models.service';
import { ChatsRepository } from '../chats/chats-repository';
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
 * Same shape as CompactionService except the run awaits this work, which keeps
 * it inside the job's lifetime but guarantees nothing to the client: since the
 * queue split (#107) the stream ends at `run.completed`, before this runs, so a
 * generated title is observed by a later refetch rather than the first one.
 * The model call stays outside any transaction and never throws into the chat
 * turn. The chat loop only calls this when the chat was untitled (title NULL)
 * as of the turn's own read — no extra pre-check transaction here — and the
 * write persists through the atomic `title IS NULL` guard, so a title set
 * mid-generation (user rename or concurrent generation) always wins.
 */
@Injectable()
export class TitleService {
  private readonly logger = new Logger(TitleService.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly models: ModelsService,
  ) {}

  async maybeGenerateTitle(input: {
    chatId: string;
    userId: string;
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
    userText: string;
  }): Promise<void> {
    const userText = titlePromptInput(input.userText);
    if (userText.length === 0) {
      return;
    }

    const titleModel = this.models.resolveTitleModelConfig();
    if (!titleModel) {
      this.logger.error(
        'TITLE_GENERATION_MODEL_ID is missing or does not reference an available model; skipping title generation.',
      );
      return;
    }

    const client = this.models.createClient(titleModel.id);

    const title = sanitizeTitle(await this.requestTitle(client, userText));
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
    // SAFETY: without an annotation, `role: 'user'` widens to string in this
    // object literal; ModelMessage is a discriminated union keyed on the
    // literal role, so this states the intended literal explicitly.
    const messages = [
      { role: 'user', content: titleUserPrompt(userText) },
    ] as Array<AiModelMessage>;
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

/**
 * The narrow capability `RunExecutionService` needs (#268) — narrower than
 * the whole service. A test double implements exactly this one method,
 * never a partial `TitleService` cast.
 */
export type TitleCapability = Pick<TitleService, 'maybeGenerateTitle'>;
