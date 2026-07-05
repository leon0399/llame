/**
 * Public chat sharing over real HTTP (no session) — proves the claim the unit
 * and RLS-integration suites can't: that `GET /api/v1/shared/chats/:id`
 * actually behaves the same for a PRIVATE chat and an ABSENT one (no
 * existence oracle), that toggling visibility takes effect immediately over
 * HTTP, and that the response carries `Cache-Control: no-store`.
 *
 * Requires POSTGRES_URL to point at a migrated database. Without it the suite
 * is skipped so offline `pnpm test` remains usable; scripts/rls-test.sh
 * provides the real database gate.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { TenantDbService } from './../src/db/tenant-db.service';
import { ChatsRepository } from './../src/chats/chats-repository';
import { cookieOf } from './support';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

d('GET /api/v1/shared/chats/:id — public sharing over HTTP', () => {
  let app: INestApplication;
  let http: import('http').Server;
  let tenantDb: TenantDbService;

  const tag = crypto.randomUUID();
  let cookie = '';
  let userId = '';
  let chatId = '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer() as import('http').Server;
    tenantDb = app.get(TenantDbService);

    const res = await request(http)
      .post('/auth/v1/register')
      .send({
        email: `share-e2e-${tag}@example.com`,
        password: 'password123',
        name: 'Share E2E',
      });
    expect(res.status).toBe(201);
    cookie = cookieOf(res);
    userId = (res.body as { user: { id: string } }).user.id;

    // Seeded directly (no HTTP empty-chat endpoint, #86) — starts private.
    const chat = await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).create({
        ownerUserId: userId,
        title: 'HTTP share test chat',
      }),
    );
    chatId = chat.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a PRIVATE chat and an ABSENT id both 404 identically (no existence oracle), no session required', async () => {
    const privateRes = await request(http).get(
      `/api/v1/shared/chats/${chatId}`,
    );
    const absentRes = await request(http).get(
      `/api/v1/shared/chats/${crypto.randomUUID()}`,
    );

    expect(privateRes.status).toBe(404);
    expect(absentRes.status).toBe(404);
    // Neither response distinguishes "exists but private" from "never existed":
    // same status, same error shape. (The message text itself interpolates the
    // requested id either way, so it's expected to differ — that's not an
    // oracle, since the caller already knows the id it asked for.)
    expect(privateRes.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
    });
    expect(absentRes.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
    });
  });

  it('a malformed id 400s (distinct from the 404 existence check, not an oracle)', async () => {
    const res = await request(http).get('/api/v1/shared/chats/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('making the chat public exposes it, unauthenticated, with no-store', async () => {
    const patchRes = await request(http)
      .patch(`/api/v1/chats/${chatId}`)
      .set('Cookie', cookie)
      .send({ visibility: 'public' });
    expect(patchRes.status).toBe(200);

    const sharedRes = await request(http).get(`/api/v1/shared/chats/${chatId}`);
    expect(sharedRes.status).toBe(200);
    expect(sharedRes.headers['cache-control']).toContain('no-store');
    expect(sharedRes.body).toMatchObject({
      id: chatId,
      title: 'HTTP share test chat',
      messages: [],
    });
  });

  it('making it private again immediately 404s the same shared link', async () => {
    const patchRes = await request(http)
      .patch(`/api/v1/chats/${chatId}`)
      .set('Cookie', cookie)
      .send({ visibility: 'private' });
    expect(patchRes.status).toBe(200);

    const sharedRes = await request(http).get(`/api/v1/shared/chats/${chatId}`);
    expect(sharedRes.status).toBe(404);
  });
});
