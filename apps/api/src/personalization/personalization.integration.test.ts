/**
 * HTTP-boundary tests for /api/v1/me/personalization.
 *
 * Covers the acceptance criteria the personalization spec puts on the API:
 * owner-scoped read/update, identity taken solely from the session, caps
 * rejected with a field-naming 400, PATCH semantics (omit = keep, null =
 * clear), and no authored content in an error response.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { configureApp } from '../app.setup';
import { cookieOf, expectRegisteredUserId } from '../testing/support';
import { isRecord } from '@workspace/runtime-safety';
import { type UpdatePersonalizationDto } from './dto/personalization.dto';
import { PERSONALIZATION_CAPS } from './personalization.constants';

type PersonalizationPatchBody =
  | UpdatePersonalizationDto
  | (UpdatePersonalizationDto & { userId: string });

describe('/api/v1/me/personalization (HTTP)', () => {
  let app: INestApplication<import('http').Server>;
  let http: import('http').Server;
  const tag = Date.now();
  const password = 'password123';
  let cookieA = '';
  let cookieB = '';
  let userAId = '';

  function assertNullableAbout(
    body: unknown,
  ): asserts body is { about: string | null } {
    if (
      !isRecord(body) ||
      (typeof body.about !== 'string' && body.about !== null)
    ) {
      throw new Error('Expected personalization response with about');
    }
  }

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
    request(http).get('/api/v1/me/personalization').set('Cookie', cookie);

  const patch = (cookie: string, body: PersonalizationPatchBody) =>
    request(http)
      .patch('/api/v1/me/personalization')
      .set('Cookie', cookie)
      .send(body);

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

    const a = await register(`personalization-a-${tag}@test.com`, 'Owner A');
    cookieA = a.cookie;
    userAId = a.userId;
    cookieB = (await register(`personalization-b-${tag}@test.com`, 'Owner B'))
      .cookie;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns the defaults for an owner who has never written a profile', async () => {
    // "No row" must be indistinguishable from an empty row, including here — a
    // client should never need to special-case first use.
    const res = await get(cookieA).expect(200);

    expect(res.body).toEqual({
      preferredName: null,
      about: null,
      responsePreferences: null,
      enabled: true,
      shareAccountIdentity: false,
    });
  });

  it('stores authored fields and reads them back', async () => {
    await patch(cookieA, {
      preferredName: 'Leo',
      about: 'Builds llame',
      responsePreferences: 'Be terse',
    }).expect(200);

    const res = await get(cookieA).expect(200);
    expect(res.body).toMatchObject({
      preferredName: 'Leo',
      about: 'Builds llame',
      responsePreferences: 'Be terse',
      enabled: true,
      shareAccountIdentity: false,
    });
  });

  it('omitting a field keeps it; an explicit null clears it', async () => {
    // The two absence cases mean different things, and a single-field PATCH
    // must not wipe the rest of the profile.
    await patch(cookieA, { preferredName: 'Leonid' }).expect(200);
    expect((await get(cookieA).expect(200)).body).toMatchObject({
      preferredName: 'Leonid',
      about: 'Builds llame',
    });

    await patch(cookieA, { about: null }).expect(200);
    expect((await get(cookieA).expect(200)).body).toMatchObject({
      preferredName: 'Leonid',
      about: null,
      responsePreferences: 'Be terse',
    });
  });

  it('rejects a field over its cap, naming the field and storing nothing', async () => {
    const beforeBody: unknown = (await get(cookieA).expect(200)).body;
    assertNullableAbout(beforeBody);
    const before = beforeBody;

    const res = await patch(cookieA, {
      about: 'x'.repeat(PERSONALIZATION_CAPS.about + 1),
    }).expect(400);

    expect(JSON.stringify(res.body)).toContain('about');
    // No partial update: the stored value is untouched.
    expect((await get(cookieA).expect(200)).body).toMatchObject({
      about: before.about,
    });
  });

  it('does not echo authored content back in a validation error', async () => {
    const secret = `do-not-log-${tag}`;
    const res = await patch(cookieA, {
      preferredName: secret.repeat(PERSONALIZATION_CAPS.preferredName),
    }).expect(400);

    expect(JSON.stringify(res.body)).not.toContain(secret);
  });

  it('accepts both toggles', async () => {
    await patch(cookieA, {
      enabled: false,
      shareAccountIdentity: true,
    }).expect(200);

    expect((await get(cookieA).expect(200)).body).toMatchObject({
      enabled: false,
      shareAccountIdentity: true,
    });

    await patch(cookieA, { enabled: true, shareAccountIdentity: false });
  });

  it('scopes to the session: one owner never sees or writes another profile', async () => {
    // B has authored nothing, and A's content must not leak into B's read.
    expect((await get(cookieB).expect(200)).body).toMatchObject({
      preferredName: null,
      about: null,
    });

    await patch(cookieB, { preferredName: 'Bee' }).expect(200);

    expect((await get(cookieA).expect(200)).body).toMatchObject({
      preferredName: 'Leonid',
    });
    expect((await get(cookieB).expect(200)).body).toMatchObject({
      preferredName: 'Bee',
    });
  });

  it('ignores a client-supplied user id rather than targeting that user', async () => {
    // There is no route param or body field naming a user, so a supplied id is
    // simply not a thing the controller can act on — the request applies to the
    // authenticated caller, and the named user is untouched.
    await patch(cookieB, {
      userId: userAId,
      preferredName: 'Impersonated',
    }).expect(400); // whitelist ValidationPipe rejects the unknown property

    expect((await get(cookieA).expect(200)).body).toMatchObject({
      preferredName: 'Leonid',
    });
  });

  it('denies an unauthenticated caller and discloses nothing', async () => {
    await request(http).get('/api/v1/me/personalization').expect(401);
    await request(http)
      .patch('/api/v1/me/personalization')
      .send({ preferredName: 'anonymous' })
      .expect(401);
  });
});
