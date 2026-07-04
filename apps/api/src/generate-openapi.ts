import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { configureApp, createOpenApiDocument } from './app.setup';

async function generateOpenApi() {
  process.env.LLAME_OPENAPI_GENERATION = '1';
  process.env.POSTGRES_URL ??= 'postgres://openapi:openapi@127.0.0.1:1/openapi';

  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    configureApp(app);
    const document = createOpenApiDocument(app);
    await writeFile(
      join(process.cwd(), 'openapi.json'),
      `${JSON.stringify(document, null, 2)}\n`,
    );
  } finally {
    // Always close — a throw in document creation or writeFile must not leak the app
    // (open handles would hang the build process).
    await app.close();
  }
}

void generateOpenApi();
