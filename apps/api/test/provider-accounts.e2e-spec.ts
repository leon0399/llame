/**
 * BYOK provider-accounts HTTP e2e (#18): create/list/delete over real HTTP
 * with the write-only secret contract — the API key appears in exactly one
 * request body and never in any response. Cross-tenant access 404s.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

const API_KEY = 'sk-e2e-vault-secret-000111';

d('Provider accounts over HTTP (#18)', () => {
  let app: INestApplication;
  let http: import('http').Server;
  const tag = Date.now();
  let cookieA = '';
  let cookieB = '';

  const cookieOf = (res: request.Response): string =>
    (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');

  beforeAll(async () => {
    // A test-only vault key ring.
    process.env.CREDENTIAL_MASTER_KEYS = `1:${Buffer.alloc(32, 9).toString('base64')}`;

    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer() as import('http').Server;

    for (const [name, setter] of [
      ['a', (c: string) => (cookieA = c)],
      ['b', (c: string) => (cookieB = c)],
    ] as const) {
      const res = await request(http)
        .post('/auth/v1/register')
        .send({
          email: `vault-${name}-${tag}@test.com`,
          password: 'password123',
          name: `Vault ${name}`,
        });
      expect(res.status).toBe(201);
      setter(cookieOf(res));
    }
  });

  afterAll(async () => {
    delete process.env.CREDENTIAL_MASTER_KEYS;
    await app?.close();
  });

  let accountId = '';

  it('creates an account; the secret never appears in the response', async () => {
    const res = await request(http)
      .post('/api/v1/provider-accounts')
      .set('Cookie', cookieA)
      .send({
        providerType: 'openai_compatible',
        displayName: 'My OpenRouter',
        apiKey: API_KEY,
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: 'openai/gpt-oss-20b:free',
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      providerType: 'openai_compatible',
      displayName: 'My OpenRouter',
      authMode: 'api_key',
      baseUrl: 'https://openrouter.ai/api/v1',
      enabled: true,
    });
    accountId = (res.body as { id: string }).id;
    expect(JSON.stringify(res.body)).not.toContain(API_KEY);
    expect(res.body).not.toHaveProperty('apiKey');
  });

  it('lists accounts without any secret material', async () => {
    const res = await request(http)
      .get('/api/v1/provider-accounts')
      .set('Cookie', cookieA);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.text).not.toContain(API_KEY);
  });

  it('rejects malformed bodies (missing key, bad url)', async () => {
    const missingKey = await request(http)
      .post('/api/v1/provider-accounts')
      .set('Cookie', cookieA)
      .send({ providerType: 'openai_compatible', displayName: 'x' });
    expect(missingKey.status).toBe(400);

    const badUrl = await request(http)
      .post('/api/v1/provider-accounts')
      .set('Cookie', cookieA)
      .send({
        providerType: 'openai_compatible',
        displayName: 'x',
        apiKey: 'sk-x',
        baseUrl: 'not a url',
      });
    expect(badUrl.status).toBe(400);
  });

  it("cross-tenant: B cannot see or delete A's account", async () => {
    const list = await request(http)
      .get('/api/v1/provider-accounts')
      .set('Cookie', cookieB);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(0);

    const del = await request(http)
      .delete(`/api/v1/provider-accounts/${accountId}`)
      .set('Cookie', cookieB);
    expect(del.status).toBe(404);
  });

  it("GET /api/v1/models (#76) lists A's own BYOK model, scoped to the caller", async () => {
    const res = await request(http)
      .get('/api/v1/models')
      .set('Cookie', cookieA);
    expect(res.status).toBe(200);
    const models = res.body as { id: string; source: string }[];
    expect(
      models.some(
        (m) => m.id === 'openai/gpt-oss-20b:free' && m.source === 'byok',
      ),
    ).toBe(true);
  });

  it("cross-tenant: GET /api/v1/models never surfaces A's BYOK model to B", async () => {
    const res = await request(http)
      .get('/api/v1/models')
      .set('Cookie', cookieB);
    expect(res.status).toBe(200);
    const models = res.body as { id: string }[];
    expect(models.some((m) => m.id === 'openai/gpt-oss-20b:free')).toBe(false);
  });

  it('unauthenticated requests are rejected (fail-closed global guard)', async () => {
    const res = await request(http).get('/api/v1/provider-accounts');
    expect(res.status).toBe(401);
  });

  it('the owner deletes the account (204), and it is gone', async () => {
    const del = await request(http)
      .delete(`/api/v1/provider-accounts/${accountId}`)
      .set('Cookie', cookieA);
    expect(del.status).toBe(204);

    const list = await request(http)
      .get('/api/v1/provider-accounts')
      .set('Cookie', cookieA);
    expect(list.body).toHaveLength(0);

    const again = await request(http)
      .delete(`/api/v1/provider-accounts/${accountId}`)
      .set('Cookie', cookieA);
    expect(again.status).toBe(404);
  });
});
