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
import {
  embeddingModelBindings,
  searchChatDocuments,
} from '../db/schema/search';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  BUILT_IN_DEFAULTS,
  type EmbeddingModelCatalogEntry,
} from '../instance-config/llame-config';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { QUEUE } from '../queue/queue';
import {
  type EmbeddingBackend,
  type EmbeddingDocumentInput,
  type EmbeddingResult,
} from './core';
import { EmbeddingBackendError } from './openai-embedding-backend';
import {
  EMBED_MAX_BATCHES_PER_JOB,
  resolveEmbeddingBackendConfig,
  SearchEmbedWorker,
} from './search-embed.worker';
import { SEARCH_EMBED_QUEUE } from './reindex-queues';
import { SearchEmbedDispatchService } from './search-embed-dispatch.service';

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

type EmbedRow = {
  id: string;
  content: string;
  contentHash: string;
  priorEmbedInputVersion: number | null;
};

type FakeWhereQuery = {
  limit: () => Promise<ReadonlyArray<EmbedRow>>;
};

type FakeTable = typeof embeddingModelBindings | typeof searchChatDocuments;

type FakeSelectQuery = {
  from: (table: FakeTable) => FakeSelectQuery;
  where: () => FakeWhereQuery | Promise<ReadonlyArray<Record<string, never>>>;
};

type FakeInsertBuilder = {
  values: () => FakeInsertBuilder;
  onConflictDoNothing: () => Promise<void>;
};

type FakeEmbedTransaction = {
  select: () => FakeSelectQuery;
  execute: () => Promise<{ count: number }>;
  insert: () => FakeInsertBuilder;
};

type FakeTransactionResult =
  | ReadonlyArray<EmbedRow>
  | ReadonlyArray<Record<string, never>>
  | void;

function dataWorkerHarness(options: {
  outstanding: ReadonlyArray<EmbedRow>;
  nextOutstanding?: () => ReadonlyArray<EmbedRow>;
  updateCounts?: ReadonlyArray<number>;
  binding?: boolean;
  model?: EmbeddingModelCatalogEntry;
}) {
  const updateCounts = [...(options.updateCounts ?? [])];
  const nextOutstanding =
    options.nextOutstanding ?? (() => options.outstanding);
  const bindingRows: ReadonlyArray<Record<string, never>> = options.binding
    ? [{}]
    : [];
  let selectedTable: FakeTable | undefined;
  const whereResult = {
    limit: vi.fn(() => Promise.resolve(nextOutstanding())),
  };
  const selectBuilder: FakeSelectQuery = {
    from: vi.fn((table: FakeTable) => {
      selectedTable = table;
      return selectBuilder;
    }),
    where: vi.fn(() =>
      selectedTable === embeddingModelBindings
        ? Promise.resolve(bindingRows)
        : whereResult,
    ),
  };
  const conflictBuilder: FakeInsertBuilder = {
    values: vi.fn(() => conflictBuilder),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };
  const insertBuilder: FakeInsertBuilder = {
    values: vi.fn(() => conflictBuilder),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };
  const tx: FakeEmbedTransaction = {
    select: vi.fn(() => selectBuilder),
    execute: vi.fn(() => Promise.resolve({ count: updateCounts.shift() ?? 0 })),
    insert: vi.fn(() => insertBuilder),
  };
  const tenantDb = {
    runAs: vi.fn(
      (
        _ownerUserId: string,
        callback: (
          transaction: FakeEmbedTransaction,
        ) => Promise<FakeTransactionResult>,
      ) => callback(tx),
    ),
    runAsPublic: vi.fn(
      (
        callback: (
          transaction: FakeEmbedTransaction,
        ) => Promise<FakeTransactionResult>,
      ) => callback(tx),
    ),
  };
  const enqueueChatEmbed = vi.fn().mockResolvedValue(undefined);
  const model = options.model ?? MODEL;
  const config = instanceConfig(model.id);
  config.config.embeddingModels = [model];
  const moduleRefPromise = Test.createTestingModule({
    providers: [
      SearchEmbedWorker,
      { provide: QUEUE, useValue: {} },
      { provide: TenantDbService, useValue: tenantDb },
      { provide: SearchEmbedDispatchService, useValue: { enqueueChatEmbed } },
      {
        provide: WorkerProfileService,
        useValue: { concurrencyFor: () => 1 },
      },
      { provide: InstanceConfigService, useValue: config },
    ],
  })
    .compile()
    .then((moduleRef) => {
      openModules.push(moduleRef);
      return moduleRef;
    });
  return {
    enqueueChatEmbed,
    model,
    moduleRefPromise,
    tenantDb,
    tx,
  };
}

function fakeEmbeddingBackend(
  embedDocuments: (
    documents: ReadonlyArray<EmbeddingDocumentInput>,
  ) => Promise<Array<EmbeddingResult>>,
): EmbeddingBackend {
  return {
    embedDocuments,
    embedQuery: () => Promise.resolve([]),
  };
}

describe('SearchEmbedWorker.onApplicationBootstrap — gating', () => {
  afterEach(async () => {
    await Promise.all(
      openModules.splice(0).map((moduleRef) => moduleRef.close()),
    );
    vi.restoreAllMocks();
  });

  it('off-by-default: no ensureQueue, no consume, when no corpus model is configured', async () => {
    const concurrencyFor = vi.fn(() => 1);
    const { worker, ensureQueue, consume } = await buildWorker(
      null,
      concurrencyFor,
    );
    await worker.onApplicationBootstrap();
    expect(ensureQueue).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(concurrencyFor).not.toHaveBeenCalled();
  });

  it('consumes when a corpus model is configured AND the worker profile covers search-embed', async () => {
    const logSpy = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    const { worker, ensureQueue, consume } = await buildWorker(
      'embed-a',
      (group) => (group === 'search-embed' ? 4 : null),
    );
    await worker.onApplicationBootstrap();
    expect(ensureQueue).toHaveBeenCalledWith(SEARCH_EMBED_QUEUE);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls[0][0]).toBe(SEARCH_EMBED_QUEUE);
    expect(consume.mock.calls[0][2]).toMatchObject({ concurrency: 4 });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('model "embed-a"'),
    );
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

describe('resolveEmbeddingBackendConfig', () => {
  it('selects the matching provider and maps optional credentials, endpoint, and prefixes', () => {
    const model = {
      ...MODEL,
      documentPrefix: 'document: ',
      queryPrefix: 'query: ',
    };

    expect(
      resolveEmbeddingBackendConfig(model, [
        {
          id: 'other-provider',
          type: 'openai',
          key: 'wrong-key',
          baseUrl: 'https://wrong.example',
        },
        {
          id: 'provider-a',
          type: 'openai',
          key: 'right-key',
          baseUrl: 'https://right.example',
        },
      ]),
    ).toEqual({
      providerModelId: MODEL.providerModelId,
      dimensions: MODEL.dimensions,
      batchSize: MODEL.batchSize,
      credential: 'right-key',
      baseUrl: 'https://right.example',
      documentPrefix: 'document: ',
      queryPrefix: 'query: ',
    });
  });

  it('omits key, endpoint, and prefixes when the catalog leaves them unset', () => {
    const {
      documentPrefix: _documentPrefix,
      queryPrefix: _queryPrefix,
      ...model
    } = MODEL;

    expect(
      resolveEmbeddingBackendConfig(model, [
        { id: 'provider-a', type: 'openai', key: null, baseUrl: null },
      ]),
    ).toEqual({
      providerModelId: MODEL.providerModelId,
      dimensions: MODEL.dimensions,
      batchSize: MODEL.batchSize,
    });
  });

  it('rejects a model whose provider is not declared', () => {
    expect(() =>
      resolveEmbeddingBackendConfig(
        { ...MODEL, provider: 'missing-provider' },
        [{ id: 'provider-a', type: 'openai', key: 'k', baseUrl: null }],
      ),
    ).toThrow(/missing-provider/);
  });
});

describe('SearchEmbedWorker.embedChat', () => {
  const row = (id: string, content = `content-${id}`): EmbedRow => ({
    id,
    content,
    contentHash: `hash-${id}`,
    priorEmbedInputVersion: null,
  });

  function resultFor(document: EmbeddingDocumentInput): EmbeddingResult {
    return {
      documentId: document.documentId,
      contentHash: document.contentHash,
      embedding: [1, 2, 3],
    };
  }

  it('embeds outstanding rows with their verbatim content and persists each result', async () => {
    const harness = dataWorkerHarness({
      outstanding: [row('doc-1', '[user] Original Case')],
      updateCounts: [1],
    });
    const worker = await harness.moduleRefPromise.then((moduleRef) =>
      moduleRef.get(SearchEmbedWorker),
    );
    const embedDocuments = vi.fn(
      (documents: ReadonlyArray<EmbeddingDocumentInput>) =>
        Promise.resolve(documents.map(resultFor)),
    );

    await worker.embedChat(
      'chat-1',
      'owner-1',
      harness.model,
      fakeEmbeddingBackend(embedDocuments),
    );

    expect(embedDocuments).toHaveBeenCalledWith([
      {
        documentId: 'doc-1',
        contentHash: 'hash-doc-1',
        content: '[user] Original Case',
      },
    ]);
    expect(harness.tenantDb.runAs).toHaveBeenCalledWith(
      'owner-1',
      expect.any(Function),
    );
    expect(harness.tx.execute).toHaveBeenCalledTimes(1);
    expect(harness.tx.insert).toHaveBeenCalledTimes(1);
  });

  it('stops without calling the backend when no documents are outstanding', async () => {
    const harness = dataWorkerHarness({ outstanding: [] });
    const worker = await harness.moduleRefPromise.then((moduleRef) =>
      moduleRef.get(SearchEmbedWorker),
    );
    const embedDocuments = vi.fn(() => Promise.resolve([]));

    await worker.embedChat(
      'chat-1',
      'owner-1',
      harness.model,
      fakeEmbeddingBackend(embedDocuments),
    );

    expect(embedDocuments).not.toHaveBeenCalled();
    expect(harness.enqueueChatEmbed).not.toHaveBeenCalled();
  });

  it('re-enqueues after the bounded batch limit while work remains', async () => {
    const model = { ...MODEL, batchSize: 1 };
    let batch = 0;
    const harness = dataWorkerHarness({
      model,
      outstanding: [],
      nextOutstanding: () => {
        batch += 1;
        return [row(`doc-${batch}`)];
      },
      updateCounts: Array.from({ length: EMBED_MAX_BATCHES_PER_JOB }, () => 1),
    });
    const worker = await harness.moduleRefPromise.then((moduleRef) =>
      moduleRef.get(SearchEmbedWorker),
    );
    const embedDocuments = vi.fn(
      (documents: ReadonlyArray<EmbeddingDocumentInput>) =>
        Promise.resolve(documents.map(resultFor)),
    );

    await worker.embedChat(
      'chat-1',
      'owner-1',
      model,
      fakeEmbeddingBackend(embedDocuments),
    );

    expect(embedDocuments).toHaveBeenCalledTimes(EMBED_MAX_BATCHES_PER_JOB);
    expect(harness.enqueueChatEmbed).toHaveBeenCalledWith('chat-1', 'owner-1');
  });

  it('throws on a first-batch short response when no binding can recover it', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const harness = dataWorkerHarness({
      outstanding: [row('doc-1'), row('doc-2')],
      updateCounts: [],
    });
    const worker = await harness.moduleRefPromise.then((moduleRef) =>
      moduleRef.get(SearchEmbedWorker),
    );

    await expect(
      worker.embedChat(
        'chat-1',
        'owner-1',
        harness.model,
        fakeEmbeddingBackend(() => Promise.resolve([])),
      ),
    ).rejects.toThrow(/no backlog sweep can recover/);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('0/2'));
  });

  it('stops after a short response when an existing binding can recover it later', async () => {
    const harness = dataWorkerHarness({
      outstanding: [row('doc-1'), row('doc-2')],
      binding: true,
    });
    const worker = await harness.moduleRefPromise.then((moduleRef) =>
      moduleRef.get(SearchEmbedWorker),
    );

    await expect(
      worker.embedChat(
        'chat-1',
        'owner-1',
        harness.model,
        fakeEmbeddingBackend(() => Promise.resolve([])),
      ),
    ).resolves.toBeUndefined();
    expect(harness.enqueueChatEmbed).not.toHaveBeenCalled();
    expect(harness.tenantDb.runAsPublic).toHaveBeenCalledTimes(1);
  });

  it('tombstones every row for a terminal backend failure', async () => {
    const harness = dataWorkerHarness({
      outstanding: [row('doc-1'), row('doc-2')],
      updateCounts: [1, 1],
    });
    const worker = await harness.moduleRefPromise.then((moduleRef) =>
      moduleRef.get(SearchEmbedWorker),
    );
    const failure = new EmbeddingBackendError('dimension mismatch', true);

    await worker.embedChat(
      'chat-1',
      'owner-1',
      harness.model,
      fakeEmbeddingBackend(() => Promise.reject(failure)),
    );

    expect(harness.tx.execute).toHaveBeenCalledTimes(2);
    expect(harness.enqueueChatEmbed).not.toHaveBeenCalled();
  });

  it('rethrows transient backend failures without attempting persistence', async () => {
    const harness = dataWorkerHarness({ outstanding: [row('doc-1')] });
    const worker = await harness.moduleRefPromise.then((moduleRef) =>
      moduleRef.get(SearchEmbedWorker),
    );
    const failure = new EmbeddingBackendError('provider unavailable', false);

    await expect(
      worker.embedChat(
        'chat-1',
        'owner-1',
        harness.model,
        fakeEmbeddingBackend(() => Promise.reject(failure)),
      ),
    ).rejects.toBe(failure);
    expect(harness.tx.execute).not.toHaveBeenCalled();
  });

  it('does not throw when a full result set is returned but every row was superseded', async () => {
    const harness = dataWorkerHarness({
      outstanding: [row('doc-1')],
      updateCounts: [0],
    });
    const worker = await harness.moduleRefPromise.then((moduleRef) =>
      moduleRef.get(SearchEmbedWorker),
    );

    await expect(
      worker.embedChat(
        'chat-1',
        'owner-1',
        harness.model,
        fakeEmbeddingBackend((documents) =>
          Promise.resolve(documents.map(resultFor)),
        ),
      ),
    ).resolves.toBeUndefined();
    expect(harness.enqueueChatEmbed).not.toHaveBeenCalled();
  });
});
