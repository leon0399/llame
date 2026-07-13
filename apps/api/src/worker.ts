import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

/**
 * Dedicated worker entrypoint (#116, durable-run-workers D4) — no HTTP
 * server: an application context that boots exactly the consumer-owning
 * services (via WorkerModule) each self-gated by WorkerProfileService on the
 * SAME `LLAME_WORKER_PROFILE` resolution main.ts's api process uses. There is
 * no `RUN_EXECUTION_MODE` co-location toggle — a dedicated prod deployment
 * runs this entrypoint with a profile that has consumer groups (e.g. `all`),
 * paired with the api process on `web` (no groups); co-located dev keeps
 * running main.ts alone with the default `all` profile.
 *
 * One image, two entrypoints (nest-cli.json compiles the whole `src/`
 * program, so `nest build` emits both `dist/main.js` and `dist/worker.js`
 * with no separate build config).
 */
async function bootstrap() {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // Same rationale as main.ts: SIGTERM must reach onModuleDestroy so
  // nestjs-pgboss's boss.stop({ graceful }) can drain in-flight jobs (design
  // D5) before exit.
  app.enableShutdownHooks();
  logger.log(
    'Worker context ready (no HTTP) — consumers gated by LLAME_WORKER_PROFILE',
  );
}
void bootstrap();
