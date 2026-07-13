import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzlePostgresModule } from '@knaadh/nestjs-drizzle-postgres';

import { DbModule } from './db/db.module';
import * as schema from './db/schema';
import { InstanceConfigModule } from './instance-config/instance-config.module';
import { InstanceConfigService } from './instance-config/instance-config.service';

/**
 * CoreInfraModule — the cross-cutting infrastructure every entrypoint's own
 * NestFactory graph needs: env-file config loading, the operator config-as-
 * code loader (InstanceConfigModule; a bad llame.config.json aborts bootstrap
 * before anything serves), the `DB_DEV` Drizzle connection (pool sized from
 * InstanceConfigService), and DbModule's TenantDbService. Previously
 * duplicated verbatim between AppModule (main.ts) and WorkerModule
 * (worker.ts, #116) — extracted here so the two entrypoints share ONE
 * definition instead of two copies that could silently drift.
 *
 * Deliberately NOT @Global itself: ConfigModule.forRoot({isGlobal: true}),
 * InstanceConfigModule, DbModule, and DrizzlePostgresModule are ALL already
 * @Global (or global-equivalent) in their own right, so once this module is
 * instantiated anywhere in an application's module tree, their providers
 * (ConfigService, InstanceConfigService, WorkerProfileService,
 * TenantDbService, and the `DB_DEV` connection) resolve everywhere in that
 * SAME graph — @Global scoping is per-application-graph, so each entrypoint
 * (AppModule, WorkerModule) still needs its own import of this wrapper.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.local',
    }),
    InstanceConfigModule,
    DrizzlePostgresModule.registerAsync({
      tag: 'DB_DEV',
      inject: [InstanceConfigService],
      useFactory: (instanceConfig: InstanceConfigService) => ({
        postgres: {
          url: process.env.POSTGRES_URL!,
          config: { max: instanceConfig.config.db.poolSize },
        },
        config: { schema: { ...schema } },
      }),
    }),
    DbModule,
  ],
})
export class CoreInfraModule {}
