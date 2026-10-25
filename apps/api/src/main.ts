// Must stay the first import: see instrument.ts.
import './instrument';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, setupOpenApi } from './app.setup';
import { rejectUndeclaredMethods, secureResponses } from './http-hardening';
import { InstanceConfigService } from './instance-config/instance-config.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const instanceConfig = app.get(InstanceConfigService);
  configureApp(app, instanceConfig.config.http.trustProxy);
  secureResponses(app);
  app.use(rejectUndeclaredMethods(setupOpenApi(app)));
  // Off by default in Nest; without it SIGTERM never reaches onModuleDestroy/
  // onApplicationShutdown, so the postgres.js pool and pg-boss can't drain —
  // required for the clean-shutdown invariants in docs/product/operator/scaling.md.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
