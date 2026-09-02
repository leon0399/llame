/**
 * EmbeddingBindingBootCheckService unit tests (chat-search-embeddings, task
 * 5.2). Stubs `InstanceConfigService`/`TenantDbService` — pure Nest DI test,
 * no database, mirroring `search-reindex.worker.test.ts`'s DB-free pattern
 * for a `runAsPublic`-backed boot check.
 */
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { TenantDbService } from '../db/tenant-db.service';
import type { EmbeddingModelBinding } from '../db/schema/search';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { EmbeddingBindingBootCheckService } from './embedding-binding-boot-check.service';

const openModules: Array<TestingModule> = [];

/** Shared row shape covering both query results this fake stands in for —
 *  a full ledger row (`findEmbeddingBinding`) or a bare `modelKey` projection
 *  (`listUndeclaredBindingKeys`). */
type FakeRow = Partial<EmbeddingModelBinding> & { modelKey: string };

/**
 * Minimal fake for both query shapes this service issues: `tx.select().
 * from().where()` (per-key lookup, `findEmbeddingBinding`) and `tx.select().
 * from()` alone (the undeclared-keys listing, `listUndeclaredBindingKeys`,
 * task 7.3 — no `.where()`, it wants every ledger row). `from()`'s result is
 * therefore both directly awaitable AND chainable with `.where()`.
 */
function fakeTx(rows: Array<FakeRow>) {
  const query = {
    select: () => query,
    // A real Promise (not a hand-rolled thenable — oxlint's
    // unicorn/no-thenable forbids that) with `.where()` attached, so it
    // satisfies both call shapes: `await tx.select().from()` directly
    // (`listUndeclaredBindingKeys`) and `await tx.select().from().where()`
    // (`findEmbeddingBinding`).
    from: () =>
      Object.assign(Promise.resolve(rows), {
        where: () => Promise.resolve(rows),
      }),
  };
  return query;
}

async function buildService(
  embeddingModels: typeof BUILT_IN_DEFAULTS.embeddingModels,
  bindingsByKey: Record<string, Array<EmbeddingModelBinding>>,
  undeclaredKeys: Array<string> = [],
) {
  let calls = 0;
  const declaredKeyCount = embeddingModels.length;
  const runAsPublic = async <T>(
    fn: (tx: ReturnType<typeof fakeTx>) => Promise<T>,
  ): Promise<T> => {
    calls += 1;
    // The first `declaredKeyCount` calls are per-key lookups (in `models`
    // order); the one call after that (task 7.3) lists every ledger row —
    // fed `undeclaredKeys` directly since `listUndeclaredBindingKeys` does
    // its own declared-set filtering, so the fake need not replicate it.
    if (calls > declaredKeyCount) {
      return fn(fakeTx(undeclaredKeys.map((modelKey) => ({ modelKey }))));
    }
    const key = Object.keys(bindingsByKey)[calls - 1] ?? '';
    return fn(fakeTx(bindingsByKey[key] ?? []));
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      EmbeddingBindingBootCheckService,
      {
        provide: InstanceConfigService,
        useValue: { config: { ...BUILT_IN_DEFAULTS, embeddingModels } },
      },
      { provide: TenantDbService, useValue: { runAsPublic } },
    ],
  }).compile();
  openModules.push(moduleRef);
  return {
    service: moduleRef.get(EmbeddingBindingBootCheckService),
    callCount: () => calls,
  };
}

afterEach(async () => {
  await Promise.all(openModules.splice(0).map((m) => m.close()));
});

describe('EmbeddingBindingBootCheckService', () => {
  it('issues no per-key consistency lookup when no embedding models are declared', async () => {
    const { service, callCount } = await buildService([], {});
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    // Exactly one call: the undeclared-key sweep. Consistency has no meaning
    // with nothing declared, so no per-key lookup happens.
    expect(callCount()).toBe(1);
  });

  // Regression (review, PR #536): this used to return before the sweep, so
  // emptying `embeddingModels[]` — the most likely way to strand vectors —
  // silenced the only message telling the operator to run `search:prune`.
  it('still warns about stranded vectors when every model is undeclared', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { service } = await buildService([], {}, ['embed-model-a']);

    await service.onApplicationBootstrap();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('embed-model-a');
    expect(warn.mock.calls[0]?.[0]).toContain('search:prune');
    warn.mockRestore();
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
    // 1 per-key lookup for 'e' + 1 undeclared-keys listing (task 7.3).
    expect(callCount()).toBe(2);
  });

  it('warns, non-fatally, for a ledger key with no matching declared model (task 7.3)', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { service } = await buildService(
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
      ['retired-model'],
    );
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"retired-model"'),
    );
    warnSpy.mockRestore();
  });

  it('issues no undeclared-keys warning when every ledger key is still declared', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { service } = await buildService(
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
      [],
    );
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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
