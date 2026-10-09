import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { TenantDbService } from '../db/tenant-db.service';
import { SearchReindexDispatchService } from './search-reindex-dispatch.service';
import {
  CanonicalSearchActivationService,
  CanonicalSearchCoverageService,
  COVERAGE_REPAIR_DEADLINE_MS,
  COVERAGE_REPAIR_POLL_MS,
} from './canonical-search-activation.service';

const COVERAGE_ROW = {
  chunker_version: 4,
  chat_count: 12,
  ready_chat_count: 12,
  stale_chat_count: 0,
  document_count: 57,
  complete_document_count: 57,
};

type CoverageRow = typeof COVERAGE_ROW;
type StaleRow = { chat_id: string; owner_user_id: string };
type FakeRow = CoverageRow | StaleRow | { bypass: boolean };

function config(searchAllowed: boolean) {
  return {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      allowed: searchAllowed ? ['search_conversations'] : [],
    },
  };
}

/** Rows after the provisioning check, in query order: coverage, then (when
 *  incomplete) the stale-chat list and each polled coverage. The last entry
 *  repeats once the list is exhausted. */
async function buildService(
  searchAllowed: boolean,
  provisioned: boolean,
  queries: Array<Array<FakeRow>> = [[COVERAGE_ROW]],
  enqueueChatReindex = vi.fn(() => Promise.resolve()),
) {
  const results: Array<Array<FakeRow>> = [
    provisioned ? [{ bypass: true }] : [{ bypass: false }],
    ...queries,
  ];
  const execute = vi.fn(
    (): Promise<Iterable<FakeRow>> =>
      Promise.resolve(
        (results.length > 1 ? results.shift() : results[0]) ?? [],
      ),
  );
  const runAsPublic = vi.fn(
    (
      fn: (tx: {
        execute: () => Promise<Iterable<FakeRow>>;
      }) => Promise<Iterable<FakeRow>>,
    ) => fn({ execute }),
  );
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      CanonicalSearchActivationService,
      CanonicalSearchCoverageService,
      {
        provide: InstanceConfigService,
        useValue: { config: config(searchAllowed) },
      },
      { provide: TenantDbService, useValue: { runAsPublic } },
      {
        provide: SearchReindexDispatchService,
        useValue: { enqueueChatReindexStrict: enqueueChatReindex },
      },
    ],
  }).compile();
  return {
    moduleRef,
    runAsPublic,
    enqueueChatReindex,
    service: moduleRef.get(CanonicalSearchActivationService),
    coverage: moduleRef.get(CanonicalSearchCoverageService),
  };
}

const STALE_ROW: StaleRow = { chat_id: 'chat-1', owner_user_id: 'owner-1' };
const ONE_STALE = {
  ...COVERAGE_ROW,
  ready_chat_count: 11,
  stale_chat_count: 1,
};

describe('CanonicalSearchActivationService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips readiness when the HTTP process cannot bind search_conversations', async () => {
    const { moduleRef, runAsPublic, service } = await buildService(
      false,
      false,
    );

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(runAsPublic).not.toHaveBeenCalled();
    await moduleRef.close();
  });

  it('admits allowlisted search without a separate opt-in after current projection is fully ready', async () => {
    const { enqueueChatReindex, moduleRef, runAsPublic, service } =
      await buildService(true, true);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(runAsPublic).toHaveBeenCalledTimes(2);
    expect(enqueueChatReindex).not.toHaveBeenCalled();
    await moduleRef.close();
  });

  it('shares one readiness check across HTTP admission and a co-located runs consumer', async () => {
    const { coverage, moduleRef, runAsPublic, service } = await buildService(
      true,
      true,
    );

    await service.onApplicationBootstrap();
    await coverage.assertReady();

    expect(runAsPublic).toHaveBeenCalledTimes(2);
    await moduleRef.close();
  });

  it('enqueues stale chats for the reindex workers and admits once they complete coverage', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const { enqueueChatReindex, moduleRef, service } = await buildService(
      true,
      true,
      [[ONE_STALE], [STALE_ROW], [ONE_STALE], [COVERAGE_ROW]],
    );

    const bootstrap = service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(2 * COVERAGE_REPAIR_POLL_MS);

    await expect(bootstrap).resolves.toBeUndefined();
    expect(enqueueChatReindex).toHaveBeenCalledExactlyOnceWith(
      'chat-1',
      'owner-1',
    );
    // The operator diagnostic carries the count only, never an identifier.
    expect(log).toHaveBeenLastCalledWith(
      'Enqueued 1 stale chat reindex job(s); waiting for projection coverage',
    );
    log.mockRestore();
    await moduleRef.close();
  });

  it('fails startup immediately when a stale chat cannot be enqueued', async () => {
    const { moduleRef, service } = await buildService(
      true,
      true,
      [[ONE_STALE], [STALE_ROW]],
      vi.fn(() => Promise.reject(new Error('queue unavailable'))),
    );

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      'canonical conversation search cannot start: queue unavailable',
    );
    await moduleRef.close();
  });

  it.each([
    ['stale chats', { ready_chat_count: 11, stale_chat_count: 1 }],
    ['offsetless or legacy documents', { complete_document_count: 56 }],
  ])(
    'refuses activation for %s still incomplete at the deadline',
    async (_name, fields) => {
      vi.useFakeTimers();
      const incomplete = { ...COVERAGE_ROW, ...fields };
      const { moduleRef, service } = await buildService(true, true, [
        [incomplete],
        [STALE_ROW],
        [incomplete],
      ]);

      let settled = false;
      const outcome = service.onApplicationBootstrap().then(
        () => 'admitted',
        (error: unknown) => String(error),
      );
      void outcome.finally(() => (settled = true));
      await vi.advanceTimersByTimeAsync(
        COVERAGE_REPAIR_DEADLINE_MS - COVERAGE_REPAIR_POLL_MS,
      );
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2 * COVERAGE_REPAIR_POLL_MS);
      expect(await outcome).toMatch(
        /canonical conversation search cannot start until projection coverage is complete/,
      );
      await moduleRef.close();
    },
  );

  it('fails at once with aggregate counts when no stale chat can be queued', async () => {
    const incomplete = {
      ...COVERAGE_ROW,
      ready_chat_count: 10,
      stale_chat_count: 2,
      complete_document_count: 54,
    };
    const { enqueueChatReindex, moduleRef, service } = await buildService(
      true,
      true,
      [[incomplete], []],
    );

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      'chats=12, ready=10, stale=2, documents=57, complete=54',
    );
    expect(enqueueChatReindex).not.toHaveBeenCalled();
    await moduleRef.close();
  });

  it('fails loudly before coverage when the aggregate function is missing or mis-provisioned', async () => {
    const { moduleRef, service } = await buildService(true, false);

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /llame_search_projection_coverage_v2.*BYPASSRLS/,
    );
    await moduleRef.close();
  });
});
