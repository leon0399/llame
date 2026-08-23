/** Real HTTP + Postgres coverage for self-service Knowledge Space provisioning. */

import { lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { cookieOf, expectRegisteredUserId } from '../testing/support';
import { isRecord, isString } from '../unknown-record';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

d('PUT /api/v1/me/knowledge-space', () => {
  let app: INestApplication<import('http').Server>;
  let http: import('http').Server;
  let root: string;
  let cookieA = '';
  let cookieB = '';
  const tag = Date.now();
  const password = 'password123';

  async function register(
    email: string,
    name: string,
  ): Promise<{ cookie: string; userId: string }> {
    const response = await request(http)
      .post('/auth/v1/register')
      .send({ email, password, name })
      .expect(201);
    const body: unknown = response.body;
    expectRegisteredUserId(body);
    return { cookie: cookieOf(response), userId: body.user.id };
  }

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'llame-knowledge-http-'));
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(InstanceConfigService)
      .useValue({
        config: {
          ...BUILT_IN_DEFAULTS,
          knowledge: { root },
        },
      })
      .compile();

    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();

    cookieA = (await register(`knowledge-a-${tag}@test.com`, 'Knowledge A'))
      .cookie;
    cookieB = (await register(`knowledge-b-${tag}@test.com`, 'Knowledge B'))
      .cookie;
  });

  afterAll(async () => {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects unauthenticated provisioning', async () => {
    await request(http).put('/api/v1/me/knowledge-space').send({}).expect(401);
  });

  it('provisions one stable logical ID and exact direct child per owner', async () => {
    const first = await request(http)
      .put('/api/v1/me/knowledge-space')
      .set('Cookie', cookieA)
      .expect(200);
    const firstBody: unknown = first.body;
    if (!isRecord(firstBody) || !isString(firstBody.id)) {
      throw new Error('Expected a logical Knowledge Space response');
    }
    const firstId = firstBody.id;
    expect(firstId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(Object.keys(firstBody)).toEqual(['id']);

    const second = await request(http)
      .put('/api/v1/me/knowledge-space')
      .set('Cookie', cookieA)
      .send({})
      .expect(200);
    const secondBody: unknown = second.body;
    expect(secondBody).toEqual(firstBody);

    const other = await request(http)
      .put('/api/v1/me/knowledge-space')
      .set('Cookie', cookieB)
      .send({})
      .expect(200);
    const otherBody: unknown = other.body;
    if (!isRecord(otherBody) || !isString(otherBody.id)) {
      throw new Error('Expected a logical Knowledge Space response');
    }
    expect(otherBody.id).not.toBe(firstId);
    expect(Object.keys(otherBody)).toEqual(['id']);
    expect(lstatSync(path.join(root, firstId)).isDirectory()).toBe(true);
    expect(lstatSync(path.join(root, otherBody.id)).isDirectory()).toBe(true);
  });

  it('rejects selector-shaped payloads instead of accepting caller identity or location', async () => {
    await request(http)
      .put('/api/v1/me/knowledge-space')
      .set('Cookie', cookieA)
      .send({ ownerUserId: 'other-owner' })
      .expect(400);
    await request(http)
      .put('/api/v1/me/knowledge-space')
      .set('Cookie', cookieA)
      .send({ directory: '/tmp/other-root' })
      .expect(400);
  });

  it('retains the row ID when child creation fails, then repairs the exact child on retry', async () => {
    const provisioned = await request(http)
      .put('/api/v1/me/knowledge-space')
      .set('Cookie', cookieA)
      .send({})
      .expect(200);
    const provisionedBody: unknown = provisioned.body;
    if (!isRecord(provisionedBody) || !isString(provisionedBody.id)) {
      throw new Error('Expected a logical Knowledge Space response');
    }
    const child = path.join(root, provisionedBody.id);
    rmSync(child, { recursive: true, force: true });
    writeFileSync(child, 'not a directory');

    await request(http)
      .put('/api/v1/me/knowledge-space')
      .set('Cookie', cookieA)
      .send({})
      .expect(503);

    rmSync(child, { force: true });
    const retry = await request(http)
      .put('/api/v1/me/knowledge-space')
      .set('Cookie', cookieA)
      .send({})
      .expect(200);
    expect(retry.body).toEqual({ id: provisionedBody.id });
    expect(lstatSync(child).isDirectory()).toBe(true);
  });

  it('returns a safe unavailable response when the configured root disappears', async () => {
    rmSync(root, { recursive: true, force: true });

    const response = await request(http)
      .put('/api/v1/me/knowledge-space')
      .set('Cookie', cookieA)
      .send({})
      .expect(503);
    expect(response.body).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      code: 'knowledge_space_unavailable',
      message: 'Knowledge Space is unavailable.',
    });
    expect(JSON.stringify(response.body)).not.toContain(root);
  });
});
