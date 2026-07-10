import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { configureApp, createOpenApiDocument } from './app.setup';

async function generateOpenApi() {
  process.env.LLAME_OPENAPI_GENERATION = '1';
  process.env.POSTGRES_URL ??= 'postgres://openapi:openapi@127.0.0.1:1/openapi';
  // OpenAPI generation boots the full AppModule (incl. InstanceConfigService,
  // @Global) purely as a side effect of producing openapi.json — it has no
  // business depending on whatever llame.config.json happens to be sitting
  // in the build cwd. Point LLAME_CONFIG_PATH at a path that's guaranteed
  // absent so the loader always resolves to built-in defaults here,
  // regardless of local/leftover operator config (verified: a missing
  // LLAME_CONFIG_PATH target is treated the same as "file absent", not an
  // error — see config-loader.ts's readRawConfig ENOENT handling).
  process.env.LLAME_CONFIG_PATH = join(
    tmpdir(),
    'llame-openapi-generation-no-such-config.json',
  );

  try {
    const { AppModule } = await import('./app.module.js');
    // NOT `logger: false`: a DI provider constructor throw (e.g.
    // InstanceConfigService on a still-somehow-invalid config) is handled
    // INSIDE Nest's own exceptions zone, which calls process.exit(1)
    // synchronously before NestFactory.create's promise ever settles back to
    // this function — no try/catch around `await NestFactory.create(...)`
    // can ever run in that case (verified empirically: with `logger: false`
    // the process exits with zero output and the catch block below never
    // executes). `logger: ['error']` keeps routine boot noise suppressed
    // (verified silent on a clean boot) while letting Nest's own
    // ExceptionHandler print the full, correctly-attributed stack before it
    // exits, so a broken build always says why.
    const app = await NestFactory.create(AppModule, { logger: ['error'] });
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
  } catch (err) {
    // Covers failures that DO propagate normally (anything after
    // NestFactory.create resolves — configureApp, document generation,
    // writeFile) — the DI-constructor-throw case above is handled by the
    // logger option instead, since it never reaches here.
    console.error('OpenAPI generation failed:', err);
    process.exitCode = 1;
    throw err;
  }
}

void generateOpenApi();
