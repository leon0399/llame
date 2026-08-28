import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';

import { AppModule } from '../app.module';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { PgBossQueueService } from '../queue/pgboss-queue.service';
import { WorkerModule } from '../worker.module';
import { CanonicalSearchCoverageService } from './canonical-search-activation.service';

type DrizzleWithClient = PostgresJsDatabase & { $client: Sql };

const describeIfDb = process.env['TEST_DATABASE_URL']
  ? describe
  : describe.skip;

vi.setConfig({ testTimeout: 60_000 });

describeIfDb('canonical search process admission', () => {
  const config = {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      allowed: ['search_conversations'],
    },
  };

  it('fails HTTP application init when allowlisted search coverage rejects', async () => {
    const assertReady = vi
      .fn()
      .mockRejectedValue(new Error('aggregate coverage incomplete'));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(InstanceConfigService)
      .useValue({ config })
      .overrideProvider(WorkerProfileService)
      .useValue({ concurrencyFor: () => null })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady })
      .compile();
    const app: INestApplication = moduleRef.createNestApplication();
    const db = moduleRef.get<DrizzleWithClient>('DB_DEV', { strict: false });

    try {
      await expect(app.init()).rejects.toThrow('aggregate coverage incomplete');
      expect(assertReady).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
      await db.$client.end();
    }
  });

  it('fails a runs worker before consumer registration without a local search allowlist', async () => {
    const assertReady = vi
      .fn()
      .mockRejectedValue(new Error('aggregate coverage incomplete'));
    const consumeSpy = vi.spyOn(PgBossQueueService.prototype, 'consume');
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    })
      .overrideProvider(InstanceConfigService)
      .useValue({
        config: {
          ...config,
          tools: { ...config.tools, allowed: [] },
        },
      })
      .overrideProvider(WorkerProfileService)
      .useValue({
        concurrencyFor: (group: string) => (group === 'runs' ? 1 : null),
      })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady })
      .compile();
    const db = moduleRef.get<DrizzleWithClient>('DB_DEV', { strict: false });

    try {
      await expect(moduleRef.init()).rejects.toThrow(
        'aggregate coverage incomplete',
      );
      expect(assertReady).toHaveBeenCalledTimes(1);
      expect(consumeSpy).not.toHaveBeenCalled();
    } finally {
      await expect(moduleRef.close()).rejects.toThrow(
        'aggregate coverage incomplete',
      );
      await db.$client.end();
      consumeSpy.mockRestore();
    }
  });
});
