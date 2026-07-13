import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzlePostgresModule } from '@knaadh/nestjs-drizzle-postgres';

import { AuthModule } from './auth/auth.module';
import * as schema from './db/schema';
import { DbModule } from './db/db.module';
import { InstanceConfigModule } from './instance-config/instance-config.module';
import { InstanceConfigService } from './instance-config/instance-config.service';
import { RunWorkerModule } from './runs/run-worker.module';
import { SearchModule } from './search/search.module';

/**
 * WorkerModule — composes the three consumer-owning feature modules for the
 * dedicated no-HTTP worker entrypoint (worker.ts, #116, durable-run-workers
 * D4): RunWorkerModule (the `runs` group — RunsWorkerService + its
 * dead-letter consumer), SearchModule (the `search-reindex` group —
 * SearchReindexWorker), AuthModule (the `sessions-cleanup` group —
 * SessionCleanupService; already transitively pulled in via
 * RunWorkerModule -> RunsModule -> AuthModule, imported here explicitly too
 * for clarity since it is its own worker profile group).
 *
 * NOT the HTTP api: booted via NestFactory.createApplicationContext, which
 * never starts an HTTP adapter — AuthController/RunsController/ModelsController
 * still exist as ordinary DI providers deep in these modules' graphs (Nest
 * instantiates the whole graph regardless of transport), but they never serve
 * a request because no HTTP server is ever created. "No HTTP" is a runtime
 * behavior of the entrypoint, not something achieved by stripping controllers
 * out of the reused modules — reuse over refactor, matching the existing
 * module boundaries.
 *
 * InstanceConfigModule and DbModule are @Global, but @Global scoping is
 * per-application-graph: main.ts's AppModule and this WorkerModule are two
 * separate `NestFactory` graphs, so each must import them directly. Same for
 * the Drizzle `DB_DEV` connection: AppModule wires it directly (not via
 * DbModule, which only provides TenantDbService itself), so this module
 * mirrors that registration rather than depending on AppModule.
 *
 * Every consumer-owning service gates itself on WorkerProfileService
 * (InstanceConfigModule) — the same profile resolution main.ts's api process
 * uses — so which of the three groups this process actually runs is a
 * config/env choice (`LLAME_WORKER_PROFILE`), not something this module
 * decides.
 *
 * ConfigModule.forRoot is repeated from AppModule for the same
 * separate-graph reason: ModelsService (needed transitively for the `runs`
 * group) injects @nestjs/config's ConfigService, which nothing else in this
 * graph would otherwise provide.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env.local' }),
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
    RunWorkerModule,
    SearchModule,
    AuthModule,
  ],
})
export class WorkerModule {}
