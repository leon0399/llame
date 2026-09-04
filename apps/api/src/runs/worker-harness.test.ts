import { type InjectionToken } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/postgres-js';

import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { WorkerModule } from '../worker.module';
import { QUEUE } from '../queue/queue';
import { ModelsService } from '../models/models.service';
import { type Message, type Run } from '../db/schema';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedAndDispatchRun,
  seedRun,
} from './worker-harness';
import { RunDispatchService } from './run-dispatch.service';
import { RUNS_QUEUE } from './run-queues';
import { RunsRepository } from './runs-repository';
import { ModelContextSnapshotsRepository } from './model-context-snapshots.repository';
import { ScriptedModelsService } from './scripted-model-client';
import { type ModelContextSnapshot } from '../db/schema';
import { type Queue } from '../queue/queue';

const now = new Date('2026-09-03T00:00:00.000Z');
const snapshot: ModelContextSnapshot = {
  id: 'snapshot-1',
  ownerUserId: 'user-1',
  availabilityHash: 'availability',
  contentHash: 'content',
  promptHash: 'prompt',
  toolHash: 'tool',
  source: 'project_default',
  systemPrompt: 'Test prompt: default',
  toolAvailabilityManifest: { version: 1, entries: [] },
  toolDeclarations: [],
  createdAt: now,
};

const message: Message = {
  id: 'message-1',
  chatId: 'chat-1',
  seq: 1,
  role: 'user',
  senderUserId: 'user-1',
  parts: [{ type: 'text', text: 'hello' }],
  attachments: [],
  usage: null,
  inReplyTo: null,
  createdAt: now,
};

const run: Run = {
  id: 'run-1',
  chatId: 'chat-1',
  messageId: message.id,
  userId: 'user-1',
  modelId: 'model-1',
  modelContextSnapshotId: snapshot.id,
  status: 'queued',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  contextItems: null,
  createdAt: now,
  startedAt: null,
  finishedAt: null,
  effort: null,
};

/** The three `useValue` payloads bootWorkerHarness overrides, in override order. */
type OverrideValue =
  | ScriptedModelsService
  | { config: LlameConfig }
  | { assertReady: () => Promise<void> };

function installHarnessModule() {
  const init = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const end = vi.fn(async () => {});
  const tenantDb = { runAs: vi.fn() };
  const db = { $client: { end } };
  const queue = { enqueue: vi.fn() };
  const dispatch = { dispatch: vi.fn() };
  const configs: Array<LlameConfig> = [];
  const get = vi.fn((token: InjectionToken, opts?: { strict?: boolean }) => {
    if (opts?.strict !== false) {
      throw new Error(`expected strict: false for ${String(token)}`);
    }
    if (token === TenantDbService) return tenantDb;
    if (token === 'DB_DEV') return db;
    if (token === QUEUE) return queue;
    if (token === RunDispatchService) return dispatch;
    throw new Error(`unexpected token ${String(token)}`);
  });
  const moduleRef = { init, get, close };
  const overrideProvider = vi.fn((token: InjectionToken) => ({
    useValue: (value: OverrideValue) => {
      if (token === InstanceConfigService && 'config' in value) {
        configs.push(value.config);
      }
      return builder;
    },
  }));
  const builder = {
    overrideProvider,
    compile: vi.fn(() => Promise.resolve(moduleRef)),
  };
  // SAFETY: TestingModuleBuilder and TestingModule carry private state no
  // structural double can satisfy; this one implements exactly the
  // overrideProvider/useValue/compile chain bootWorkerHarness walks.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const asBuilder = builder as never;
  const createTestingModule = vi
    .spyOn(Test, 'createTestingModule')
    .mockReturnValue(asBuilder);
  return {
    init,
    close,
    end,
    tenantDb,
    db,
    queue,
    dispatch,
    configs,
    get,
    overrideProvider,
    createTestingModule,
  };
}

// CI exports TEST_DATABASE_URL and LLAME_TEST_SCHEMA_PREFIX for the integration
// suite, so each test must start from a known-empty environment rather than
// inheriting whatever the runner set.
function clearHarnessEnvironment() {
  delete process.env.TEST_DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.PGBOSS_SCHEMA;
  delete process.env.LLAME_TEST_SCHEMA_PREFIX;
}

beforeEach(clearHarnessEnvironment);

afterEach(() => {
  vi.restoreAllMocks();
  clearHarnessEnvironment();
});

describe('bootWorkerHarness', () => {
  it('copies TEST_DATABASE_URL onto POSTGRES_URL and stamps a unique pg-boss schema', async () => {
    process.env.TEST_DATABASE_URL = 'postgres://test-db';
    process.env.POSTGRES_URL = 'postgres://dev-db';
    const { configs, init } = installHarnessModule();

    const harness = await bootWorkerHarness();

    expect(process.env.POSTGRES_URL).toBe('postgres://test-db');
    expect(process.env.PGBOSS_SCHEMA).toMatch(/^llame_t_wh_[a-z0-9]{6}$/);
    expect(init).toHaveBeenCalledOnce();
    expect(configs[0]?.tools.allowed).toEqual([]);
    expect(configs[0]?.workers.all.runs).toBe(
      BUILT_IN_DEFAULTS.workers.all.runs,
    );
    expect(harness.models).toBeDefined();
  });

  it('honors harness overrides for tools, timers, and runs concurrency', async () => {
    const { configs } = installHarnessModule();

    await bootWorkerHarness({
      allowedTools: ['search_conversations'],
      timeoutSeconds: 9,
      heartbeatSeconds: 3,
      runsConcurrency: 4,
    });

    expect(configs[0]).toMatchObject({
      tools: { allowed: ['search_conversations'] },
      runs: { timeoutSeconds: 9, heartbeatSeconds: 3 },
      workers: { all: { runs: 4 } },
    });
  });

  it('uses LLAME_TEST_SCHEMA_PREFIX and leaves POSTGRES_URL alone when TEST_DATABASE_URL is absent', async () => {
    process.env.POSTGRES_URL = 'postgres://keep-me';
    process.env.LLAME_TEST_SCHEMA_PREFIX = 'shard_a';
    installHarnessModule();

    await bootWorkerHarness();

    expect(process.env.POSTGRES_URL).toBe('postgres://keep-me');
    expect(process.env.PGBOSS_SCHEMA).toMatch(/^shard_a_wh_[a-z0-9]{6}$/);
  });

  it('looks up Nest tokens without strict resolution and drains both the module and the sql client', async () => {
    const { get, close, end } = installHarnessModule();

    const harness = await bootWorkerHarness();
    await harness.close();

    expect(get.mock.calls).toEqual([
      [TenantDbService, { strict: false }],
      ['DB_DEV', { strict: false }],
      [QUEUE, { strict: false }],
      [RunDispatchService, { strict: false }],
    ]);
    expect(close).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
  });

  it('overrides ModelsService, InstanceConfigService, and the coverage gate', async () => {
    const { configs, createTestingModule, overrideProvider } =
      installHarnessModule();

    await bootWorkerHarness({ allowedTools: ['conversation_read'] });

    expect(createTestingModule).toHaveBeenCalledWith({
      imports: [WorkerModule],
    });
    expect(overrideProvider.mock.calls.map(([token]) => token)).toEqual([
      ModelsService,
      InstanceConfigService,
      CanonicalSearchCoverageService,
    ]);
    expect(configs[0]?.tools.allowed).toEqual(['conversation_read']);
  });
});

describe('createUser', () => {
  it('inserts a named users row tagged in the email', async () => {
    const queries: Array<{ sql: string; params: Array<unknown> }> = [];
    const db: Db = drizzle.mock({
      schema,
      logger: {
        logQuery(sql, params) {
          queries.push({ sql, params });
        },
      },
    });

    await createUser(db, 'alpha').catch(() => undefined);

    const insert = queries.find(({ sql }) => /insert into/i.test(sql));
    expect(insert?.sql.toLowerCase()).toContain('insert into');
    expect(insert?.sql.toLowerCase()).toContain('users');
    expect(insert?.params).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        ),
        'Harness User',
        expect.stringMatching(/^harness-alpha-.*@test\.com$/),
      ]),
    );
  });
});

/**
 * A TenantDbService whose transaction hands out Drizzle's own mock database,
 * plus its `runAs` spy so a caller can assert the identity the seed ran under.
 * Every repository seedRun touches is prototype-spied, so nothing reaches it.
 */
function fakeTenantDb() {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  const runAs = vi
    .spyOn(tenantDb, 'runAs')
    .mockImplementation(
      async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    );
  return { tenantDb, runAs };
}

/** A Queue whose enqueue is scripted; the harness never calls the other methods. */
function fakeQueue(enqueue: Queue['enqueue']): Queue {
  return {
    enqueue,
    ensureQueue: vi.fn(() => Promise.resolve()),
    consume: vi.fn(() => Promise.resolve('consumer-1')),
    schedule: vi.fn(() => Promise.resolve()),
    unschedule: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
  };
}

describe('seedRun', () => {
  function stubSeedRepos() {
    const createIfAbsent = vi
      .spyOn(ChatsRepository.prototype, 'createIfAbsent')
      .mockResolvedValue({
        id: 'chat-1',
        ownerUserId: 'user-1',
        title: 'Harness chat',
        visibility: 'private',
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        projectId: null,
        recencyDigestBaseline: null,
        recencyDigestTold: null,
        recencyDigestRebakedFrom: null,
      });
    const createMessage = vi
      .spyOn(MessagesRepository.prototype, 'create')
      .mockResolvedValue(message);
    const createOrReuse = vi
      .spyOn(ModelContextSnapshotsRepository.prototype, 'createOrReuse')
      .mockResolvedValue(snapshot);
    const createRun = vi
      .spyOn(RunsRepository.prototype, 'create')
      .mockImplementation((input) =>
        Promise.resolve({
          ...run,
          id: input.id ?? run.id,
          chatId: input.chatId,
          messageId: input.messageId,
          effort: input.effort ?? null,
          modelContextSnapshotId: input.modelContextSnapshotId,
        }),
      );
    return { createIfAbsent, createMessage, createOrReuse, createRun };
  }

  it('creates a titled chat, default hello part, and omits effort when unset', async () => {
    const { createIfAbsent, createMessage, createRun } = stubSeedRepos();
    const { tenantDb, runAs } = fakeTenantDb();

    const seeded = await seedRun({
      tenantDb,
      userId: 'user-1',
      modelId: 'model-1',
    });

    // Every seed write happens inside the owner's own tenant transaction.
    expect(runAs).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(createIfAbsent).toHaveBeenCalledWith({
      id: seeded.chatId,
      ownerUserId: 'user-1',
      title: 'Harness chat',
    });
    const parts = createMessage.mock.calls[0]?.[0]?.parts;
    expect(parts).toEqual([{ type: 'text', text: 'hello' }]);
    expect(createRun.mock.calls[0]?.[0]).not.toHaveProperty('effort');
    expect(seeded.userMessage.parts).toEqual(parts);
  });

  it('reuses an existing chat, forwards text, effort, and exact allowed tools', async () => {
    const { createIfAbsent, createMessage, createOrReuse, createRun } =
      stubSeedRepos();

    await seedRun({
      tenantDb: fakeTenantDb().tenantDb,
      userId: 'user-1',
      modelId: 'model-1',
      chatId: 'existing-chat',
      text: 'ping',
      effort: 'high',
      allowedTools: ['search_conversations'],
    });

    expect(createIfAbsent).not.toHaveBeenCalled();
    expect(createMessage.mock.calls[0]?.[0]).toMatchObject({
      chatId: 'existing-chat',
      parts: [{ type: 'text', text: 'ping' }],
    });
    expect(createRun.mock.calls[0]?.[0]).toMatchObject({ effort: 'high' });
    expect(createOrReuse).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        source: 'project_default',
      }),
    );
  });
});

describe('dispatchRun and seedAndDispatchRun', () => {
  it('enqueues the run job onto RUNS_QUEUE with optional enqueue options', async () => {
    const enqueue = vi.fn(() => Promise.resolve('job-1'));
    const userMessage = {
      id: message.id,
      seq: 1,
      parts: [{ type: 'text' as const, text: 'hello' }],
    };

    await expect(
      dispatchRun({
        queue: fakeQueue(enqueue),
        chatId: 'chat-1',
        runId: 'run-1',
        userId: 'user-1',
        modelId: 'model-1',
        userMessage,
        enqueueOptions: { retryLimit: 0 },
      }),
    ).resolves.toBe('job-1');

    expect(enqueue).toHaveBeenCalledWith(
      RUNS_QUEUE,
      {
        runId: 'run-1',
        chatId: 'chat-1',
        userId: 'user-1',
        modelId: 'model-1',
        userMessage,
      },
      { retryLimit: 0 },
    );
  });

  it('seeds then dispatches, forwarding effort and allowedTools only when set', async () => {
    vi.spyOn(ChatsRepository.prototype, 'createIfAbsent').mockResolvedValue({
      id: 'chat-1',
      ownerUserId: 'user-1',
      title: 'Harness chat',
      visibility: 'private',
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      projectId: null,
      recencyDigestBaseline: null,
      recencyDigestTold: null,
      recencyDigestRebakedFrom: null,
    });
    vi.spyOn(MessagesRepository.prototype, 'create').mockResolvedValue(message);
    vi.spyOn(
      ModelContextSnapshotsRepository.prototype,
      'createOrReuse',
    ).mockResolvedValue(snapshot);
    const createRun = vi
      .spyOn(RunsRepository.prototype, 'create')
      .mockResolvedValue(run);
    const enqueue = vi.fn(() => Promise.resolve('job-1'));
    const { tenantDb, runAs } = fakeTenantDb();
    const harness = { tenantDb, queue: fakeQueue(enqueue) };

    await seedAndDispatchRun(harness, {
      userId: 'user-1',
      modelId: 'model-1',
    });
    expect(runAs).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(createRun.mock.calls[0]?.[0]).not.toHaveProperty('effort');

    await seedAndDispatchRun(harness, {
      userId: 'user-1',
      modelId: 'model-1',
      effort: 'low',
      allowedTools: ['conversation_read'],
    });
    expect(createRun.mock.calls[1]?.[0]).toMatchObject({ effort: 'low' });
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
});
