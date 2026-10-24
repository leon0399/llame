/**
 * HTTP-boundary tests for the repository catalog and its aliases.
 *
 * These routes never run git, so the application graph boots on its defaults:
 * the owner comes from the session, a display name must stay one path segment,
 * the remote is stored normalized, and a foreign identifier is not found.
 *
 * Covers openspec `repositories` — "Repositories are owner-scoped records with
 * a display name" and "The canonical remote comes from the `origin` remote".
 */

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IncomingMessage, Server, ServerResponse } from 'node:http';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { cookieOf, expectRegisteredUserId } from '../testing/support';

type HttpServer = Server<typeof IncomingMessage, typeof ServerResponse>;

function isHttpServer(value: unknown): value is HttpServer {
  return value instanceof Server;
}

const repositorySchema = z.looseObject({
  id: z.guid(),
  displayName: z.string(),
  canonicalRemote: z.string().nullable(),
});
const aliasSchema = z.looseObject({
  id: z.guid(),
  repositoryId: z.guid(),
  canonicalAlias: z.string(),
});
const failureSchema = z.looseObject({
  statusCode: z.number(),
  code: z.string(),
  message: z.string(),
});

type CreateRepositoryBody = {
  readonly displayName: string;
  readonly remote?: string | null;
};

describe('/api/v1/repositories (HTTP)', () => {
  let app: INestApplication;
  let http: HttpServer;
  let cookieA = '';
  let cookieB = '';

  async function register(cookieLabel: string): Promise<string> {
    const response = await request(http)
      .post('/auth/v1/register')
      .send({
        email: `repositories-${cookieLabel}-${crypto.randomUUID()}@test.com`,
        password: 'password123',
        name: `Owner ${cookieLabel}`,
      });
    const body: unknown = response.body;
    expectRegisteredUserId(body);
    return cookieOf(response);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0);
    const server: unknown = app.getHttpServer();
    if (!isHttpServer(server)) {
      throw new Error('Expected Nest to expose a Node HTTP server');
    }
    http = server;
    cookieA = await register('a');
    cookieB = await register('b');
  });

  afterAll(async () => {
    await app?.close();
  });

  const create = (cookie: string, body: CreateRepositoryBody) =>
    request(http).post('/api/v1/repositories').set('Cookie', cookie).send(body);

  it('creates a repository with a display name and the normalized remote', async () => {
    const response = await create(cookieA, {
      displayName: 'llame',
      remote: 'git@github.com:leon0399/llame.git',
    }).expect(201);

    expect(repositorySchema.parse(response.body)).toMatchObject({
      displayName: 'llame',
      canonicalRemote: 'github.com/leon0399/llame',
    });
  });

  it('answers a duplicate normalized remote as a conflict', async () => {
    const response = await create(cookieA, {
      displayName: 'llame-again',
      remote: 'https://github.com/leon0399/llame',
    }).expect(409);

    expect(failureSchema.parse(response.body).code).toBe('remote_taken');
  });

  it('refuses a display name that leaves its segment with 422', async () => {
    const response = await create(cookieA, {
      displayName: 'team/llame',
    }).expect(422);

    expect(failureSchema.parse(response.body)).toMatchObject({
      code: 'invalid_display_name',
    });
  });

  it('declares and re-uses an alias as one selection key', async () => {
    const created = repositorySchema.parse(
      (
        await create(cookieA, {
          displayName: 'renamed',
          remote: 'https://github.com/leon0399/llame-new',
        }).expect(201)
      ).body,
    );

    const alias = await request(http)
      .post(`/api/v1/repositories/${created.id}/aliases`)
      .set('Cookie', cookieA)
      .send({ remote: 'https://github.com/leon0399/llame-old.git' })
      .expect(201);
    expect(aliasSchema.parse(alias.body)).toMatchObject({
      repositoryId: created.id,
      canonicalAlias: 'github.com/leon0399/llame-old',
    });

    const duplicate = await request(http)
      .post(`/api/v1/repositories/${created.id}/aliases`)
      .set('Cookie', cookieA)
      .send({ remote: 'github.com/leon0399/llame-old' })
      .expect(409);
    expect(failureSchema.parse(duplicate.body).code).toBe('alias_taken');

    const foreign = await request(http)
      .post(`/api/v1/repositories/${created.id}/aliases`)
      .set('Cookie', cookieB)
      .send({ remote: 'github.com/leon0399/other' })
      .expect(404);
    expect(failureSchema.parse(foreign.body).code).toBe('not_found');
  });

  it('lists only the caller’s repositories', async () => {
    await create(cookieB, { displayName: 'b-only' }).expect(201);

    const mine = await request(http)
      .get('/api/v1/repositories')
      .set('Cookie', cookieB)
      .expect(200);
    const names = z
      .array(repositorySchema)
      .parse(mine.body)
      .map((row) => row.displayName);
    expect(names).toContain('b-only');
    expect(names).not.toContain('llame');
  });

  it('renames and deletes a repository, and 404s a repeated delete', async () => {
    const created = repositorySchema.parse(
      (await create(cookieA, { displayName: 'temporary' }).expect(201)).body,
    );

    const renamed = await request(http)
      .patch(`/api/v1/repositories/${created.id}`)
      .set('Cookie', cookieA)
      .send({ displayName: 'renamed-temporary' })
      .expect(200);
    expect(repositorySchema.parse(renamed.body).displayName).toBe(
      'renamed-temporary',
    );

    await request(http)
      .delete(`/api/v1/repositories/${created.id}`)
      .set('Cookie', cookieA)
      .expect(204);
    const gone = await request(http)
      .delete(`/api/v1/repositories/${created.id}`)
      .set('Cookie', cookieA)
      .expect(404);
    expect(failureSchema.parse(gone.body).code).toBe('not_found');
  });

  it('requires an authenticated identity', async () => {
    await request(http).get('/api/v1/repositories').expect(401);
  });
});
