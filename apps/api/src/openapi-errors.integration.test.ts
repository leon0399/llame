import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join } from 'node:path';
import request from 'supertest';
import { z } from 'zod';
import { AppModule } from './app.module';
import { CanonicalSearchCoverageService } from './search/canonical-search-activation.service';
import { configureApp } from './app.setup';
import { cookieOf } from './testing/support';

vi.setConfig({ testTimeout: 30_000 });

type HttpServer = Server<typeof IncomingMessage, typeof ServerResponse>;

function isHttpServer(value: unknown): value is HttpServer {
  return value instanceof Server;
}

const errorBodySchema = z.object({
  code: z.string(),
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
});

type ErrorBody = z.infer<typeof errorBodySchema>;

const openApiPropertySchema = z
  .object({
    enum: z.array(z.unknown()).optional(),
    type: z.string().optional(),
  })
  .passthrough();

const openApiSchemaSchema = z
  .object({
    properties: z.record(z.string(), openApiPropertySchema).optional(),
    required: z.array(z.string()).optional(),
  })
  .passthrough();

const rawDocument: unknown = JSON.parse(
  readFileSync(join(__dirname, '../openapi.json'), 'utf8'),
);

const openApiSchemas = z
  .object({
    components: z.object({
      schemas: z.record(z.string(), openApiSchemaSchema),
    }),
  })
  .parse(rawDocument).components.schemas;

function expectDocumentedError(
  body: ErrorBody,
  schemaName: string,
  expected: ErrorBody,
): void {
  expect(body).toEqual(expected);
  const schema = openApiSchemas[schemaName];
  if (!schema) {
    throw new Error(`Missing OpenAPI schema ${schemaName}`);
  }
  expect(schema.required).toEqual(['statusCode', 'error', 'message', 'code']);
  expect(schema.properties?.statusCode?.type).toBe('number');
  expect(schema.properties?.error?.type).toBe('string');
  expect(schema.properties?.message?.type).toBe('string');
  expect(schema.properties?.code?.type).toBe('string');
  expect(schema.properties?.code?.enum).toContain(expected.code);
}

describe('OpenAPI error schemas match real HTTP responses', () => {
  let app: INestApplication;
  let http: HttpServer;
  let cookie: string;
  let rootId: string;
  let childId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    const appServer: unknown = app.getHttpServer();
    if (!isHttpServer(appServer)) {
      throw new Error('Expected Nest to expose a Node HTTP server');
    }
    http = appServer;

    const tag = Date.now();
    const registered = await request(http)
      .post('/auth/v1/register')
      .send({
        email: `openapi-errors-${tag}@example.com`,
        password: 'password123',
        name: 'OpenAPI errors',
      });
    expect(registered.status).toBe(201);
    cookie = cookieOf(registered);

    const root = await request(http)
      .post('/api/v1/org-units')
      .set('Cookie', cookie)
      .send({ name: 'Root' });
    expect(root.status).toBe(201);
    rootId = z.object({ id: z.string().uuid() }).parse(root.body).id;

    const child = await request(http)
      .post(`/api/v1/org-units/${rootId}/children`)
      .set('Cookie', cookie)
      .send({ name: 'Child' });
    expect(child.status).toBe(201);
    childId = z.object({ id: z.string().uuid() }).parse(child.body).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('documents the coded organization conflict envelope', async () => {
    const response = await request(http)
      .delete(`/api/v1/org-units/${rootId}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(409);
    expectDocumentedError(
      errorBodySchema.parse(response.body),
      'OrgUnitConflictErrorResponse',
      {
        statusCode: 409,
        error: 'Conflict',
        message: 'Org unit has child units — delete them first',
        code: 'HAS_CHILDREN',
      },
    );
  });

  it('documents the coded organization validation envelope', async () => {
    const response = await request(http)
      .patch(`/api/v1/org-units/${rootId}`)
      .set('Cookie', cookie)
      .send({ parentId: childId });

    expect(response.status).toBe(422);
    expectDocumentedError(
      errorBodySchema.parse(response.body),
      'OrgUnitValidationErrorResponse',
      {
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Cannot move an org unit into its own subtree.',
        code: 'MOVE_INTO_OWN_SUBTREE',
      },
    );
  });
});
