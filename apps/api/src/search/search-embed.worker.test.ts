/**
 * SearchEmbedWorker's boot-gating (chat-search-embeddings, design D5/D14,
 * task 6.3) — pure unit test, no database, no provider call. Verifies BOTH
 * states the task calls for:
 *   - configured (a corpus model is declared) + this process's worker
 *     profile covers 'search-embed' -> the consumer registers;
 *   - configured but NOT covered by this process's profile -> a loud warning
 *     is logged and nothing registers (design D14's "fourth group is a
 *     fourth way to run zero consumers" mitigation).
 * Plus the off-by-default state (no corpus model declared at all): nothing
 * touches the queue, matching the spec's "off by default" contract at the
 * worker's own boundary (worker.module.integration.test.ts proves the same
 * thing one level up, through the whole WorkerModule graph).
 *
 * The worker runs through Nest's public bootstrap lifecycle in a
 * TestingModule, same pattern as search-reindex.worker.test.ts.
 */
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { TenantDbService } from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  BUILT_IN_DEFAULTS,
  type EmbeddingModelCatalogEntry,
} from '../instance-config/llame-config';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { QUEUE } from '../queue/queue';
import { SEARCH_EMBED_QUEUE } from './reindex-queues';
import { SearchEmbedDispatchService } from './search-embed-dispatch.service';
import { SearchEmbedWorker } from './search-embed.worker';

const openModules: Array<TestingModule> = [];

const MODEL: EmbeddingModelCatalogEntry = {
  id: 'embed-a',
  provider: 'provider-a',
  providerModelId: 'text-embedding-3-small',
  dimensions: 3,
  batchSize: 32,
  distanceMetric: 'cosine',
};

function instanceConfig(embeddingModelId: string | null): InstanceConfigReader {
  return {
    config: {
      ...BUILT_IN_DEFAULTS,
      providers: [
        { id: 'provider-a', type: 'openai', key: 'k', baseUrl: null },
      ],
      embeddingModels: [MODEL],
      search: {
        chats: { ...BUILT_IN_DEFAULTS.search.chats, embeddingModelId },
      },
    },
  };
}

async function buildWorker(
  embeddingModelId: string | null,
  concurrencyFor: (group: string) => number | null,
) {
  const ensureQueue = vi.fn().mockResolvedValue(undefined);
  const consume = vi.fn().mockResolvedValue('consumer-id');
  const moduleRef = await Test.createTestingModule({
    providers: [
      SearchEmbedWorker,
      { provide: QUEUE, useValue: { ensureQueue, consume } },
      { provide: TenantDbService, useValue: {} },
      { provide: SearchEmbedDispatchService, useValue: {} },
      { provide: WorkerProfileService, useValue: { concurrencyFor } },
      {
        provide: InstanceConfigService,
        useValue: instanceConfig(embeddingModelId),
      },
    ],
  }).compile();
  openModules.push(moduleRef);
  const worker = moduleRef.get(SearchEmbedWorker);
  return { worker, ensureQueue, consume };
}

describe('SearchEmbedWorker.onApplicationBootstrap — gating', () => {
  afterEach(async () => {
    await Promise.all(
      openModules.splice(0).map((moduleRef) => moduleRef.close()),
    );
    vi.restoreAllMocks();
  });

  it('off-by-default: no ensureQueue, no consume, when no corpus model is configured', async () => {
    const { worker, ensureQueue, consume } = await buildWorker(null, () => 1);
    await worker.onApplicationBootstrap();
    expect(ensureQueue).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it('consumes when a corpus model is configured AND the worker profile covers search-embed', async () => {
    const { worker, ensureQueue, consume } = await buildWorker(
      'embed-a',
      (group) => (group === 'search-embed' ? 4 : null),
    );
    await worker.onApplicationBootstrap();
    expect(ensureQueue).toHaveBeenCalledWith(SEARCH_EMBED_QUEUE);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls[0][0]).toBe(SEARCH_EMBED_QUEUE);
    expect(consume.mock.calls[0][2]).toMatchObject({ concurrency: 4 });
  });

  it('warns and registers nothing when configured but this profile does not cover search-embed', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { worker, ensureQueue, consume } = await buildWorker(
      'embed-a',
      () => null,
    );
    await worker.onApplicationBootstrap();
    expect(ensureQueue).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('search-embed');
    expect(warnSpy.mock.calls[0][0]).toContain('embed-a');
  });

  it('logs an internal error and registers nothing if the configured model id is somehow undeclared (defensive; unreachable via normal boot)', async () => {
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const { worker, ensureQueue, consume } = await buildWorker(
      'nonexistent-model',
      () => 1,
    );
    await worker.onApplicationBootstrap();
    expect(ensureQueue).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('nonexistent-model');
  });
});
