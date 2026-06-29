import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupOpenApi } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  setupOpenApi(app);
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
