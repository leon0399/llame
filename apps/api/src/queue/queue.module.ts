import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PgBossModule } from '@wavezync/nestjs-pgboss';

import { PgBossQueueService } from './pgboss-queue.service';
import { QUEUE } from './queue';

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
  imports: [
    PgBossModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        // Same database as Drizzle, own `pgboss` schema, own `pg` pool —
        // two drivers to one Postgres is expected (SPEC §24.0.1).
        connectionString: config.get<string>('POSTGRES_URL'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [{ provide: QUEUE, useClass: PgBossQueueService }],
  exports: [QUEUE],
})
export class QueueModule {}
