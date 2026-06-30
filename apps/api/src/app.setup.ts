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
    // A wildcard origin is invalid with credentialed CORS (browsers reject it) and
    // would be a tenant-isolation footgun — fail closed rather than serve it.
    if (configured.includes('*')) {
      throw new Error(
        'WEB_ORIGIN must be an explicit origin allowlist; "*" is not allowed with credentialed CORS',
      );
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
