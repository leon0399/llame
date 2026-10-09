import { Test, type TestingModule } from '@nestjs/testing';

import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { TenantDbService } from '../db/tenant-db.service';
import { SearchIndexService } from './search-index.service';
import {
  CanonicalSearchActivationService,
  CanonicalSearchCoverageService,
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
 *  incomplete) the stale-chat list and the post-repair coverage. */
async function buildService(
  searchAllowed: boolean,
  provisioned: boolean,
  queries: Array<Array<FakeRow>> = [[COVERAGE_ROW]],
  reindexChat = vi.fn(() => Promise.resolve()),
) {
  const results: Array<Array<FakeRow>> = [
    provisioned ? [{ bypass: true }] : [{ bypass: false }],
    ...queries,
  ];
  const execute = vi.fn(
    (): Promise<Iterable<FakeRow>> => Promise.resolve(results.shift() ?? []),
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
      { provide: SearchIndexService, useValue: { reindexChat } },
    ],
  }).compile();
  return {
    moduleRef,
    runAsPublic,
    reindexChat,
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
  it('skips readiness when the HTTP process cannot bind search_conversations', async () => {
    const { moduleRef, runAsPublic, service } = await buildService(
      false,
      false,
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(runAsPublic).not.toHaveBeenCalled();
    await moduleRef.close();
  });

  it('admits allowlisted search without a separate opt-in after current projection is fully ready', async () => {
    const { moduleRef, runAsPublic, service } = await buildService(true, true);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(runAsPublic).toHaveBeenCalledTimes(2);
    await moduleRef.close();
  });

  it('shares one readiness check across HTTP admission and a co-located runs consumer', async () => {
    const { coverage, moduleRef, runAsPublic, service } = await buildService(
      true,
      true,
    );

    await service.onModuleInit();
    await coverage.assertReady();

    expect(runAsPublic).toHaveBeenCalledTimes(2);
    await moduleRef.close();
  });

  it('rebuilds stale chats before the gate and admits once coverage is complete', async () => {
    const { moduleRef, reindexChat, service } = await buildService(true, true, [
      [ONE_STALE],
      [STALE_ROW],
      [COVERAGE_ROW],
    ]);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(reindexChat).toHaveBeenCalledExactlyOnceWith('chat-1', 'owner-1');
    await moduleRef.close();
  });

  it('fails closed when a stale chat rebuild fails', async () => {
    const { moduleRef, service } = await buildService(
      true,
      true,
      [[ONE_STALE], [STALE_ROW]],
      vi.fn(() => Promise.reject(new Error('rebuild failed'))),
    );

    await expect(service.onModuleInit()).rejects.toThrow(
      'canonical conversation search cannot start: rebuild failed',
    );
    await moduleRef.close();
  });

  it.each([
    ['stale chats', { ready_chat_count: 11, stale_chat_count: 1 }],
    ['offsetless or legacy documents', { complete_document_count: 56 }],
  ])('refuses activation for %s left after repair', async (_name, fields) => {
    const incomplete = { ...COVERAGE_ROW, ...fields };
    const { moduleRef, service } = await buildService(true, true, [
      [incomplete],
      [],
      [incomplete],
    ]);

    await expect(service.onModuleInit()).rejects.toThrow(
      /canonical conversation search cannot start until projection coverage is complete/,
    );
    await moduleRef.close();
  });

  it('reports only aggregate readiness counts for incomplete coverage', async () => {
    const incomplete = {
      ...COVERAGE_ROW,
      ready_chat_count: 10,
      stale_chat_count: 2,
      complete_document_count: 54,
    };
    const { moduleRef, service } = await buildService(true, true, [
      [incomplete],
      [],
      [incomplete],
    ]);

    await expect(service.onModuleInit()).rejects.toThrow(
      'chats=12, ready=10, stale=2, documents=57, complete=54',
    );
    await moduleRef.close();
  });

  it('fails loudly before coverage when the aggregate function is missing or mis-provisioned', async () => {
    const { moduleRef, service } = await buildService(true, false);

    await expect(service.onModuleInit()).rejects.toThrow(
      /llame_search_projection_coverage_v2.*BYPASSRLS/,
    );
    await moduleRef.close();
  });
});
