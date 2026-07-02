/**
 * Auth surface e2e (#60) — a real HTTP consumer (supertest) against the bootstrapped
 * NestJS app and a real Postgres, exercising the full lifecycle end-to-end: register,
 * cookie + Bearer auth, guarded /api/v1 access, cross-tenant isolation (RLS via runAs),
 * and live session revocation. This is the durable form of scripts' manual smoke — it
 * proves the surface works for a client, not just that units pass in isolation.
 *
 * Requires POSTGRES_URL to point at a migrated database whose role is non-superuser
 * (so RLS is enforced). scripts/rls-test.sh provisions exactly that and runs this file.
 * Without POSTGRES_URL the whole suite is skipped (so `pnpm test` stays green offline).
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

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

d('auth e2e — real HTTP + Postgres', () => {
  let app: INestApplication;
  let http: import('http').Server;
  let tenantDb: TenantDbService;
  const tag = Date.now();
  const emailA = `alice.${tag}@example.com`;
  const emailB = `bob.${tag}@example.com`;
  const password = 'password123';

  let cookieA = '';
  let tokenA = '';
  let userAId = '';
  let cookieB = '';
  let chatA = '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registers user A → 201, opaque token, HttpOnly session cookie', async () => {
    const res = await request(http)
      .post('/auth/v1/register')
      .send({ email: emailA, password, name: 'Alice' });
    expect(res.status).toBe(201);
    tokenA = res.body.token;
    userAId = res.body.user?.id;
    cookieA = cookieOf(res);
    expect(typeof userAId).toBe('string');
    expect(typeof tokenA).toBe('string');
    expect(tokenA.length).toBeGreaterThan(20);
    const setCookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(setCookie).toMatch(/HttpOnly/i);
    // The cookie carries the RAW token (it's the transport); only the DB copy is hashed.
    // So the cookie value equals the response token.
    expect(cookieA).toBe(`llame_session=${tokenA}`);
  });

  it('GET /auth/v1/me works via cookie, Bearer, and lowercase bearer; 401 without auth', async () => {
    expect(
      (await request(http).get('/auth/v1/me').set('Cookie', cookieA)).status,
    ).toBe(200);
    expect(
      (
        await request(http)
          .get('/auth/v1/me')
          .set('Authorization', `Bearer ${tokenA}`)
      ).status,
    ).toBe(200);
    // RFC 6750 §2.1: scheme is case-insensitive
    expect(
      (
        await request(http)
          .get('/auth/v1/me')
          .set('Authorization', `bearer ${tokenA}`)
      ).status,
    ).toBe(200);
    expect((await request(http).get('/auth/v1/me')).status).toBe(401);
  });

  it('lists a chat under the guarded /api/v1, owner-scoped', async () => {
    // No HTTP empty-chat endpoint (#86 — chats are created by their first message). Seed one
    // directly via the RLS-scoped repository, then exercise the guarded, owner-scoped list.
    const seeded = await tenantDb.runAs(userAId, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId: userAId, title: 'A chat' }),
    );
    chatA = seeded.id;
    expect(chatA).toBeTruthy();

    const list = await request(http)
      .get('/api/v1/chats')
      .set('Cookie', cookieA);
    expect(list.status).toBe(200);
    const arr = Array.isArray(list.body) ? list.body : (list.body.data ?? []);
    expect(arr.some((c: { id: string }) => c.id === chatA)).toBe(true);
  });

  it('CROSS-TENANT: user B cannot read user A’s chat (404)', async () => {
    const reg = await request(http)
      .post('/auth/v1/register')
      .send({ email: emailB, password, name: 'Bob' });
    expect(reg.status).toBe(201);
    cookieB = cookieOf(reg);
    const res = await request(http)
      .get(`/api/v1/chats/${chatA}`)
      .set('Cookie', cookieB);
    expect(res.status).toBe(404);
  });

  it('rejects a malformed session id with 400 (not a 500)', async () => {
    const res = await request(http)
      .delete('/auth/v1/sessions/not-a-uuid')
      .set('Cookie', cookieA);
    expect(res.status).toBe(400);
  });

  it('returns 409 (not 500) when registering an existing email', async () => {
    const res = await request(http)
      .post('/auth/v1/register')
      .send({ email: emailA, password, name: 'Alice' });
    expect(res.status).toBe(409);
  });

  it('rejects invalid/empty register input via the global ValidationPipe (400)', async () => {
    const res = await request(http)
      .post('/auth/v1/register')
      .send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
  });

  it('REVOCATION: after logout, the previously valid token is rejected (401)', async () => {
    const list = await request(http)
      .get('/auth/v1/sessions')
      .set('Cookie', cookieA);
    expect(list.status).toBe(200);

    const logout = await request(http)
      .delete('/auth/v1/sessions/current')
      .set('Cookie', cookieA);
    expect(logout.status).toBe(200);

    // the Bearer token for that same session must now be dead — the property JWT can't give
    const after = await request(http)
      .get('/auth/v1/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(after.status).toBe(401);
  });
});
