import { Test, type TestingModule } from '@nestjs/testing';

import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { TenantDbService } from '../db/tenant-db.service';
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
type FakeRow = CoverageRow | { bypass: boolean };

function config(searchAllowed: boolean) {
  return {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      allowed: searchAllowed ? ['search_conversations'] : [],
    },
  };
}

async function buildService(
  searchAllowed: boolean,
  provisioned: boolean,
  coverage: Array<CoverageRow> = [COVERAGE_ROW],
) {
  const results: Array<Array<FakeRow>> = [
    provisioned ? [{ bypass: true }] : [{ bypass: false }],
    coverage,
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
    ],
  }).compile();
  return {
    moduleRef,
    runAsPublic,
    service: moduleRef.get(CanonicalSearchActivationService),
    coverage: moduleRef.get(CanonicalSearchCoverageService),
  };
}

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

  it.each([
    ['stale chats', { ready_chat_count: 11, stale_chat_count: 1 }],
    ['offsetless or legacy documents', { complete_document_count: 56 }],
  ])('refuses activation for %s', async (_name, fields) => {
    const { moduleRef, service } = await buildService(true, true, [
      { ...COVERAGE_ROW, ...fields },
    ]);

    await expect(service.onModuleInit()).rejects.toThrow(
      /canonical conversation search cannot start until projection coverage is complete/,
    );
    await moduleRef.close();
  });

  it('reports only aggregate readiness counts for incomplete coverage', async () => {
    const { moduleRef, service } = await buildService(true, true, [
      {
        ...COVERAGE_ROW,
        ready_chat_count: 10,
        stale_chat_count: 2,
        complete_document_count: 54,
      },
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
