/** Real HTTP + Postgres coverage for the multi-space Knowledge API. */

import { lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { configureApp } from '../app.setup';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { cookieOf, expectRegisteredUserId } from '../testing/support';
import { isRecord, isString, type UnknownRecord } from '@workspace/runtime-safety';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

type SpaceResponse = {
  id: string;
  name: string;
};

type SpaceListResponse = {
  items: Array<SpaceResponse>;
  nextCursor: string | null;
};

function readSpaceResponse(value: UnknownRecord): SpaceResponse {
  if (!isString(value.id) || !isString(value.name)) {
    throw new Error('Expected a Knowledge Space response');
  }
  return { id: value.id, name: value.name };
}

function readSpaceListResponse(value: UnknownRecord): SpaceListResponse {
  if (!Array.isArray(value.items)) {
    throw new Error('Expected a Knowledge Space list response');
  }
  const nextCursor = value.nextCursor;
  if (nextCursor !== null && !isString(nextCursor)) {
    throw new Error('Expected a nullable Knowledge Space cursor');
  }
  return {
    items: value.items.map((item) => {
      if (!isRecord(item)) {
        throw new Error('Expected a Knowledge Space item');
      }
      return readSpaceResponse(item);
    }),
    nextCursor,
  };
}

d('Knowledge Spaces REST API', () => {
  let app: INestApplication<import('http').Server>;
  let http: import('http').Server;
  let root: string;
  let cookieA = '';
  let cookieB = '';
  let firstId = '';
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
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(InstanceConfigService)
      .useValue({
        config: {
          ...BUILT_IN_DEFAULTS,
          knowledge: { root },
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
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

  it('rejects unauthenticated collection creation', async () => {
    await request(http)
      .post('/api/v1/knowledge-spaces')
      .send({ name: 'Personal' })
      .expect(401);
  });

  it('creates duplicate-named spaces with distinct stable children', async () => {
    const first = await request(http)
      .post('/api/v1/knowledge-spaces')
      .set('Cookie', cookieA)
      .send({ name: '  Personal  ' })
      .expect(201);
    const second = await request(http)
      .post('/api/v1/knowledge-spaces')
      .set('Cookie', cookieA)
      .send({ name: 'Personal' })
      .expect(201);

    const firstBody: unknown = first.body;
    const secondBody: unknown = second.body;
    if (!isRecord(firstBody) || !isRecord(secondBody)) {
      throw new Error('Expected Knowledge Space response objects');
    }
    const firstSpace = readSpaceResponse(firstBody);
    const secondSpace = readSpaceResponse(secondBody);
    expect(firstSpace.name).toBe('Personal');
    expect(secondSpace.name).toBe('Personal');
    expect(firstSpace.id).not.toBe(secondSpace.id);
    expect(Object.keys(firstBody).sort()).toEqual([
      'createdAt',
      'id',
      'name',
      'updatedAt',
    ]);
    expect(first.headers.location).toBe(
      `/api/v1/knowledge-spaces/${firstSpace.id}`,
    );
    expect(lstatSync(path.join(root, firstSpace.id)).isDirectory()).toBe(true);
    expect(lstatSync(path.join(root, secondSpace.id)).isDirectory()).toBe(true);
    firstId = firstSpace.id;
  });

  it('lists with deterministic keyset pagination and retrieves one item', async () => {
    const paginationCookie = (
      await register(`knowledge-page-${tag}@test.com`, 'Knowledge Pages')
    ).cookie;
    await request(http)
      .post('/api/v1/knowledge-spaces')
      .set('Cookie', paginationCookie)
      .send({ name: 'First' })
      .expect(201);
    await request(http)
      .post('/api/v1/knowledge-spaces')
      .set('Cookie', paginationCookie)
      .send({ name: 'Second' })
      .expect(201);

    const firstPage = await request(http)
      .get('/api/v1/knowledge-spaces')
      .query({ limit: 1 })
      .set('Cookie', paginationCookie)
      .expect(200);
    const firstPageRaw: unknown = firstPage.body;
    if (!isRecord(firstPageRaw)) {
      throw new Error('Expected a Knowledge Space list object');
    }
    const firstPageBody = readSpaceListResponse(firstPageRaw);
    expect(firstPageBody.items).toHaveLength(1);
    expect(firstPageBody.nextCursor).not.toBeNull();
    if (firstPageBody.nextCursor === null) {
      throw new Error('Expected a next cursor for the first page');
    }

    const secondPage = await request(http)
      .get('/api/v1/knowledge-spaces')
      .query({ limit: 1, after: firstPageBody.nextCursor })
      .set('Cookie', paginationCookie)
      .expect(200);
    const secondPageRaw: unknown = secondPage.body;
    if (!isRecord(secondPageRaw)) {
      throw new Error('Expected a Knowledge Space list object');
    }
    const secondPageBody = readSpaceListResponse(secondPageRaw);
    expect(secondPageBody.items).toHaveLength(1);
    expect(secondPageBody.nextCursor).toBeNull();

    await request(http)
      .get(`/api/v1/knowledge-spaces/${firstId}`)
      .set('Cookie', cookieA)
      .expect(200)
      .expect((response) => {
        const body: unknown = response.body;
        if (!isRecord(body)) {
          throw new Error('Expected a Knowledge Space response object');
        }
        expect(readSpaceResponse(body).id).toBe(firstId);
        expect(Object.keys(body).sort()).toEqual([
          'createdAt',
          'id',
          'name',
          'updatedAt',
        ]);
      });
  });

  it('renames by stable ID and rejects empty or excess bodies', async () => {
    const renamed = await request(http)
      .patch(`/api/v1/knowledge-spaces/${firstId}`)
      .set('Cookie', cookieA)
      .send({ name: '  Archive  ' })
      .expect(200);
    const renamedBody: unknown = renamed.body;
    if (!isRecord(renamedBody)) {
      throw new Error('Expected a Knowledge Space response object');
    }
    expect(readSpaceResponse(renamedBody).name).toBe('Archive');

    await request(http)
      .patch(`/api/v1/knowledge-spaces/${firstId}`)
      .set('Cookie', cookieA)
      .send({})
      .expect(400);
    await request(http)
      .post('/api/v1/knowledge-spaces')
      .set('Cookie', cookieA)
      .send({ name: 'Personal', root: '/tmp/attacker' })
      .expect(400);
  });

  it('returns the same 404 response for missing and other-owner identifiers', async () => {
    const missing = await request(http)
      .get(`/api/v1/knowledge-spaces/${crypto.randomUUID()}`)
      .set('Cookie', cookieB)
      .expect(404);
    const otherOwner = await request(http)
      .get(`/api/v1/knowledge-spaces/${firstId}`)
      .set('Cookie', cookieB)
      .expect(404);
    expect(otherOwner.body).toEqual(missing.body);

    await request(http)
      .patch(`/api/v1/knowledge-spaces/${firstId}`)
      .set('Cookie', cookieB)
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('rejects malformed cursors and path IDs', async () => {
    await request(http)
      .get('/api/v1/knowledge-spaces')
      .query({ after: 'not-a-cursor=' })
      .set('Cookie', cookieA)
      .expect(400);
    await request(http)
      .get('/api/v1/knowledge-spaces/not-a-uuid')
      .set('Cookie', cookieA)
      .expect(400);
  });

  it('returns a safe unavailable response when the configured root disappears', async () => {
    rmSync(root, { recursive: true, force: true });

    const response = await request(http)
      .post('/api/v1/knowledge-spaces')
      .set('Cookie', cookieA)
      .send({ name: 'Unavailable' })
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
