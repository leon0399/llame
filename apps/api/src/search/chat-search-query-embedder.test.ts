import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  BUILT_IN_DEFAULTS,
  type EmbeddingModelCatalogEntry,
  type LlameConfig,
} from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { ChatSearchQueryEmbedder } from './chat-search-query-embedder';
import * as openaiBackend from './openai-embedding-backend';

function configWith(
  overrides: Partial<LlameConfig> = {},
): InstanceConfigService {
  return { config: { ...BUILT_IN_DEFAULTS, ...overrides } };
}

const TEST_MODEL: EmbeddingModelCatalogEntry = {
  id: 'test-embed',
  provider: 'test-provider',
  providerModelId: 'text-embedding-test',
  dimensions: 4,
  batchSize: 64,
  distanceMetric: 'cosine',
};

describe('ChatSearchQueryEmbedder', () => {
  it('returns no_model when no embedding model is configured', async () => {
    const embedder = new ChatSearchQueryEmbedder(configWith());
    const result = await embedder.embedQueryForSearch('web', 'test query');
    expect(result).toEqual({ fallback: 'no_model' });
  });

  it('does not construct a backend when no model is configured', () => {
    const spy = vi.spyOn(openaiBackend, 'createOpenAIEmbeddingBackend');
    new ChatSearchQueryEmbedder(configWith());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('constructs a backend when a model is selected, regardless of worker profile', () => {
    const spy = vi
      .spyOn(openaiBackend, 'createOpenAIEmbeddingBackend')
      .mockReturnValue({
        embedQuery: vi.fn(),
        embedDocuments: vi.fn(),
      });

    new ChatSearchQueryEmbedder(
      configWith({
        embeddingModels: [TEST_MODEL],
        providers: [
          { id: 'test-provider', type: 'openai', key: 'k', baseUrl: null },
        ],
        search: { chats: { embeddingModelId: 'test-embed' } },
      }),
    );

    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('returns empty fallback for blank query on a configured instance', async () => {
    vi.spyOn(openaiBackend, 'createOpenAIEmbeddingBackend').mockReturnValue({
      embedQuery: vi.fn(),
      embedDocuments: vi.fn(),
    });
    const embedder = new ChatSearchQueryEmbedder(
      configWith({
        embeddingModels: [TEST_MODEL],
        providers: [
          { id: 'test-provider', type: 'openai', key: 'k', baseUrl: null },
        ],
        search: { chats: { embeddingModelId: 'test-embed' } },
      }),
    );
    const result = await embedder.embedQueryForSearch('tool', '   ');
    expect(result).toEqual({ fallback: 'empty' });
  });

  describe('with a configured backend', () => {
    const mockEmbedQuery = vi.fn<(text: string) => Promise<Array<number>>>();

    function createEmbedder(): ChatSearchQueryEmbedder {
      vi.spyOn(openaiBackend, 'createOpenAIEmbeddingBackend').mockReturnValue({
        embedQuery: mockEmbedQuery,
        embedDocuments: vi.fn(),
      });

      return new ChatSearchQueryEmbedder(
        configWith({
          embeddingModels: [TEST_MODEL],
          providers: [
            { id: 'test-provider', type: 'openai', key: 'k', baseUrl: null },
          ],
          search: { chats: { embeddingModelId: 'test-embed' } },
        }),
      );
    }

    it('returns the vector on success', async () => {
      mockEmbedQuery.mockResolvedValueOnce([1, 2, 3, 4]);
      const embedder = createEmbedder();
      const result = await embedder.embedQueryForSearch('tool', 'hello');
      expect(result).toEqual({ vector: [1, 2, 3, 4] });
    });

    it('receives the trimmed raw query, not normalized', async () => {
      mockEmbedQuery.mockResolvedValueOnce([1, 2, 3, 4]);
      const embedder = createEmbedder();
      await embedder.embedQueryForSearch('tool', '  Hello World  ');
      expect(mockEmbedQuery).toHaveBeenCalledWith('Hello World');
    });

    it('returns dimension_mismatch when vector length differs from declared', async () => {
      mockEmbedQuery.mockResolvedValueOnce([1, 2, 3]);
      const embedder = createEmbedder();
      const result = await embedder.embedQueryForSearch('web', 'test');
      expect(result).toEqual({ fallback: 'dimension_mismatch' });
    });

    it('returns provider_error on backend failure', async () => {
      mockEmbedQuery.mockRejectedValueOnce(new Error('provider down'));
      const embedder = createEmbedder();
      const result = await embedder.embedQueryForSearch('tool', 'test');
      expect(result).toEqual({ fallback: 'provider_error' });
    });

    it('returns timeout when the budget is exceeded', async () => {
      mockEmbedQuery.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve([1, 2, 3, 4]), 5000);
          }),
      );
      const embedder = createEmbedder();
      const result = await embedder.embedQueryForSearch('web', 'test');
      expect(result).toEqual({ fallback: 'timeout' });
    }, 10_000);

    it('returns timeout when the abort signal fires', async () => {
      const controller = new AbortController();
      mockEmbedQuery.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve([1, 2, 3, 4]), 5000);
          }),
      );
      const embedder = createEmbedder();
      const promise = embedder.embedQueryForSearch(
        'tool',
        'test',
        controller.signal,
      );
      controller.abort();
      const result = await promise;
      expect(result).toEqual({ fallback: 'timeout' });
    });

    it('never throws from embedQueryForSearch', async () => {
      mockEmbedQuery.mockRejectedValueOnce(new Error('kaboom'));
      const embedder = createEmbedder();
      await expect(
        embedder.embedQueryForSearch('tool', 'test'),
      ).resolves.toBeDefined();
    });

    it('log line contains reason, surface, and model key but not the query', async () => {
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      mockEmbedQuery.mockRejectedValueOnce(new Error('secret failure'));
      const embedder = createEmbedder();
      await embedder.embedQueryForSearch('tool', 'sensitive query text');

      expect(warnSpy).toHaveBeenCalled();
      const logMessage = String(warnSpy.mock.calls[0]?.[0] ?? '');
      expect(logMessage).toContain('provider_error');
      expect(logMessage).toContain('tool');
      expect(logMessage).toContain('test-embed');
      expect(logMessage).not.toContain('sensitive query text');

      warnSpy.mockRestore();
    });
  });
});
