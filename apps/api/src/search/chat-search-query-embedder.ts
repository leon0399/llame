import { Injectable, Logger } from '@nestjs/common';

import { InstanceConfigService } from '../instance-config/instance-config.service';
import { type EmbeddingBackend } from './core';
import { createOpenAIEmbeddingBackend } from './openai-embedding-backend';
import { resolveEmbeddingBackendConfig } from './search-embed.worker';

export type EmbedSurface = 'tool' | 'web';

const QUERY_EMBED_BUDGET_MS = {
  tool: 10_000,
  web: 1500,
} as const satisfies Record<EmbedSurface, number>;

export type EmbedFallbackReason =
  | 'no_model'
  | 'provider_error'
  | 'timeout'
  | 'empty'
  | 'dimension_mismatch';

export type QueryEmbedResult =
  | { readonly vector: ReadonlyArray<number>; readonly modelKey: string }
  | { readonly fallback: EmbedFallbackReason };

/** Narrow capability for consumers that only need query embedding. */
export type QueryEmbedderPort = Pick<
  ChatSearchQueryEmbedder,
  'embedQueryForSearch'
>;

/**
 * Process-wide query embedder for chat search (design D2–D4). Built once at
 * module init from `search.chats.embeddingModelId`; `undefined` when no model
 * is configured. Gated only by the corpus model selection, never by the
 * `search-embed` worker-profile group.
 */
@Injectable()
export class ChatSearchQueryEmbedder {
  private readonly logger = new Logger(ChatSearchQueryEmbedder.name);
  private readonly backend: EmbeddingBackend | undefined;
  private readonly declaredDimensions: number | undefined;
  private readonly modelKey: string | undefined;

  constructor(instanceConfig: InstanceConfigService) {
    const config = instanceConfig.config;
    const modelId = config.search.chats.embeddingModelId;
    if (modelId === null) {
      this.backend = undefined;
      return;
    }

    const model = config.embeddingModels.find((m) => m.id === modelId);
    if (!model) {
      this.backend = undefined;
      return;
    }

    this.modelKey = model.id;
    this.declaredDimensions = model.dimensions;
    this.backend = createOpenAIEmbeddingBackend(
      resolveEmbeddingBackendConfig(model, config.providers),
    );
  }

  async embedQueryForSearch(
    surface: EmbedSurface,
    query: string,
    abortSignal?: AbortSignal,
  ): Promise<QueryEmbedResult> {
    if (!this.backend) {
      return { fallback: 'no_model' };
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return { fallback: 'empty' };
    }

    try {
      const vector = await embedWithBudget(
        this.backend,
        trimmed,
        QUERY_EMBED_BUDGET_MS[surface],
        abortSignal,
      );

      if (vector.length !== this.declaredDimensions) {
        this.logger.warn(
          `Query embed dimension mismatch: got ${vector.length}, declared ${this.declaredDimensions} (surface=${surface}, model=${this.modelKey})`,
        );
        return { fallback: 'dimension_mismatch' };
      }

      return { vector, modelKey: this.modelKey! };
    } catch (error) {
      const isAbortLike =
        error instanceof DOMException &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');

      const reason: EmbedFallbackReason = isAbortLike
        ? 'timeout'
        : 'provider_error';

      this.logger.warn(
        `Query embed fallback: reason=${reason}, surface=${surface}, model=${this.modelKey}`,
      );
      return { fallback: reason };
    }
  }
}

function embedWithBudget(
  backend: EmbeddingBackend,
  text: string,
  budgetMs: number,
  externalSignal?: AbortSignal,
): Promise<ReadonlyArray<number>> {
  const signals: Array<AbortSignal> = [AbortSignal.timeout(budgetMs)];
  if (externalSignal) signals.push(externalSignal);
  const combined = AbortSignal.any(signals);

  return Promise.race([
    backend.embedQuery(text),
    new Promise<never>((_resolve, reject) => {
      // Always reject with a fixed AbortError, never `combined.reason` —
      // that reason's shape depends on whoever aborted the source signal.
      // AbortSignal.timeout() yields a DOMException, but a run's wall-clock
      // timeout aborts with the plain string RUN_TIMEOUT_ABORT_REASON
      // (run-execution.service.ts), which `embedQueryForSearch`'s catch
      // block below would otherwise fail to recognize as an abort and
      // misreport as `provider_error`.
      const onAbort = () =>
        reject(new DOMException('Query embed budget exceeded', 'AbortError'));
      if (combined.aborted) {
        onAbort();
        return;
      }
      combined.addEventListener('abort', onAbort, { once: true });
    }),
  ]);
}
