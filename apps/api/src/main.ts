import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupOpenApi } from './app.setup';
import { InstanceConfigService } from './instance-config/instance-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const instanceConfig = app.get(InstanceConfigService);
  configureApp(app, instanceConfig.config.http.trustProxy);
  setupOpenApi(app);
  // Off by default in Nest; without it SIGTERM never reaches onModuleDestroy/
  // onApplicationShutdown, so the postgres.js pool and pg-boss can't drain —
  // required for the clean-shutdown invariants in docs/scaling.md.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
