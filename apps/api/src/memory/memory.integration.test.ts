/** HTTP-boundary tests for /api/v1/me/memory. */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { configureApp, createOpenApiDocument } from '../app.setup';
import { cookieOf, expectRegisteredUserId } from '../testing/support';
import { isRecord } from '../unknown-record';
import { type UpdateMemoryDto } from './dto/memory.dto';

type MemoryPatchBody = UpdateMemoryDto | (UpdateMemoryDto & { userId: string });

describe('/api/v1/me/memory (HTTP)', () => {
  let app: INestApplication<import('http').Server>;
  let http: import('http').Server;
  const tag = Date.now();
  const password = 'password123';
  let cookieA = '';
  let cookieB = '';
  let userAId = '';

  async function register(
    email: string,
    name: string,
  ): Promise<{ cookie: string; userId: string }> {
    const res = await request(http)
      .post('/auth/v1/register')
      .send({ email, password, name });
    const body: unknown = res.body;
    expectRegisteredUserId(body);
    return { cookie: cookieOf(res), userId: body.user.id };
  }

  const get = (cookie: string) =>
    request(http).get('/api/v1/me/memory').set('Cookie', cookie);

  const patch = (cookie: string, body: MemoryPatchBody) =>
    request(http).patch('/api/v1/me/memory').set('Cookie', cookie).send(body);

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
    http = app.getHttpServer();

    const a = await register(`memory-a-${tag}@test.com`, 'Memory Owner A');
    cookieA = a.cookie;
    userAId = a.userId;
    cookieB = (await register(`memory-b-${tag}@test.com`, 'Memory Owner B'))
      .cookie;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns default-off through the one-field egress allowlist', async () => {
    const res = await get(cookieA).expect(200);

    expect(res.body).toEqual({ shareRecentChats: false });
    const body: unknown = res.body;
    if (!isRecord(body)) {
      throw new Error('Expected object response body');
    }
    expect(Object.keys(body)).toEqual(['shareRecentChats']);
  });

  it('updates only the authenticated owner', async () => {
    expect(
      (await patch(cookieA, { shareRecentChats: true }).expect(200)).body,
    ).toEqual({ shareRecentChats: true });
    expect((await get(cookieB).expect(200)).body).toEqual({
      shareRecentChats: false,
    });
  });

  it('rejects a client-supplied user id without changing its target', async () => {
    await patch(cookieB, {
      userId: userAId,
      shareRecentChats: false,
    }).expect(400);

    expect((await get(cookieA).expect(200)).body).toEqual({
      shareRecentChats: true,
    });
  });

  it('rejects unauthenticated reads and writes without disclosing a value', async () => {
    const getResponse = await request(http)
      .get('/api/v1/me/memory')
      .expect(401);
    expect(getResponse.body).not.toHaveProperty('shareRecentChats');

    const patchResponse = await request(http)
      .patch('/api/v1/me/memory')
      .send({ shareRecentChats: true })
      .expect(401);
    expect(patchResponse.body).not.toHaveProperty('shareRecentChats');
  });

  it('publishes GET and PATCH with explicit response schemas in OpenAPI', () => {
    const document = createOpenApiDocument(app);
    const path = document.paths['/api/v1/me/memory'];
    const schema = document.components?.schemas?.['MemoryResponse'];

    expect(path?.get?.responses['200']).toBeDefined();
    expect(path?.patch?.responses['200']).toBeDefined();
    expect(schema).toBeDefined();
    expect(schema).not.toHaveProperty('$ref');
    if (!schema || '$ref' in schema) return;
    expect(schema.required).toEqual(['shareRecentChats']);
    expect(schema.properties?.['shareRecentChats']).toMatchObject({
      type: 'boolean',
    });
  });
});
