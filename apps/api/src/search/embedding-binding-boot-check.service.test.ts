/**
 * EmbeddingBindingBootCheckService unit tests (chat-search-embeddings, task
 * 5.2). Stubs `InstanceConfigService`/`TenantDbService` — pure Nest DI test,
 * no database, mirroring `search-reindex.worker.test.ts`'s DB-free pattern
 * for a `runAsPublic`-backed boot check.
 */
import { Test, type TestingModule } from '@nestjs/testing';

import { TenantDbService } from '../db/tenant-db.service';
import type { EmbeddingModelBinding } from '../db/schema/search';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { EmbeddingBindingBootCheckService } from './embedding-binding-boot-check.service';

const openModules: TestingModule[] = [];

/** Minimal fake for `tx.select().from().where()` returning `rows`. */
function fakeTx(rows: EmbeddingModelBinding[]) {
  const query = {
    select: () => query,
    from: () => query,
    where: () => Promise.resolve(rows),
  };
  return query;
}

async function buildService(
  embeddingModels: typeof BUILT_IN_DEFAULTS.embeddingModels,
  bindingsByKey: Record<string, EmbeddingModelBinding[]>,
) {
  let calls = 0;
  const runAsPublic = async <T>(
    fn: (tx: ReturnType<typeof fakeTx>) => Promise<T>,
  ): Promise<T> => {
    calls += 1;
    // Each call's tx.where() resolves the SAME rows regardless of the actual
    // where-clause value (the fake has no query planner) — tests instead
    // drive per-key behavior by calling the service once per key, or by
    // asserting on total call count.
    const key = Object.keys(bindingsByKey)[calls - 1] ?? '';
    return fn(fakeTx(bindingsByKey[key] ?? []));
  };

  const module = await Test.createTestingModule({
    providers: [
      EmbeddingBindingBootCheckService,
      {
        provide: InstanceConfigService,
        useValue: { config: { ...BUILT_IN_DEFAULTS, embeddingModels } },
      },
      { provide: TenantDbService, useValue: { runAsPublic } },
    ],
  }).compile();
  openModules.push(module);
  return {
    service: module.get(EmbeddingBindingBootCheckService),
    callCount: () => calls,
  };
}

afterEach(async () => {
  await Promise.all(openModules.splice(0).map((m) => m.close()));
});

describe('EmbeddingBindingBootCheckService', () => {
  it('issues no ledger lookup when no embedding models are declared', async () => {
    const { service, callCount } = await buildService([], {});
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(callCount()).toBe(0);
  });

  it('passes when a declared model has no existing ledger row (first use)', async () => {
    const { service, callCount } = await buildService(
      [
        {
          id: 'e',
          provider: 'openai',
          providerModelId: 'text-embedding-3-small',
          dimensions: 1536,
          batchSize: 32,
          distanceMetric: 'cosine',
        },
      ],
      { e: [] },
    );
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(callCount()).toBe(1);
  });

  it('throws, aborting bootstrap, when a declared model differs from its recorded binding', async () => {
    const { service } = await buildService(
      [
        {
          id: 'e',
          provider: 'openai',
          providerModelId: 'text-embedding-3-large',
          dimensions: 1536,
          batchSize: 32,
          distanceMetric: 'cosine',
        },
      ],
      {
        e: [
          {
            modelKey: 'e',
            providerId: 'openai',
            providerModelId: 'text-embedding-3-small',
            revision: null,
            dimensions: 1536,
            distanceMetric: 'cosine',
            documentPrefix: null,
            queryPrefix: null,
            batchSize: 32,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    );
    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /embeddingModels\[e\]\.providerModelId/,
    );
  });
});
