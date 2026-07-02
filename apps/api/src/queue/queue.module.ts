import { Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PgBossModule } from '@wavezync/nestjs-pgboss';

import { PgBossQueueService } from './pgboss-queue.service';
import { QUEUE, type Queue } from './queue';

@Injectable()
class OpenApiQueueService implements Queue {
  ensureQueue: Queue['ensureQueue'] = () => Promise.resolve();
  enqueue: Queue['enqueue'] = () => Promise.resolve(null);
  consume: Queue['consume'] = () => Promise.resolve('openapi-noop');
  stopConsumer: Queue['stopConsumer'] = () => Promise.resolve();
  schedule: Queue['schedule'] = () => Promise.resolve();
  unschedule: Queue['unschedule'] = () => Promise.resolve();
  cancel: Queue['cancel'] = () => Promise.resolve();
}

const isOpenApiGeneration = process.env.LLAME_OPENAPI_GENERATION === '1';

const pgBossImports = isOpenApiGeneration
  ? []
  : [
      PgBossModule.forRootAsync({
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => ({
          // Same database as Drizzle, own `pgboss` schema, own `pg` pool —
          // two drivers to one Postgres is expected (SPEC §24.0.1).
          // getOrThrow: a missing POSTGRES_URL must fail module boot loudly,
          // not surface later as a cryptic pg connection error.
          connectionString: config.getOrThrow<string>('POSTGRES_URL'),
        }),
        inject: [ConfigService],
      }),
    ];

/**
 * QueueModule (#47) — pg-boss on the existing Postgres, behind the Queue
 * interface (inject via the QUEUE token). SPEC §9.6, §24.0.1.
 *
 * Deliberately NOT imported into AppModule yet: booting pg-boss belongs to the
 * durable-run pipeline (#48) and the worker process (#50). Standing up a live
 * queue in the API boot path today would couple it to the request path for no
 * consumer — exactly what the v0.2 worker split is unwinding. Import this
 * module where the consumer lives.
 */
@Module({
  imports: pgBossImports,
  providers: [
    {
      provide: QUEUE,
      useClass: isOpenApiGeneration ? OpenApiQueueService : PgBossQueueService,
    },
  ],
  exports: [QUEUE],
})
export class QueueModule {}
