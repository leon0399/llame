import { Test, type TestingModule } from '@nestjs/testing';

import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { TenantDbService } from '../db/tenant-db.service';
import { CanonicalSearchActivationService } from './canonical-search-activation.service';

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

function config(canonicalModelExcerpts: boolean) {
  return {
    ...BUILT_IN_DEFAULTS,
    search: {
      chats: {
        ...BUILT_IN_DEFAULTS.search.chats,
        canonicalModelExcerpts,
      },
    },
  };
}

async function buildService(
  canonicalModelExcerpts: boolean,
  provisioned: boolean,
  coverage: CoverageRow[] = [COVERAGE_ROW],
) {
  const results: FakeRow[][] = [
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
      {
        provide: InstanceConfigService,
        useValue: { config: config(canonicalModelExcerpts) },
      },
      { provide: TenantDbService, useValue: { runAsPublic } },
    ],
  }).compile();
  return {
    moduleRef,
    runAsPublic,
    service: moduleRef.get(CanonicalSearchActivationService),
  };
}

describe('CanonicalSearchActivationService', () => {
  it('keeps canonical shaping disabled and does not query readiness when the flag is false', async () => {
    const { moduleRef, runAsPublic, service } = await buildService(
      false,
      false,
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.canonicalModelExcerptsEnabled).toBe(false);
    expect(runAsPublic).not.toHaveBeenCalled();
    await moduleRef.close();
  });

  it('activates only after the provisioned current projection is fully ready', async () => {
    const { moduleRef, runAsPublic, service } = await buildService(true, true);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.canonicalModelExcerptsEnabled).toBe(true);
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
      /canonical model excerpts cannot activate until projection coverage is complete/,
    );
    expect(service.canonicalModelExcerptsEnabled).toBe(false);
    await moduleRef.close();
  });

  it('fails loudly before coverage when the aggregate function is missing or mis-provisioned', async () => {
    const { moduleRef, service } = await buildService(true, false);

    await expect(service.onModuleInit()).rejects.toThrow(
      /llame_search_projection_coverage_v2.*BYPASSRLS/,
    );
    expect(service.canonicalModelExcerptsEnabled).toBe(false);
    await moduleRef.close();
  });

  it('keeps the capability off after a rollback configuration', async () => {
    const { moduleRef, runAsPublic, service } = await buildService(false, true);

    await service.onModuleInit();

    expect(service.canonicalModelExcerptsEnabled).toBe(false);
    expect(runAsPublic).not.toHaveBeenCalled();
    await moduleRef.close();
  });
});
