import { Inject, Injectable, Logger } from '@nestjs/common';
import { tool, type ToolSet } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { toFlexibleSchema } from '../tools/schema-utils';
import { type ModelClient } from '../models/model-client';
import {
  ModelsService,
  type ModelClientFactory,
} from '../models/models.service';
import { CompactionsRepository } from '../chats/chats-repository';
import {
  buildCompactionRequest,
  buildCompactionReplacementHistory,
  normalizeCompactionSummary,
  requestFitsContextWindow,
  type CompactionPlan,
  type CompactionVariant,
} from './compaction';
import {
  type ModelMessage,
  type StoredMessage,
} from '../chats/context-builder';
import { buildTurnTelemetry } from '../chats/turn-telemetry';
import {
  type Compaction,
  type CompactionReplacementMessage,
  type Message,
  type ModelToolDeclaration,
} from '../db/schema';
import { isRecord } from '@workspace/runtime-safety';
import { SystemPromptReceiptsRepository } from '../runs/system-prompt-receipts.repository';
import { RunsRepository } from '../runs/runs-repository';
import { ContextIncompatibleError } from '../runs/snapshot-tool-execution';

function schemaOnlyTools(
  declarations: ReadonlyArray<ModelToolDeclaration>,
): ToolSet | null {
  const entries: Array<[string, ToolSet[string]]> = [];
  for (const declaration of declarations) {
    const inputSchema = toFlexibleSchema(declaration.inputSchema);
    if (inputSchema === null) {
      return null;
    }
    entries.push([
      declaration.id,
      tool({
        description: declaration.description,
        inputSchema,
      }),
    ]);
  }
  return Object.fromEntries(entries);
}

/**
 * Narrows a read history's `unknown[]` JSONB `parts` to `MessagePart[]`: each
 * part must be an object (the union's `Record<string, unknown>` fallback
 * arm), matching every other JSON-record boundary in this codebase. Malformed
 * (non-object) parts fail closed rather than silently coercing.
 */
export function toStoredMessages(
  history: ReadonlyArray<Message>,
): Array<StoredMessage> {
  return history.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (!isRecord(part)) {
        throw new Error(
          `Malformed message part in message ${message.id}: expected an object`,
        );
      }
      return part;
    }),
  }));
}

/** What one summarization call yielded: usable summary text, or nothing. */
type SummaryInference = {
  summary: string | null;
  usage: Awaited<ReturnType<ModelClient['streamText']>['usage']> | null;
  finishReason: Awaited<
    ReturnType<ModelClient['streamText']>['finishReason']
  > | null;
  latencyMs: number;
};

/** The summary of one pre-step publication; nothing is persisted by this type. */
export type CompactionSummary = {
  /** Absorbed-through sequence: the last row before the triggering message. */
  readonly uptoSeq: number;
  readonly summary: string;
  readonly replacementHistory: Array<CompactionReplacementMessage>;
  /** Telemetry of the summarization call, as `compactions.usage` stores it. */
  readonly usage: unknown;
};

/**
 * What the one summarization path is asked to summarize, as data (design D4).
 *
 * The threshold variant brings the attempt's own client and its pre-re-bake
 * render, so the summary request is a cache-aligned continuation of the very
 * prefix it summarizes. The window variant brings nothing: a prefix the target
 * model cannot hold cannot be summarized by that model, so its source — the
 * previous completed Run — is resolved here, where the receipt and the effort it
 * was persisted with are read.
 */
export type CompactionSummaryRequest =
  | {
      readonly variant: Extract<CompactionVariant, 'threshold'>;
      readonly chatId: string;
      readonly userId: string;
      readonly triggeringUserSeq: number;
      readonly plan: CompactionPlan;
      /** The attempt's own model, pre-re-bake prompt, declarations and effort. */
      readonly client: ModelClient;
      readonly system: string;
      readonly toolDeclarations: ReadonlyArray<ModelToolDeclaration>;
      readonly effort?: string;
      readonly abortSignal?: AbortSignal;
    }
  | {
      readonly variant: Extract<CompactionVariant, 'window'>;
      readonly chatId: string;
      readonly userId: string;
      readonly triggeringUserSeq: number;
      readonly plan: CompactionPlan;
      readonly reservedOutputTokens: number | null;
      readonly abortSignal?: AbortSignal;
    };

/**
 * CompactionService (#57) — one summarization path for the pre-step
 * checkpoint (#268 narrowed it to the single method below).
 *
 * It runs inside the attempt, before the Run's first model step, and only the
 * summary is this service's work: the caller owns the trigger, the publication
 * transaction, and every epoch write that must commit with the row. The model
 * call deliberately happens outside any transaction — holding one open across a
 * network round-trip would pin a connection for the stream's lifetime — so the
 * read of the checkpoint lineage precedes the call and the call precedes the
 * caller's write.
 */
@Injectable()
export class CompactionService {
  private readonly logger = new Logger(CompactionService.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    // No DI metadata of its own (#268 — the narrow capability type erases to
    // `Object` at runtime), so the token is explicit.
    @Inject(ModelsService)
    private readonly models: ModelClientFactory,
  ) {}

  /**
   * Summarize the absorbable prefix of one attempt's history, or return null
   * when the threshold variant produced nothing usable — the request already
   * fits, so a summary this attempt could not get costs a checkpoint, not the
   * turn. The window variant has no such latitude: without a summary the request
   * still does not fit, so every way it can come up empty fails
   * `context_incompatible`. An abort is always rethrown.
   */
  async summarizeCheckpoint(
    input: CompactionSummaryRequest,
  ): Promise<CompactionSummary | null> {
    input.abortSignal?.throwIfAborted();
    const previous = await this.tenantDb.runAs(input.userId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(
        input.chatId,
        input.userId,
        { beforeSeq: input.triggeringUserSeq },
      ),
    );
    return input.variant === 'window'
      ? this.summarizeWithSourceModel(input, previous)
      : this.summarizeWithAttemptModel(input, previous);
  }

  /**
   * The threshold variant: the attempt's own model, prompt, schema-only
   * declarations and effort, so the summary request reuses the provider's warm
   * prefix cache for exactly the history it compresses.
   */
  private async summarizeWithAttemptModel(
    input: Extract<CompactionSummaryRequest, { variant: 'threshold' }>,
    previous: Compaction | undefined,
  ): Promise<CompactionSummary | null> {
    const request = buildCompactionRequest({
      system: input.system,
      previous: compactionLineage(previous),
      absorb: input.plan.absorb,
      variant: input.variant,
    });
    let inference: SummaryInference;
    try {
      inference = await this.summarize({
        client: input.client,
        chatId: input.chatId,
        system: request.system,
        messages: request.messages,
        toolDeclarations: input.toolDeclarations,
        ...(input.effort !== undefined && { effort: input.effort }),
        abortSignal: input.abortSignal,
      });
    } catch (error) {
      if (input.abortSignal?.aborted) {
        throw error;
      }
      this.logger.warn(
        `Compaction summary failed for chat ${input.chatId}; proceeding without a checkpoint`,
      );
      return null;
    }
    if (inference.summary === null) {
      this.logger.warn(
        `Compaction summary came back empty for chat ${input.chatId}; proceeding without a checkpoint`,
      );
      return null;
    }
    return this.toCheckpoint({
      client: input.client,
      effort: input.effort,
      request: input,
      summary: inference.summary,
      inference,
      previous,
    });
  }

  /**
   * The window variant: the previous completed Run's model, with that Run's own
   * successful system prompt receipt and persisted effort and no tool
   * declarations — a prefix cannot be summarized by a model it does not fit. A
   * missing source, a source model that cannot execute, a source model that
   * cannot fit the prefix either, or a summary that comes back unusable all fail
   * the attempt as `context_incompatible`.
   */
  private async summarizeWithSourceModel(
    input: Extract<CompactionSummaryRequest, { variant: 'window' }>,
    previous: Compaction | undefined,
  ): Promise<CompactionSummary> {
    const source = await this.tenantDb.runAs(input.userId, async (tx) => {
      const found = await new RunsRepository(
        tx,
      ).findMostRecentCompletedByChatMessageSequence(
        input.chatId,
        input.userId,
        { beforeSeq: input.triggeringUserSeq },
      );
      const run = found?.run;
      return run === undefined || run.completedAttemptId == null
        ? undefined
        : {
            run,
            receipt: await new SystemPromptReceiptsRepository(tx).findByAttempt(
              run.id,
              run.completedAttemptId,
              input.userId,
            ),
          };
    });
    if (source?.receipt === undefined) {
      throw new ContextIncompatibleError(
        'The complete request exceeds the target model context window and no previous completed run can summarize its history.',
      );
    }
    // Read off the source run this method loaded, so passing the incoming
    // turn's effort by mistake is not expressible: it was validated against a
    // different model's declared levels.
    const effort = source.run.effort ?? undefined;

    let client: ModelClient;
    try {
      client = this.models.createClient(source.run.modelId);
    } catch (error) {
      throw new ContextIncompatibleError(
        `Source model '${source.run.modelId}' is unavailable to summarize the history this request carries.`,
        { cause: error },
      );
    }

    const request = buildCompactionRequest({
      system: source.receipt.systemPrompt,
      previous: compactionLineage(previous),
      absorb: input.plan.absorb,
      variant: input.variant,
    });
    if (
      !requestFitsContextWindow({
        system: request.system,
        messages: request.messages,
        toolDeclarations: [],
        contextWindowTokens: client.contextWindowTokens,
        reservedOutputTokens: input.reservedOutputTokens,
      })
    ) {
      throw new ContextIncompatibleError(
        'The complete request exceeds the target model context window and its source model cannot fit that history either.',
      );
    }

    let inference: SummaryInference;
    try {
      inference = await this.summarize({
        client,
        chatId: input.chatId,
        system: request.system,
        messages: request.messages,
        toolDeclarations: [],
        ...(effort !== undefined && { effort }),
        abortSignal: input.abortSignal,
      });
    } catch (error) {
      if (input.abortSignal?.aborted) {
        throw error;
      }
      throw new ContextIncompatibleError(
        'Source-model summarization of the history this request carries failed.',
        { cause: error },
      );
    }
    if (inference.summary === null) {
      throw new ContextIncompatibleError(
        'Source-model summarization returned no valid text summary.',
      );
    }
    return this.toCheckpoint({
      client,
      effort,
      request: input,
      summary: inference.summary,
      inference,
      previous,
    });
  }

  /** The publishable row contents of one accepted inference. */
  private toCheckpoint(input: {
    client: ModelClient;
    effort: string | undefined;
    request: CompactionSummaryRequest;
    summary: string;
    inference: SummaryInference;
    previous: Compaction | undefined;
  }): CompactionSummary {
    return {
      uptoSeq: input.request.plan.uptoSeq,
      summary: input.summary,
      replacementHistory: buildCompactionReplacementHistory({
        summary: input.summary,
        previous: input.previous?.replacementHistory,
        absorb: input.request.plan.absorb,
      }),
      usage: buildTurnTelemetry({
        usage: input.inference.usage,
        finishReason: input.inference.finishReason,
        status: 'completed',
        modelId: input.client.model,
        // Matches what `summarize` actually sent.
        ...(input.effort !== undefined && { effort: input.effort }),
        latencyMs: input.inference.latencyMs,
        price: input.client.pricing,
        billing: input.client.billing,
      }),
    };
  }

  private async summarize(input: {
    client: ModelClient;
    /**
     * The Chat being compacted — the attempt's own chat. Compaction shares the
     * turn's `main` lane (provider-api-selection D5) because its request prefix
     * IS the conversation's prefix; a separate identity would forfeit exactly
     * the cache reuse the shared prefix exists for.
     */
    chatId: string;
    system: string;
    messages: Array<ModelMessage>;
    toolDeclarations: ReadonlyArray<ModelToolDeclaration>;
    /**
     * The effort of the run whose prompt prefix this request reuses. Sent as
     * persisted, never re-resolved: the whole point of reproducing that run's
     * system prompt and message prefix is to land on the provider's still-warm
     * prompt cache, and a differing effort invalidates exactly that.
     */
    effort?: string;
    abortSignal?: AbortSignal;
  }): Promise<SummaryInference> {
    const tools = schemaOnlyTools(input.toolDeclarations);
    const startedAt = Date.now();
    if (tools === null) {
      return {
        summary: null,
        usage: null,
        finishReason: null,
        latencyMs: Date.now() - startedAt,
      };
    }
    const result = input.client.streamText({
      system: input.system,
      messages: input.messages,
      chat: { id: input.chatId, lane: 'main' },
      abortSignal: input.abortSignal,
      ...(input.effort !== undefined && { effort: input.effort }),
      ...(input.toolDeclarations.length > 0 && { tools }),
      toolChoice: 'none',
    });
    const [text, toolCalls, usage, finishReason] = await Promise.all([
      Promise.resolve(result.text),
      Promise.resolve(result.toolCalls).catch(() => []),
      Promise.resolve(result.usage).catch(() => null),
      Promise.resolve(result.finishReason).catch(() => null),
    ]);
    // A provider that returns a tool call despite `toolChoice: 'none'` has no
    // executor here, so its output is rejected rather than persisted: a
    // checkpoint may be summary text and nothing else.
    const providerReturnedToolCall =
      (Array.isArray(toolCalls) && toolCalls.length > 0) ||
      finishReason === 'tool-calls';
    return {
      summary: providerReturnedToolCall
        ? null
        : normalizeCompactionSummary(text),
      usage,
      finishReason,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** The stored checkpoint lineage a new row supersedes; absent on a first one. */
function compactionLineage(previous: Compaction | undefined):
  | {
      summary: string;
      uptoSeq: number;
      replacementHistory: Array<CompactionReplacementMessage>;
    }
  | undefined {
  return (
    previous && {
      summary: previous.summary,
      uptoSeq: previous.uptoSeq,
      replacementHistory: previous.replacementHistory,
    }
  );
}

/**
 * The narrow capability `RunExecutionService` needs (#268) — narrower than
 * the whole service. A test double implements exactly this one method, never a
 * partial `CompactionService` cast.
 */
export type CompactionCapability = Pick<
  CompactionService,
  'summarizeCheckpoint'
>;
