import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { SESSION_COOKIE_NAME } from './auth/constants';

const DEFAULT_DEV_WEB_ORIGIN = 'http://localhost:3000';

export function configureApp(app: INestApplication): void {
  app.enableCors({
    origin: getAllowedWebOrigins(),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

export function getAllowedWebOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = env.WEB_ORIGIN?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured?.length) {
    // Each entry must be a bare serialized origin (`scheme://host[:port]`), with no
    // path or trailing slash — that's what the browser sends in the `Origin` header,
    // and credentialed CORS matches it by exact string. A wildcard or a path-bearing
    // value silently fails every preflight at runtime, so fail closed at startup.
    for (const origin of configured) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error(`WEB_ORIGIN entry "${origin}" is not a valid origin`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(
          `WEB_ORIGIN entry "${origin}" must be an http(s) origin`,
        );
      }
      if (parsed.origin !== origin) {
        throw new Error(
          `WEB_ORIGIN entry "${origin}" must be a bare origin with no path or trailing slash (e.g. ${parsed.origin})`,
        );
      }
    }
    return configured;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('WEB_ORIGIN is required in production');
  }

  return [DEFAULT_DEV_WEB_ORIGIN];
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('llame API')
    .setDescription('llame auth and domain API')
    .setVersion('0.1')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque',
      },
      'bearer',
    )
    .addCookieAuth(
      SESSION_COOKIE_NAME,
      {
        type: 'apiKey',
        in: 'cookie',
      },
      'cookie',
    )
    .build();

  return SwaggerModule.createDocument(app, config);
}

export function setupOpenApi(app: INestApplication): OpenAPIObject {
  const document = createOpenApiDocument(app);
  // Serve the contract live so it can be explored and exercised manually:
  //   /docs        — Swagger UI (interactive)
  //   /docs/json   — OpenAPI JSON
  //   /docs/yaml   — OpenAPI YAML
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/json',
    yamlDocumentUrl: 'docs/yaml',
  });
  return document;
}
