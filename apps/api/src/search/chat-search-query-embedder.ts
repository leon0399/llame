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
  | { readonly vector: ReadonlyArray<number> }
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

    const budgetMs = QUERY_EMBED_BUDGET_MS[surface];

    try {
      const vector = await withBudget(
        () => this.backend!.embedQuery(trimmed),
        budgetMs,
        abortSignal,
      );

      if (vector.length !== this.declaredDimensions) {
        this.logger.warn(
          `Query embed dimension mismatch: got ${vector.length}, declared ${this.declaredDimensions} (surface=${surface}, model=${this.modelKey})`,
        );
        return { fallback: 'dimension_mismatch' };
      }

      return { vector };
    } catch (error) {
      const isTimeout =
        error instanceof Error && error.message === 'query_embed_timeout';
      const isAbort = error instanceof Error && error.name === 'AbortError';

      const reason: EmbedFallbackReason =
        isTimeout || isAbort ? 'timeout' : 'provider_error';

      this.logger.warn(
        `Query embed fallback: reason=${reason}, surface=${surface}, model=${this.modelKey}`,
      );
      return { fallback: reason };
    }
  }
}

function withBudget<T>(
  fn: () => Promise<T>,
  budgetMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('query_embed_timeout'));
    }, budgetMs);

    const onExternalAbort = () => {
      controller.abort();
      clearTimeout(timer);
      reject(new DOMException('Query embed aborted', 'AbortError'));
    };

    if (externalSignal?.aborted) {
      clearTimeout(timer);
      reject(new DOMException('Query embed aborted', 'AbortError'));
      return;
    }

    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    fn().then(
      (result) => {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);
        if (controller.signal.aborted) {
          reject(new Error('query_embed_timeout'));
        } else {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
  });
}
