import { Injectable, Logger } from '@nestjs/common';
import type { ModelMessage as AiModelMessage } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type ModelClient } from '../models/model-client';
import {
  ModelsService,
  type TitleModelCandidates,
} from '../models/models.service';
import { ChatsRepository } from '../chats/chats-repository';
import { queryLatestTitleMessages } from '../chats/title-message-query';
import { buildTitleExcerpt } from './title-excerpt';
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

  async regenerate(input: {
    chatId: string;
    userId: string;
  }): Promise<
    | { ok: true; title: string }
    | { ok: false; reason: 'not_configured' | 'empty' | 'failed' }
  > {
    const titleConfig = this.models.resolveTitleModelCandidates();

    if (!titleConfig) return { ok: false, reason: 'not_configured' };

    const newestFirst = await this.tenantDb.runAs(input.userId, (tx) =>
      queryLatestTitleMessages(tx, input.chatId, input.userId),
    );

    const renderedInput = buildTitleExcerpt(newestFirst);

    if (renderedInput.length === 0) return { ok: false, reason: 'empty' };

    try {
      const title = await this.requestTitleFromCandidates(
        titleConfig,
        input.chatId,
        renderedInput,
      );

      if (title === undefined) return { ok: false, reason: 'failed' };

      const updated = await this.tenantDb.runAs(input.userId, (tx) =>
        new ChatsRepository(tx).update(input.chatId, input.userId, { title }),
      );

      if (!updated) return { ok: false, reason: 'failed' };

      return { ok: true, title };
    } catch (error) {
      this.logger.warn(
        `Title generation failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );

      return { ok: false, reason: 'failed' };
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

    const titleConfig = this.models.resolveTitleModelCandidates();

    if (!titleConfig) {
      this.logger.error(
        'defaults.titleGenerationSelector is missing or does not reference an available model; skipping title generation.',
      );

      return;
    }

    const title = await this.requestTitleFromCandidates(
      titleConfig,
      input.chatId,
      userText,
    );

    if (title === undefined) return;

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

  private async requestTitleFromCandidates(
    config: TitleModelCandidates,
    chatId: string,
    renderedInput: string,
  ): Promise<string | undefined> {
    const firstModel = config.models[0];

    if (firstModel === undefined) return undefined;

    const paidGate =
      (firstModel.billing === 'subscription' ||
        firstModel.billing === 'free') &&
      !config.allowPaidFallback;

    for (const model of config.models) {
      if (paidGate && model.billing === 'usage') continue;

      try {
        const title = sanitizeTitle(
          await this.requestTitle(
            this.models.createClient(model.id),
            chatId,
            renderedInput,
          ),
        );

        if (title.length > 0) return title;
      } catch (error) {
        this.logger.warn(
          `Title generation failed: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
      }
    }

    return undefined;
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
    chatId: string,
    renderedInput: string,
  ): Promise<string> {
    // SAFETY: without an annotation, `role: 'user'` widens to string in this
    // object literal; ModelMessage is a discriminated union keyed on the
    // literal role, so this states the intended literal explicitly.
    const messages = [
      { role: 'user', content: titleUserPrompt(renderedInput) },
    ] as Array<AiModelMessage>;

    // One deadline for the whole attempt: the chat loop awaits titling before
    // the stream closes, so a stalled model call must not hold the turn open.
    const abortSignal = AbortSignal.timeout(TITLE_GENERATION_TIMEOUT_MS);

    if (client.generateObject) {
      try {
        // Typed end-to-end: the schema handle carries GeneratedTitle, and the
        // client validates the provider's structured result against it.
        const object = await client.generateObject({
          system: TITLE_SYSTEM_PROMPT,
          messages,
          chat: { id: chatId, lane: 'title' },
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
      chat: { id: chatId, lane: 'title' },
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
