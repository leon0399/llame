import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, createOpenApiDocument } from './app.setup';

async function generateOpenApi() {
  process.env.POSTGRES_URL ??= 'postgres://openapi:openapi@127.0.0.1:1/openapi';

  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  const document = createOpenApiDocument(app);

  await writeFile(
    join(process.cwd(), 'openapi.json'),
    `${JSON.stringify(document, null, 2)}\n`,
  );
  await app.close();
}

void generateOpenApi();
