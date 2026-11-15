import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgBossModule } from '@wavezync/nestjs-pgboss';
import { isRecord } from '@workspace/runtime-safety';

import { BashJobRegistry } from './bash-job-registry';
import { WorkerShutdownService } from './worker-shutdown.service';

const { order } = vi.hoisted(() => {
  const order: Array<string> = [];

  return { order };
});

@Module({
  providers: [
    WorkerShutdownService,
    {
      provide: BashJobRegistry,
      useValue: {
        shutdown: async () => {
          order.push('jobs stopping');
          await Promise.resolve();
          order.push('jobs settled');
        },
      },
    },
  ],
})
class NonGlobalWorkerModule {}

describe('WorkerShutdownService module order', () => {
  it('awaits job settlement before the real global PgBossModule destroy hook stops its queue', async () => {
    order.length = 0;

    const queueModule = PgBossModule.forRootAsync({
      useFactory: () => ({ connectionString: 'postgres://unused' }),
    });

    const bossProvider = queueModule.providers?.find(
      (provider) =>
        isRecord(provider) &&
        String(provider.provide) === 'Symbol(PGBOSS_TOKEN)',
    );

    if (bossProvider === undefined || !('provide' in bossProvider))
      throw new Error('PgBossModule no longer exposes its boss provider');

    const app = await Test.createTestingModule({
      imports: [queueModule, NonGlobalWorkerModule],
    })
      .overrideProvider(bossProvider.provide)
      .useValue({
        on: vi.fn(),
        stop: () => {
          order.push('queue stopped');

          return Promise.resolve();
        },
      })
      .compile();

    await app.init();
    await app.close();
    expect(order).toEqual(['jobs stopping', 'jobs settled', 'queue stopped']);
  });
});
