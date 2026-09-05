/**
 * Public chat sharing over real HTTP (no session) — proves the claim the unit
 * and RLS-integration suites can't: that `GET /api/v1/shared/chats/:id`
 * actually behaves the same for a PRIVATE chat and an ABSENT one (no
 * existence oracle), that toggling visibility takes effect immediately over
 * HTTP, and that the response carries `Cache-Control: no-store`.
 *
 * Requires POSTGRES_URL to point at a migrated database. Without it the suite
 * is skipped so offline `pnpm test` remains usable; the test:integration globalSetup
 * provides the real database gate.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { configureApp } from '../app.setup';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository } from '../chats/chats-repository';
import { isRecord } from '@workspace/runtime-safety';
import { cookieOf, expectRegisteredUserId } from '../testing/support';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

/** Asserts a fork response body carries a string `id`. */
function assertForkId(body: unknown): asserts body is { id: string } {
  if (!isRecord(body) || typeof body.id !== 'string') {
    throw new Error('Expected fork response with id');
  }
}

/** Asserts a chat response body carries a string `visibility`. */
function assertChatVisibility(
  body: unknown,
): asserts body is { visibility: string } {
  if (!isRecord(body) || typeof body.visibility !== 'string') {
    throw new Error('Expected chat response with visibility');
  }
}

d('GET /api/v1/shared/chats/:id — public sharing over HTTP', () => {
  let app: INestApplication<import('http').Server>;
  let http: import('http').Server;
  let tenantDb: TenantDbService;

  const tag = crypto.randomUUID();
  let cookie = '';
  let userId = '';
  let chatId = '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
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
    const registerBody: unknown = res.body;
    expectRegisteredUserId(registerBody);
    userId = registerBody.user.id;

    // Seeded directly (no HTTP empty-chat endpoint, #86) — starts private.
    const chat = await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).create({
        ownerUserId: userId,
        title: 'HTTP share test chat',
      }),
    );
    chatId = chat.id;
    await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).setRecencyDigestIfAbsent(
        chatId,
        userId,
        {
          pinned: [
            {
              title: 'PRIVATE DIGEST TITLE',
              date: '2026-08-12',
              messageCount: 1,
              excerpt: 'PRIVATE DIGEST EXCERPT',
            },
          ],
          recent: [],
          pinnedShown: 1,
          pinnedTotal: 1,
          recentShown: 0,
          recentTotal: 1,
          compiledOn: '2026-08-12',
        },
        [{ chatId: crypto.randomUUID(), pinned: true }],
      ),
    );
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

  it('rejects the owner-only targetSeq query instead of ignoring it', async () => {
    const findPublicChat = vi.spyOn(
      ChatsRepository.prototype,
      'findPublicById',
    );
    const res = await request(http)
      .get(`/api/v1/shared/chats/${chatId}`)
      .query({ targetSeq: '1' });

    expect(res.status).toBe(400);
    expect(findPublicChat).not.toHaveBeenCalled();
    findPublicChat.mockRestore();
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
    const sharedBody: unknown = sharedRes.body;
    if (!isRecord(sharedBody)) {
      throw new Error('Expected object response body');
    }
    expect(Object.keys(sharedBody).sort()).toEqual(['id', 'messages', 'title']);
    expect(JSON.stringify(sharedRes.body)).not.toMatch(
      /PRIVATE DIGEST TITLE|PRIVATE DIGEST EXCERPT/,
    );
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

d(
  'POST /api/v1/shared/chats/:id/forks — forking a shared chat over HTTP',
  () => {
    let app: INestApplication<import('http').Server>;
    let http: import('http').Server;
    let tenantDb: TenantDbService;

    const tag = crypto.randomUUID();
    let ownerCookie = '';
    let ownerId = '';
    let visitorCookie = '';
    let publicChatId = '';
    let privateChatId = '';

    beforeAll(async () => {
      const mod = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(CanonicalSearchCoverageService)
        .useValue({ assertReady: () => Promise.resolve() })
        .compile();

      app = mod.createNestApplication();
      configureApp(app);
      await app.init();
      http = app.getHttpServer();
      tenantDb = app.get(TenantDbService);

      const ownerRes = await request(http)
        .post('/auth/v1/register')
        .send({
          email: `fork-owner-${tag}@example.com`,
          password: 'password123',
          name: 'Fork Owner',
        });
      expect(ownerRes.status).toBe(201);
      ownerCookie = cookieOf(ownerRes);
      const ownerBody: unknown = ownerRes.body;
      expectRegisteredUserId(ownerBody);
      ownerId = ownerBody.user.id;

      const visitorRes = await request(http)
        .post('/auth/v1/register')
        .send({
          email: `fork-visitor-${tag}@example.com`,
          password: 'password123',
          name: 'Fork Visitor',
        });
      expect(visitorRes.status).toBe(201);
      visitorCookie = cookieOf(visitorRes);

      const publicChat = await tenantDb.runAs(ownerId, (tx) =>
        new ChatsRepository(tx).create({
          ownerUserId: ownerId,
          title: 'Forkable chat',
          visibility: 'public',
        }),
      );
      publicChatId = publicChat.id;

      const privateChat = await tenantDb.runAs(ownerId, (tx) =>
        new ChatsRepository(tx).create({
          ownerUserId: ownerId,
          title: 'Private chat',
        }),
      );
      privateChatId = privateChat.id;
    });

    afterAll(async () => {
      await app?.close();
    });

    it('requires a session — no cookie is 401, unlike the public read route', async () => {
      const res = await request(http).post(
        `/api/v1/shared/chats/${publicChatId}/forks`,
      );
      expect(res.status).toBe(401);
    });

    it('a private chat 404s the same as an absent one, even for an authenticated caller', async () => {
      const privateRes = await request(http)
        .post(`/api/v1/shared/chats/${privateChatId}/forks`)
        .set('Cookie', visitorCookie);
      const absentRes = await request(http)
        .post(`/api/v1/shared/chats/${crypto.randomUUID()}/forks`)
        .set('Cookie', visitorCookie);

      expect(privateRes.status).toBe(404);
      expect(absentRes.status).toBe(404);
    });

    it('an authenticated visitor forks the public chat into their OWN chat list; the owner is untouched', async () => {
      const forkRes = await request(http)
        .post(`/api/v1/shared/chats/${publicChatId}/forks`)
        .set('Cookie', visitorCookie);

      expect(forkRes.status).toBe(201);
      const forkBody: unknown = forkRes.body;
      assertForkId(forkBody);
      const forkedId = forkBody.id;
      expect(forkedId).not.toBe(publicChatId);

      // The visitor now owns it...
      const asVisitor = await request(http)
        .get(`/api/v1/chats/${forkedId}`)
        .set('Cookie', visitorCookie);
      expect(asVisitor.status).toBe(200);

      // ...but the ORIGINAL owner cannot see the fork via their own chat list.
      const asOwner = await request(http)
        .get(`/api/v1/chats/${forkedId}`)
        .set('Cookie', ownerCookie);
      expect(asOwner.status).toBe(404);

      // The source chat is untouched — still public, still the owner's.
      const sourceStillOwners = await request(http)
        .get(`/api/v1/chats/${publicChatId}`)
        .set('Cookie', ownerCookie);
      expect(sourceStillOwners.status).toBe(200);
      const sourceBody: unknown = sourceStillOwners.body;
      assertChatVisibility(sourceBody);
      expect(sourceBody.visibility).toBe('public');
    });
  },
);
