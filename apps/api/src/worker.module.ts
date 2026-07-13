import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { CoreInfraModule } from './core-infra.module';
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
 * CoreInfraModule (config loading, InstanceConfigModule, the `DB_DEV` Drizzle
 * connection, DbModule) is imported directly rather than depended on via
 * AppModule: @Global scoping is per-application-graph, and main.ts's
 * AppModule and this WorkerModule are two separate `NestFactory` graphs, so
 * each needs its own import of the shared infra wrapper.
 *
 * Every consumer-owning service gates itself on WorkerProfileService
 * (InstanceConfigModule, via CoreInfraModule) — the same profile resolution
 * main.ts's api process uses — so which of the three groups this process
 * actually runs is a config/env choice (`LLAME_WORKER_PROFILE`), not
 * something this module decides.
 */
@Module({
  imports: [CoreInfraModule, RunWorkerModule, SearchModule, AuthModule],
})
export class WorkerModule {}
